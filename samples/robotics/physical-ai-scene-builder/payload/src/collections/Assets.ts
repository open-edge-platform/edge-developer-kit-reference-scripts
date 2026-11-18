// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Buffer } from 'node:buffer';
import { open, readFile, rm } from 'node:fs/promises';
import { ValidationError, type CollectionConfig, type PayloadRequest } from 'payload';
import sharp from 'sharp';

import { publicAccess, publicFieldAccess } from '../access';
import {
  convertMeshToCanonicalStl,
  createBoxCollisionStl,
  createMeshThumbnailSvg,
  extractMeshMetadataWithOptions,
  type MeshProcessingOptions,
} from '../lib/meshMetadata';
import { dataDirectory, dataPath } from '../storage';
// Dependency-free shared module (not the package entry) so Payload's own loaders can import it.
import { splatFileProblem } from '../../../packages/types/src/splat';

const MAX_MESH_UPLOAD_BYTES = 200 * 1024 * 1024;
type CollisionStrategy = 'box' | 'convex-hull' | 'none';

function meshProcessingOptions(value: unknown, filename: string): MeshProcessingOptions {
  const metadata = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const extension = filename.split('.').at(-1)?.toLowerCase();
  return {
    unit:
      metadata.unit === 'm' || metadata.unit === 'cm' || metadata.unit === 'mm'
        ? metadata.unit
        : 'm',
    upAxis:
      metadata.upAxis === 'y' || metadata.upAxis === 'z'
        ? metadata.upAxis
        : extension === 'glb'
          ? 'y'
          : 'z',
  };
}

function collisionStrategy(value: unknown): CollisionStrategy {
  return value === 'none' || value === 'convex-hull' ? value : 'box';
}

async function uploadedBytes(req: PayloadRequest): Promise<Buffer | null> {
  if (!req.file) return null;
  if (req.file.data.byteLength > 0) return req.file.data;
  if (req.file.tempFilePath) return readFile(req.file.tempFilePath);
  return null;
}

