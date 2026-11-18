// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createMeshThumbnailSvg } from '@mujoco-studio/payload/mesh-metadata';
import { dataPath } from '@mujoco-studio/payload/storage';

import { Obj2MjcfError, runObj2Mjcf } from '@/lib/process/obj2mjcf';
import { saveObjectModelAsset } from '@/lib/process/objectModelAsset';
import type { AssetCategory } from '@/lib/scenes/assetsApi';
import { objectModelAssetName } from '@/lib/scenes/imageTo3dApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_TEXTURES = 16;

function integrationPath(): string {
  return path.resolve(
    process.env.ROBOTIC_STUDIO_PYTHONPATH?.trim() ||
      path.resolve(/* turbopackIgnore: true */ process.cwd(), '../../integrations/python'),
  );
}

function errorResponse(message: string, status = 400): Response {
  return Response.json({ errors: [{ message }] }, { status });
}

/** A plain filename with no directory separators, "..", or leading dot. */
function safeBasename(name: string): string | null {
  if (
    !name ||
    name !== path.basename(name) ||
    /[\\\0]/.test(name) ||
    name.includes('..') ||
    name.startsWith('.')
  ) {
    return null;
  }
  return name;
}

/** The `.mtl` filename an OBJ's `mtllib` line references, mirroring obj2mjcf's own parser. */
function mtllibReference(objText: string): string | null {
  const mtllib = /^mtllib\s+(.+?\.mtl)(?:\s*#.*)?\s*$/i;
  for (const line of objText.split(/\r?\n/)) {
    const match = mtllib.exec(line.trim());
    if (match) return match[1];
  }
  return null;
}

function uploadCategory(value: FormDataEntryValue | null): AssetCategory {
  return value === 'furniture' || value === 'industrial' || value === 'terrain' || value === 'props'
    ? value
    : 'general';
}

/** An SVG render of the uploaded OBJ for the library thumbnail, or null if it can't be drawn. */
function objPreview(objBytes: Uint8Array, filename: string): Uint8Array | null {
  const { svg } = createMeshThumbnailSvg(objBytes, filename);
  return svg ? new TextEncoder().encode(svg) : null;
}

async function assetDirectory(id: string): Promise<string> {
  const directory = dataPath('imageto3D', id);
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function POST(request: Request): Promise<Response> {
  const assetId = randomUUID();
  const directory = await assetDirectory(assetId);
  let completed = false;
  try {
    const form = await request.formData();
    const objFile = form.get('obj');
    const mtlFile = form.get('mtl');
    const textureFiles = form
      .getAll('textures')
      .filter((entry): entry is File => entry instanceof File);
    if (!(objFile instanceof File) || !objFile.name.toLowerCase().endsWith('.obj')) {
      return errorResponse('Choose an OBJ file.');
    }
    if (!(mtlFile instanceof File) || !mtlFile.name.toLowerCase().endsWith('.mtl')) {
      return errorResponse('Choose an MTL file.');
    }
    if (textureFiles.length > MAX_TEXTURES) {
      return errorResponse(`Choose at most ${MAX_TEXTURES} texture images.`);
    }
    for (const texture of textureFiles) {
      if (!/\.(png|jpe?g)$/i.test(texture.name)) {
        return errorResponse('Textures must be PNG or JPEG images.');
      }
    }
    for (const file of [objFile, mtlFile, ...textureFiles]) {
      if (file.size > MAX_FILE_BYTES) return errorResponse('Choose files smaller than 500 MB.');
      if (!safeBasename(file.name)) return errorResponse(`"${file.name}" is not a valid filename.`);
    }
    const filenames = [objFile, mtlFile, ...textureFiles].map((file) => file.name);
    if (new Set(filenames).size !== filenames.length) {
      return errorResponse('Upload files with unique filenames.');
    }

    const objText = await objFile.text();
    const referencedMtl = mtllibReference(objText);
    if (referencedMtl && referencedMtl !== mtlFile.name) {
      return errorResponse(
        `This OBJ references the MTL file "${referencedMtl}", but you uploaded "${mtlFile.name}". Rename the MTL file to "${referencedMtl}" and try again.`,
      );
    }

    for (const file of [objFile, mtlFile, ...textureFiles]) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await writeFile(path.join(directory, file.name), bytes);
    }

    const { mjcf, files } = await runObj2Mjcf(
      directory,
      integrationPath(),
      undefined,
      request.signal,
    );
    completed = true;

    // Saving to the library lets the object be placed again without converting it again; the
    // converted files stay usable for this placement even if saving fails.
    let libraryAssetId: number | null = null;
    let libraryError: string | null = null;
    try {
      const nameField = form.get('name');
      libraryAssetId = await saveObjectModelAsset({
        bundleId: assetId,
        name:
          typeof nameField === 'string' && nameField.trim()
            ? nameField.trim().slice(0, 120)
            : objectModelAssetName(objFile.name),
        category: uploadCategory(form.get('category')),
        conversion: { mjcf, files },
        preview: objPreview(new Uint8Array(await objFile.arrayBuffer()), objFile.name),
        tags: ['obj2mjcf'],
      });
    } catch (error) {
      libraryError = error instanceof Error ? error.message : String(error);
    }
    return Response.json({ assetId, mjcf, files, libraryAssetId, libraryError });
  } catch (error) {
    if (error instanceof Obj2MjcfError) return errorResponse(error.message, error.status);
    return errorResponse(
      error instanceof Error ? error.message : 'The object could not be converted.',
      500,
    );
  } finally {
    if (!completed) await rm(directory, { recursive: true, force: true });
  }
}