/** The first `length` bytes of the upload, without reading a large temp file completely. */
async function uploadedPrefix(req: PayloadRequest, length: number): Promise<Uint8Array | null> {
  if (!req.file) return null;
  if (req.file.data.byteLength > 0) return req.file.data.subarray(0, length);
  if (!req.file.tempFilePath) return null;
  const handle = await open(req.file.tempFilePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Rejects splat uploads that are too large, or are neither a PLY with a vertex element nor an SPZ. */
async function validateSplatUpload(req: PayloadRequest): Promise<void> {
  const fail = (message: string): never => {
    throw new ValidationError({ errors: [{ message, path: 'file' }] });
  };
  if (!req.file) return;
  const prefix = await uploadedPrefix(req, 64 * 1024);
  const problem = splatFileProblem(prefix ?? new Uint8Array(), req.file.size);
  if (problem) fail(problem);
}

function collisionFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${base || 'mesh'}-collision.stl`;
}

function canonicalFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${base || 'mesh'}-canonical.stl`;
}

function thumbnailFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${base || 'mesh'}-thumbnail.webp`;
}

async function createMeshArtifact({
  filename,
  bytes,
  artifactType,
  mimeType,
  visibility,
  req,
}: {
  filename: string;
  bytes: Uint8Array;
  artifactType: 'canonicalMesh' | 'collisionMesh' | 'thumbnail';
  mimeType: string;
  visibility: 'private' | 'library';
  req: PayloadRequest;
}): Promise<number> {
  const artifact = await req.payload.create({
    collection: 'asset-artifacts',
    data: {
      artifactType,
      visibility,
    },
    file: {
      data: Buffer.from(bytes),
      mimetype: mimeType,
      name: filename,
      size: bytes.byteLength,
    },
    req,
  });
  if (typeof artifact.id !== 'number') {
    throw new Error('The generated mesh artifact did not receive a numeric ID.');
  }
  return artifact.id;
}

function artifactId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (!value || typeof value !== 'object') return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

async function deleteArtifact(id: number, req: PayloadRequest): Promise<void> {
  try {
    await req.payload.delete({ collection: 'asset-artifacts', id, req });
  } catch {
    // Artifact cleanup must not mask the original asset operation failure.
  }
}

async function createCollisionArtifact({
  filename,
  dimensions,
  visibility,
  req,
}: {
  filename: string;
  dimensions: readonly number[];
  visibility: 'private' | 'library';
  req: PayloadRequest;
}): Promise<number> {
  return createMeshArtifact({
    filename: collisionFilename(filename),
    bytes: createBoxCollisionStl(dimensions),
    artifactType: 'collisionMesh',
    mimeType: 'application/octet-stream',
    visibility,
    req,
  });
}

async function createThumbnailArtifact({
  filename,
  bytes,
  visibility,
  req,
}: {
  filename: string;
  bytes: Uint8Array;
  visibility: 'private' | 'library';
  req: PayloadRequest;
}): Promise<number> {
  const result = createMeshThumbnailSvg(bytes, filename);
  if (!result.svg) {
    throw new Error(result.error ?? 'The mesh thumbnail could not be rendered.');
  }
  const thumbnail = await sharp(Buffer.from(result.svg))
    .resize(320, 320, { fit: 'cover' })
    .webp({ quality: 82 })
    .toBuffer();
  return createMeshArtifact({
    filename: thumbnailFilename(filename),
    bytes: thumbnail,
    artifactType: 'thumbnail',
    mimeType: 'image/webp',
    visibility,
    req,
  });
}

function dimensionsFromMetadata(value: unknown): number[] | null {
  if (!value || typeof value !== 'object') return null;
  const dimensions = (value as { dimensionsMeters?: unknown }).dimensionsMeters;
  if (!Array.isArray(dimensions) || dimensions.length !== 3) return null;
  const values = dimensions.map((entry) => {
    if (typeof entry === 'number') return entry;
    if (entry && typeof entry === 'object' && typeof entry.value === 'number') {
      return entry.value;
    }
    return Number.NaN;
  });
  return values.every(Number.isFinite) ? values : null;
}

/** Generated object bundles live in `data/imageto3D/<bundleId>`; reject anything path-like. */
function objectModelBundleId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const bundleId = (value as { bundleId?: unknown }).bundleId;
  return typeof bundleId === 'string' && /^[a-zA-Z0-9_-]+$/.test(bundleId) ? bundleId : null;
}

/** Saved scenes load generated objects from `objects/<bundleId>/…`, so keep files they still use. */
async function deleteUnusedObjectModelBundle(bundleId: string, req: PayloadRequest): Promise<void> {
  const [scenes, assets] = await Promise.all([
    req.payload.find({
      collection: 'scenes',
      where: { mjcf: { like: `objects/${bundleId}/` } },
      depth: 0,
      limit: 1,
      req,
    }),
    req.payload.find({
      collection: 'assets',
      where: { 'objectModel.bundleId': { equals: bundleId } },
      depth: 0,
      limit: 1,
      req,
    }),
  ]);
  if (scenes.totalDocs > 0 || assets.totalDocs > 0) return;
  await rm(dataPath('imageto3D', bundleId), { recursive: true, force: true });
}

function meshProcessingError(error: unknown): string {
  return error instanceof Error
    ? `Mesh processing failed: ${error.message}`
    : 'Mesh processing failed.';
}

export const Assets: CollectionConfig = {
  slug: 'assets',
  upload: {
    filesRequiredOnCreate: false,
    staticDir: dataDirectory(),
    mimeTypes: [
      'image/*',
      'model/gltf-binary',
      'model/gltf+json',
      'model/obj',
      'model/stl',
      'model/ply',
      'application/sla',
      'application/vnd.ms-pki.stl',
      // Some Linux MIME databases identify OBJ files as TGIF documents.
      'application/x-tgif',
      'application/octet-stream',
      // Payload sniffs content: SPZ splats are gzip streams.
      'application/gzip',
      'text/plain',
      'text/xml',
    ],
    imageSizes: [{ name: 'thumbnail', width: 320, height: 320, position: 'centre' }],
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'kind', 'processingStatus', 'updatedAt'],
  },
  access: {
    create: publicAccess,
    read: publicAccess,
    update: publicAccess,
    delete: publicAccess,
  },
  hooks: {
    beforeChange: [
      async ({ operation, data, originalDoc, req }) => {
        if ((data.kind ?? originalDoc?.kind) === 'splat' && req.file) {
          await validateSplatUpload(req);
          return data;
        }
        const shouldProcess =
          operation === 'create' ||
          (operation === 'update' && data.processingStatus === 'uploaded');
        if (!shouldProcess) return data;

        const proceduralStatus =
          data.primitive || data.customSource || objectModelBundleId(data.objectModel)
            ? { processingStatus: 'ready' as const }
            : {};
        if (data.kind !== 'mesh' || !req.file) return { ...data, ...proceduralStatus };
        const uploadedFile = req.file;
        if (uploadedFile.size > MAX_MESH_UPLOAD_BYTES) {
          throw new ValidationError({
            errors: [
              {
                message: 'Choose a mesh smaller than 200 MB.',
                path: 'file',
              },
            ],
          });
        }

        const bytes = await uploadedBytes(req);
        if (!bytes) {
          return {
            ...data,
            processingStatus: 'failed' as const,
            processingProgress: 100,
            processingError: 'The uploaded mesh data was unavailable for analysis.',
          };
        }

        const processing = meshProcessingOptions(data.metadata, uploadedFile.name);
        const result = extractMeshMetadataWithOptions(bytes, uploadedFile.name, processing);
        if (!result.metadata) {
          return {
            ...data,
            processingStatus: 'failed' as const,
            processingProgress: 100,
            processingError: result.error ?? 'The mesh could not be analyzed.',
          };
        }

        return {
          ...data,
          metadata: {
            sourceFormat: result.metadata.sourceFormat,
            unit: result.metadata.unit,
            upAxis: result.metadata.upAxis,
            collisionStrategy: collisionStrategy(
              data.metadata && typeof data.metadata === 'object'
                ? (data.metadata as Record<string, unknown>).collisionStrategy
                : undefined,
            ),
            dimensionsMeters: result.metadata.dimensionsMeters.map((value) => ({ value })),
            vertexCount: result.metadata.vertexCount,
            triangleCount: result.metadata.triangleCount,
          },
          processingStatus: 'ready' as const,
          processingProgress: 100,
          processingError: null,
        };
      },
    ],
    afterChange: [
      async ({ operation, data, doc, req }) => {
        if (req.context.skipSeededMeshArtifacts === true) return doc;

        const filename =
          typeof req.file?.name === 'string'
            ? req.file.name
            : typeof doc.filename === 'string'
              ? doc.filename
              : null;
        if (
          (operation !== 'create' &&
            !(operation === 'update' && data.processingStatus === 'uploaded')) ||
          doc.kind !== 'mesh' ||
          typeof doc.primitive?.type === 'string' ||
          doc.customSource ||
          objectModelBundleId(doc.objectModel) ||
          !req.file ||
          !filename
        ) {
          return doc;
        }

        const dimensions =
          dimensionsFromMetadata(data.metadata) ?? dimensionsFromMetadata(doc.metadata);
        if (!dimensions) return doc;
        const processing = meshProcessingOptions(data.metadata ?? doc.metadata, filename);
        const selectedCollisionStrategy = collisionStrategy(
          data.metadata && typeof data.metadata === 'object'
            ? (data.metadata as Record<string, unknown>).collisionStrategy
            : doc.metadata && typeof doc.metadata === 'object'
              ? (doc.metadata as Record<string, unknown>).collisionStrategy
              : undefined,
        );

        const createdArtifactIds: number[] = [];
        try {
          const bytes = await uploadedBytes(req);
          if (!bytes) throw new Error('The uploaded mesh data was unavailable for processing.');
          const result = convertMeshToCanonicalStl(bytes, filename, processing);
          if (!result.bytes) {
            throw new Error(result.error ?? 'The mesh could not be converted to canonical STL.');
          }
          const canonicalFilenameValue = canonicalFilename(filename);
          const canonicalMesh = await createMeshArtifact({
            filename: canonicalFilenameValue,
            bytes: result.bytes,
            artifactType: 'canonicalMesh',
            mimeType: 'application/octet-stream',
            visibility: doc.visibility === 'private' ? 'private' : 'library',
            req,
          });
          createdArtifactIds.push(canonicalMesh);
          const thumbnail = await createThumbnailArtifact({
            filename: canonicalFilenameValue,
            bytes: result.bytes,
            visibility: doc.visibility === 'private' ? 'private' : 'library',
            req,
          });
          createdArtifactIds.push(thumbnail);
          const visibility = doc.visibility === 'private' ? 'private' : 'library';
          const canonicalBytes = result.bytes;
          // Box: a generated box collider. Convex hull: the canonical mesh itself, which MuJoCo
          // collides as its convex hull. None: visual only.
          const createCollisionMesh = async (): Promise<number | null> => {
            if (selectedCollisionStrategy === 'box') {
              return createCollisionArtifact({ filename, dimensions, visibility, req });
            }
            if (selectedCollisionStrategy === 'convex-hull') {
              return createMeshArtifact({
                filename: canonicalFilenameValue,
                bytes: canonicalBytes,
                artifactType: 'collisionMesh',
                mimeType: 'application/octet-stream',
                visibility,
                req,
              });
            }
            return null;
          };
          const collisionMesh = await createCollisionMesh();
          if (collisionMesh !== null) createdArtifactIds.push(collisionMesh);
          const staleArtifactIds = [
            artifactId(doc.canonicalMesh),
            artifactId(doc.collisionMesh),
            artifactId(doc.thumbnail),
          ].filter((id): id is number => id !== null && !createdArtifactIds.includes(id));
          const updated = await req.payload.update({
            collection: 'assets',
            id: doc.id,
            data: {
              ...(canonicalMesh ? { canonicalMesh } : {}),
              thumbnail,
              collisionMesh,
              processingStatus: 'ready',
              processingProgress: 100,
              processingError: null,
            },
            req,
          });
          for (const id of staleArtifactIds) await deleteArtifact(id, req);
          return updated;
        } catch (error) {
          for (const id of createdArtifactIds.reverse()) await deleteArtifact(id, req);
          const processingError = meshProcessingError(error);
          await req.payload.update({
            collection: 'assets',
            id: doc.id,
            data: {
              processingStatus: 'failed',
              processingProgress: 100,
              processingError,
            },
            req,
          });
          return { ...doc, processingStatus: 'failed', processingError };
        }
      },
    ],
    afterDelete: [
      async ({ doc, req }) => {
        const record = doc as Record<string, unknown>;
        for (const field of ['canonicalMesh', 'collisionMesh', 'thumbnail']) {
          const id = artifactId(record[field]);
          if (id !== null) await deleteArtifact(id, req);
        }
        const bundleId = objectModelBundleId(record.objectModel);
        if (bundleId) {
          try {
            await deleteUnusedObjectModelBundle(bundleId, req);
          } catch {
            // Leaving generated files behind is preferable to failing the delete.
          }
        }
      },
    ],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'mesh',
      options: [
        { label: 'Mesh', value: 'mesh' },
        { label: 'Splat', value: 'splat' },
        { label: 'Texture', value: 'texture' },
        { label: 'Material', value: 'material' },
      ],
    },
    {
      name: 'category',
      type: 'select',
      defaultValue: 'general',
      options: [
        { label: 'General', value: 'general' },
        { label: 'Furniture', value: 'furniture' },
        { label: 'Industrial', value: 'industrial' },
        { label: 'Terrain', value: 'terrain' },
        { label: 'Props', value: 'props' },
      ],
    },
    {
      name: 'material',
      type: 'group',
      admin: {
        condition: (_, siblingData) => siblingData.kind === 'material',
        description: 'Solid-color appearance used by scene objects.',
      },
      fields: [
        {
          name: 'color',
          type: 'text',
          required: true,
          defaultValue: '#9eb4c8',
        },
        {
          name: 'metallic',
          type: 'number',
          required: true,
          min: 0,
          max: 1,
          defaultValue: 0,
        },
        {
          name: 'roughness',
          type: 'number',
          required: true,
          min: 0,
          max: 1,
          defaultValue: 0.6,
        },
      ],
    },
    {
      name: 'primitive',
      type: 'group',
      admin: {
        condition: (_, siblingData) => siblingData.kind === 'mesh',
        description: 'Procedural MuJoCo geom definition for created objects.',
      },
      fields: [
        {
          name: 'type',
          type: 'select',
          options: [
            { label: 'Box', value: 'box' },
            { label: 'Sphere', value: 'sphere' },
            { label: 'Capsule', value: 'capsule' },
            { label: 'Cylinder', value: 'cylinder' },
            { label: 'Ellipsoid', value: 'ellipsoid' },
          ],
        },
        {
          name: 'size',
          type: 'array',
          minRows: 3,
          maxRows: 3,
          fields: [{ name: 'value', type: 'number', required: true, min: 0 }],
        },
        {
          name: 'rgba',
          type: 'array',
          minRows: 4,
          maxRows: 4,
          fields: [{ name: 'value', type: 'number', required: true, min: 0, max: 1 }],
        },
        {
          name: 'mass',
          type: 'number',
          min: 0.0001,
        },
        {
          name: 'friction',
          type: 'array',
          minRows: 3,
          maxRows: 3,
          fields: [{ name: 'value', type: 'number', required: true, min: 0 }],
        },
      ],
    },
    {
      name: 'customSource',
      type: 'textarea',
      admin: {
        condition: (_, siblingData) => siblingData.kind === 'mesh',
        description: 'Raw MuJoCo geom or body definition for custom shapes.',
      },
    },
    {
      name: 'objectModel',
      type: 'group',
      admin: {
        condition: (_, siblingData) => siblingData.kind === 'mesh',
        description: 'Textured MJCF object converted by obj2mjcf (e.g. from image-to-3D).',
      },
      fields: [
        {
          name: 'bundleId',
          type: 'text',
          index: true,
          admin: { description: 'Folder under data/imageto3D holding the generated files.' },
        },
        {
          name: 'mjcf',
          type: 'code',
          admin: { language: 'xml' },
        },
        {
          name: 'files',
          type: 'json',
          admin: { description: 'Mesh and texture filenames the MJCF references.' },
        },
      ],
    },
    {
      name: 'tags',
      type: 'text',
      hasMany: true,
    },
    {
      name: 'project',
      type: 'relationship',
      relationTo: 'projects',
      index: true,
      admin: {
        description: 'Optional project scope for private scene assets.',
      },
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'library',
      options: [
        { label: 'Private', value: 'private' },
        { label: 'Library', value: 'library' },
      ],
    },
    {
      name: 'processingStatus',
      type: 'select',
      required: true,
      defaultValue: 'uploaded',
      index: true,
      options: [
        { label: 'Uploaded', value: 'uploaded' },
        { label: 'Queued', value: 'queued' },
        { label: 'Processing', value: 'processing' },
        { label: 'Ready', value: 'ready' },
        { label: 'Needs attention', value: 'failed' },
      ],
      access: {
        update: publicFieldAccess,
      },
    },
    {
      name: 'processingProgress',
      type: 'number',
      min: 0,
      max: 100,
      access: {
        create: publicFieldAccess,
        update: publicFieldAccess,
      },
    },
    {
      name: 'processingError',
      type: 'textarea',
      access: {
        create: publicFieldAccess,
        update: publicFieldAccess,
      },
    },
    {
      name: 'metadata',
      type: 'group',
      admin: {
        description: 'Derived mesh measurements for display and placement.',
      },
      fields: [
        {
          name: 'sourceFormat',
          type: 'select',
          options: [
            { label: 'GLB', value: 'glb' },
            { label: 'OBJ', value: 'obj' },
            { label: 'STL', value: 'stl' },
          ],
        },
        {
          name: 'unit',
          type: 'select',
          options: [
            { label: 'Metres', value: 'm' },
            { label: 'Centimetres', value: 'cm' },
            { label: 'Millimetres', value: 'mm' },
          ],
        },
        {
          name: 'upAxis',
          type: 'select',
          options: [
            { label: 'Y', value: 'y' },
            { label: 'Z', value: 'z' },
          ],
        },
        {
          name: 'collisionStrategy',
          type: 'select',
          defaultValue: 'box',
          options: [
            { label: 'Box collider', value: 'box' },
            { label: 'Convex hull (mesh)', value: 'convex-hull' },
            { label: 'Visual only', value: 'none' },
          ],
          admin: {
            description: 'Choose whether uploaded meshes participate in physics contacts.',
          },
        },
        {
          name: 'dimensionsMeters',
          type: 'array',
          maxRows: 3,
          fields: [{ name: 'value', type: 'number', required: true }],
        },
        {
          name: 'vertexCount',
          type: 'number',
          min: 0,
        },
        {
          name: 'triangleCount',
          type: 'number',
          min: 0,
        },
      ],
      access: {
        create: publicFieldAccess,
        update: publicFieldAccess,
      },
    },
    {
      name: 'canonicalMesh',
      type: 'relationship',
      relationTo: 'asset-artifacts',
      access: {
        create: publicFieldAccess,
        update: publicFieldAccess,
      },
    },
    {
      name: 'collisionMesh',
      type: 'relationship',
      relationTo: 'asset-artifacts',
      access: {
        create: publicFieldAccess,
        update: publicFieldAccess,
      },
    },
    {
      name: 'thumbnail',
      type: 'relationship',
      relationTo: 'asset-artifacts',
      access: {
        create: publicFieldAccess,
        update: publicFieldAccess,
      },
    },
  ],
};
