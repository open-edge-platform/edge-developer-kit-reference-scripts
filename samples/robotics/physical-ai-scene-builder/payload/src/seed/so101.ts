// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Payload } from 'payload';

import { withVirtualRobotCapability } from '../lib/robotCapabilities';

const SO101_SLUG = 'so101';
const SO101_SEED_TAG = 'seed:so101';
const SO101_SAMPLE_SEED_TAG = 'seed:so101-sample';
const SO101_SAMPLE_SCENE_NAME = 'so101';
const SO101_DIRECTORY = 'samples/so101-environment/robots/so101';
const SO101_MJCF_FILENAME = 'so101_new_calib.xml';
const SO101_MESH_FILENAMES = [
  'waveshare_mounting_plate_so101_v2.stl',
  'sts3215_03a_v1.stl',
  'motor_holder_so101_base_v1.stl',
  'wrist_roll_follower_so101_v1.stl',
  'moving_jaw_so101_v1.stl',
  'base_motor_holder_so101_v1.stl',
  'upper_arm_so101_v1.stl',
  'wrist_roll_pitch_so101_v2.stl',
  'under_arm_so101_v1.stl',
  'rotation_pitch_so101_v1.stl',
  'motor_holder_so101_wrist_v1.stl',
  'sts3215_03a_no_horn_v1.stl',
  'base_so101_v2.stl',
] as const;

const SO101_SAMPLE_ASSETS = [
  {
    sourcePath: 'textures/a2-mat.png',
    filename: 'a2-mat.png',
    name: 'SO101 sample A2 mat',
    kind: 'texture',
    category: 'general',
    mimetype: 'image/png',
  },
] as const;

interface SeedAsset {
  id: number;
  filename: string | null;
  tags: string[];
}

type SampleAssetSpec = (typeof SO101_SAMPLE_ASSETS)[number];

interface SeedRobot {
  id: number;
  mjcf: string;
  meshes: number[];
  tags: string[];
}

function seedAssetName(filename: string): string {
  return `SO101 ${filename.replace(/\.stl$/i, '').replace(/_/g, ' ')}`;
}

function sourceTag(filename: string): string {
  return `source:${filename}`;
}

function digestTag(digest: string): string {
  return `sha256:${digest}`;
}

function assetFromDocument(value: unknown): SeedAsset | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'number') return null;
  return {
    id: record.id,
    filename: typeof record.filename === 'string' ? record.filename : null,
    tags: stringTags(record.tags),
  };
}

function stringTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [];
}

function normalizedMeshFilename(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('assets/')) return normalized.slice('assets/'.length);
  return normalized;
}

function validateMeshPath(value: string): string {
  const normalized = normalizedMeshFilename(value);
  if (
    !normalized ||
    normalized.includes('/') ||
    normalized.includes('..') ||
    normalized.startsWith('/') ||
    normalized.includes(':') ||
    normalized.startsWith('http') ||
    normalized.startsWith('file:')
  ) {
    throw new Error(`SO101 contains an unsupported mesh path: ${value}`);
  }
  return normalized;
}

function normalizeSo101Mjcf(source: string): string {
  if (!/<mujoco\b/i.test(source)) throw new Error('SO101 MJCF has no mujoco root element.');
  if (/<include\b/i.test(source)) throw new Error('SO101 MJCF must not contain include elements.');

  const fileValues = [...source.matchAll(/\bfile\s*=\s*["']([^"']+)["']/gi)].map(
    (match) => match[1],
  );
  const meshDeclarations = [
    ...source.matchAll(/<mesh\b[^>]*\bfile\s*=\s*["']([^"']+)["'][^>]*\/?>(?:\s*)/gi),
  ].map((match) => validateMeshPath(match[1]));
  const expected = [...SO101_MESH_FILENAMES].sort();
  const actual = [...meshDeclarations].sort();
  if (
    actual.length !== expected.length ||
    actual.some((filename, index) => filename !== expected[index])
  ) {
    throw new Error('SO101 MJCF mesh declarations do not match the bundled source manifest.');
  }

  for (const value of fileValues) validateMeshPath(value);

  return source.replace(/(\bmeshdir\s*=\s*["'])[^"']*(["'])/i, '$1$2').replaceAll('assets/', '');
}

function fixSo101SamplePad(mjcf: string): string {
  return mjcf.replace(
    /(<body\s+name=["']asset_pad["'][^>]*>)([\s\S]*?)(<\/body>)/i,
    (_body, opening: string, contents: string, closing: string) =>
      `${opening}${contents.replace(/^\s*(?:<freejoint\s*\/\s*>|<joint\b[^>]*\btype=["']free["'][^>]*\/\s*>)\s*/i, '\n      ')}${closing}`,
  );
}

function addCameraToBody(mjcf: string, bodyName: string, camera: string): string | null {
  const bodyOpenings = /<body\b[^>]*>/gi;
  let opening: RegExpExecArray | null = null;
  let candidate: RegExpExecArray | null;
  while ((candidate = bodyOpenings.exec(mjcf))) {
    if (/\bname=["']([^"']*)["']/i.exec(candidate[0])?.[1] === bodyName) {
      opening = candidate;
      break;
    }
  }
  if (!opening) return null;

  const bodyTags = /<\/?body\b[^>]*>/gi;
  bodyTags.lastIndex = opening.index + opening[0].length;
  let depth = 1;
  let tag: RegExpExecArray | null;
  while ((tag = bodyTags.exec(mjcf))) {
    if (tag[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) {
        return `${mjcf.slice(0, tag.index)}${camera}${mjcf.slice(tag.index)}`;
      }
    } else if (!tag[0].endsWith('/>')) {
      depth += 1;
    }
  }
  return null;
}

async function so101Directory(): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), SO101_DIRECTORY),
    path.resolve(moduleDirectory, '../../../', SO101_DIRECTORY),
  ];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, SO101_MJCF_FILENAME));
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`Could not locate the bundled SO101 source under ${SO101_DIRECTORY}.`);
}

async function findSeedAsset(
  payload: Payload,
  filename: string,
  digest: string,
  seedTag = SO101_SEED_TAG,
): Promise<SeedAsset | null> {
  const result = await payload.find({
    collection: 'assets',
    depth: 0,
    limit: 100,
    where: { tags: { contains: sourceTag(filename) } },
  });
  const digestValue = digestTag(digest);
  const match = result.docs.find((doc) => {
    const tags = stringTags(doc.tags);
    return tags.includes(seedTag) && tags.includes(digestValue);
  });
  return assetFromDocument(match);
}

function seededAssetStoragePath(payload: Payload, filename: string): string {
  const upload = payload.collections.assets.config.upload;
  if (!upload || typeof upload !== 'object' || typeof upload.staticDir !== 'string') {
    throw new Error('Payload asset upload directory is not configured.');
  }
  if (!filename || path.basename(filename) !== filename || filename === '.' || filename === '..') {
    throw new Error(`SO101 asset has an unsupported stored filename: ${filename}`);
  }
  return path.resolve(upload.staticDir, filename);
}

async function ensureSeedAssetOriginal(
  payload: Payload,
  asset: SeedAsset,
  bytes: Uint8Array,
  digest: string,
): Promise<void> {
  if (!asset.filename) throw new Error(`SO101 asset ${asset.id} has no stored filename.`);
  const storagePath = seededAssetStoragePath(payload, asset.filename);
  let storedDigest: string | null = null;
  try {
    const storedBytes = await readFile(storagePath);
    storedDigest = createHash('sha256').update(storedBytes).digest('hex');
  } catch (error) {
    const isMissingFile =
      error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
    if (!isMissingFile) {
      throw new Error(`Could not verify SO101 asset file "${asset.filename}".`, { cause: error });
    }
  }
  if (storedDigest === digest) return;

  const matchingAssets = await payload.find({
    collection: 'assets',
    depth: 0,
    pagination: false,
    where: { filename: { equals: asset.filename } },
  });
  const otherAsset = matchingAssets.docs.find(
    (document) => document.id !== asset.id && document.filename === asset.filename,
  );
  if (otherAsset) {
    throw new Error(
      `Refusing to restore SO101 asset file "${asset.filename}" because asset ${otherAsset.id} also references it.`,
    );
  }

  await mkdir(path.dirname(storagePath), { recursive: true });
  await writeFile(storagePath, bytes);
  payload.logger.info(
    `SO101 seed restored ${storedDigest ? 'corrupt' : 'missing'} asset file "${asset.filename}".`,
  );
}

async function seedAsset(
  payload: Payload,
  directory: string,
  filename: string,
): Promise<{ asset: SeedAsset; created: boolean }> {
  const bytes = await readFile(path.join(directory, 'assets', filename));
  if (!bytes.byteLength) throw new Error(`SO101 mesh is empty: ${filename}`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const existing = await findSeedAsset(payload, filename, digest);
  if (existing) {
    await ensureSeedAssetOriginal(payload, existing, bytes, digest);
    return { asset: existing, created: false };
  }

  const created = await payload.create({
    collection: 'assets',
    draft: false,
    context: { skipSeededMeshArtifacts: true },
    data: {
      name: seedAssetName(filename),
      kind: 'mesh',
      category: 'industrial',
      tags: [SO101_SEED_TAG, sourceTag(filename), digestTag(digest)],
      visibility: 'library',
      processingStatus: 'uploaded',
    },
    file: {
      data: bytes,
      mimetype: 'model/stl',
      name: filename,
      size: bytes.byteLength,
    },
  });
  if (typeof created.id !== 'number')
    throw new Error(`SO101 mesh did not receive an ID: ${filename}`);
  const asset: SeedAsset = {
    id: created.id,
    filename: typeof created.filename === 'string' ? created.filename : filename,
    tags: stringTags(created.tags),
  };
  await ensureSeedAssetOriginal(payload, asset, bytes, digest);
  return { asset, created: true };
}

async function seedSampleAsset(
  payload: Payload,
  directory: string,
  spec: SampleAssetSpec,
): Promise<{ asset: SeedAsset; created: boolean }> {
  const bytes = await readFile(path.join(directory, spec.sourcePath));
  if (!bytes.byteLength) throw new Error(`SO101 sample asset is empty: ${spec.sourcePath}`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const existing = await findSeedAsset(payload, spec.sourcePath, digest, SO101_SAMPLE_SEED_TAG);
  if (existing) {
    await ensureSeedAssetOriginal(payload, existing, bytes, digest);
    return { asset: existing, created: false };
  }

  const created = await payload.create({
    collection: 'assets',
    draft: false,
    context: { skipSeededMeshArtifacts: true },
    data: {
      name: spec.name,
      kind: spec.kind,
      category: spec.category,
      tags: [SO101_SAMPLE_SEED_TAG, sourceTag(spec.sourcePath), digestTag(digest)],
      visibility: 'library',
      processingStatus: 'ready',
    },
    file: {
      data: bytes,
      mimetype: spec.mimetype,
      name: spec.filename,
      size: bytes.byteLength,
    },
  });
  const asset = assetFromDocument(created);
  if (!asset) throw new Error(`SO101 sample asset did not receive an ID: ${spec.sourcePath}`);
  const refreshed = await findSeedAsset(payload, spec.sourcePath, digest, SO101_SAMPLE_SEED_TAG);
  const seededAsset = refreshed ?? asset;
  await ensureSeedAssetOriginal(payload, seededAsset, bytes, digest);
  return { asset: seededAsset, created: true };
}

function rewriteSo101MeshPaths(source: string, assets: readonly SeedAsset[]): string {
  let mjcf = source;
  for (const asset of assets) {
    const sourceFilename = stringTags(asset.tags)
      .find((tag) => tag.startsWith('source:'))
      ?.slice('source:'.length);
    if (!sourceFilename || !asset.filename) {
      throw new Error(`SO101 mesh asset ${asset.id} has no source filename.`);
    }
    const sourceDeclaration = `<mesh file="${sourceFilename}"/>`;
    const runtimeDeclaration = `<mesh name="${sourceFilename.replace(/\.[^.]+$/, '')}" file="assets/${asset.id}/${asset.filename}"/>`;
    if (!mjcf.includes(sourceDeclaration)) {
      throw new Error(`SO101 sample is missing mesh declaration: ${sourceFilename}`);
    }
    mjcf = mjcf.replaceAll(sourceDeclaration, runtimeDeclaration);
  }
  return mjcf;
}

function buildSo101SampleMjcf(
  robotMjcf: string,
  robotAssets: readonly SeedAsset[],
  textureAsset: SeedAsset,
): string {
  if (!textureAsset.filename) {
    throw new Error('SO101 sample assets must retain their uploaded filenames.');
  }

  let mjcf = rewriteSo101MeshPaths(robotMjcf, robotAssets).replace(
    /<mujoco\b[^>]*>/i,
    '<mujoco model="so101">',
  );
  const withMountedCamera = addCameraToBody(
    mjcf,
    'gripper',
    '\n              <camera name="camera" pos="-0.004122 0.0846 0.010032" fovy="45" quat="0.978541 -0.20581 -0.010025 0" resolution="640 480"/>',
  );
  if (!withMountedCamera) throw new Error('SO101 robot MJCF has no gripper body.');
  mjcf = withMountedCamera;
  if (!/<option\b/i.test(mjcf)) {
    mjcf = mjcf.replace(
      /(<compiler\b[^>]*\/\s*>)/i,
      '$1\n  <option timestep="0.002" gravity="0 0 -9.81"/>',
    );
  }

  const texturePath = `textures/${textureAsset.id}/${textureAsset.filename}`;
  const sampleAssetDeclarations = `
    <texture name="sample_a2_texture" type="2d" file="${texturePath}"/>
    <material name="sample_a2_material" texture="sample_a2_texture" rgba="1 1 1 1"/>
    <material name="sample_floor_material" rgba="0.22 0.24 0.28 1"/>`;
  if (!/<asset\b/i.test(mjcf)) throw new Error('SO101 robot MJCF has no asset section.');
  mjcf = mjcf.replace(/(<asset\s*>)/i, `$1${sampleAssetDeclarations}`);
  const assetSection = mjcf.match(/<asset\b[\s\S]*?<\/asset>/i)?.[0];
  if (!assetSection) throw new Error('SO101 sample asset section could not be assembled.');
  mjcf = mjcf
    .replace(assetSection, '')
    .replace(/<worldbody\s*>/i, `${assetSection}\n  <worldbody>`);

  const taskObjectsBeforeRobot = `
    <geom name="floor" type="plane" size="4 4 0.1" material="sample_floor_material" pos="0.004367 0 0"/>
    <light name="key" pos="0 0 3" dir="0 0 -1" diffuse="1 1 1"/>
    <body name="table" pos="0 0 0">
      <geom name="table_top" type="box" pos="0 0 0.75" size="0.6 0.8 0.05" rgba="0.55 0.35 0.18 1"/>
      <geom name="leg_fl" type="cylinder" pos="-0.5 -0.3 0.375" size="0.05 0.375" rgba="0.45 0.28 0.14 1"/>
      <geom name="leg_fr" type="cylinder" pos="0.5 -0.3 0.375" size="0.05 0.375" rgba="0.45 0.28 0.14 1"/>
      <geom name="leg_bl" type="cylinder" pos="-0.5 0.3 0.375" size="0.05 0.375" rgba="0.45 0.28 0.14 1"/>
      <geom name="leg_br" type="cylinder" pos="0.5 0.3 0.375" size="0.05 0.375" rgba="0.45 0.28 0.14 1"/>
    </body>
    <body name="asset_a2_plate_body" pos="-0.305027 0 0.8035">
      <freejoint/>
      <geom name="a2_plate" type="box" size="0.297 0.210 0.0015" material="sample_a2_material"/>
    </body>
    <body name="asset_cube" pos="-0.305027 0.059617 0.830368">
      <freejoint/>
      <geom name="asset_cube_geom" type="box" size="0.0125 0.0125 0.0125" mass="0.01" friction="1 0.005 0.0001" rgba="1 0 0 1"/>
    </body>
    <camera name="camera_2" pos="-0.576544 0.019815 1.188545" fovy="60" quat="0.687152 0.161652 -0.162981 -0.689295" resolution="640 480"/>
    <body name="asset_pad" pos="0 -0.029921 0.5">
      <geom name="asset_pad_geom" type="box" size="0.05 0.05 0.007" rgba="0 0 0 1" mass="1" friction="1 0.005 0.0001" pos="-0.305027 0.089538 0.310868"/>
    </body>
    <body name="robot_1__root" pos="-0.577447 -0.092209 0.80605" quat="1 0 0 0">`;
  const taskObjectsAfterRobot = `
    </body>
    <body name="container" pos="-0.310196 -0.089869 0.807">
      <site name="container__generation_interior" pos="0 0 0.025" size="0.0325 0.0325 0.001" rgba="0 1 0 0"/>
      <geom name="container_bottom" type="box" pos="0 0 0.0025" size="0.0375 0.0375 0.0025"/>
      <geom name="container_front" type="box" pos="0 -0.035 0.0225" size="0.0375 0.0025 0.0175"/>
      <geom name="container_back" type="box" pos="0 0.035 0.0225" size="0.0375 0.0025 0.0175"/>
      <geom name="container_left" type="box" pos="-0.035 0 0.0225" size="0.0025 0.0325 0.0175"/>
      <geom name="container_right" type="box" pos="0.035 0 0.0225" size="0.0025 0.0325 0.0175"/>
    </body>`;
  const robotBody = /(<body\s+name="base")/i;
  if (!robotBody.test(mjcf)) throw new Error('SO101 robot MJCF has no base body.');
  mjcf = mjcf.replace(robotBody, `${taskObjectsBeforeRobot}\n      $1`);
  mjcf = mjcf.replace(/\s*<\/worldbody>/i, `${taskObjectsAfterRobot}\n  </worldbody>`);
  return mjcf;
}

async function ensureSo101SampleScene(
  payload: Payload,
  directory: string,
  robotMjcf: string,
  robotAssets: readonly SeedAsset[],
): Promise<void> {
  const sampleDirectory = path.resolve(directory, '../..');
  const textureAsset = await seedSampleAsset(payload, sampleDirectory, SO101_SAMPLE_ASSETS[0]);
  const sampleScenesResult = await payload.find({
    collection: 'scenes',
    depth: 0,
    limit: 100,
    where: {
      and: [
        { name: { equals: SO101_SAMPLE_SCENE_NAME } },
        { project: { exists: false } },
        { isTemplate: { equals: true } },
      ],
    },
  });
  const generatedSampleScenes = sampleScenesResult.docs.filter(
    (scene) =>
      typeof scene.mjcf === 'string' &&
      (scene.mjcf.includes('sample_table_mesh') || scene.mjcf.includes('sample_a2_texture')),
  );

  const sampleScene = generatedSampleScenes[0];
  if (sampleScene) {
    for (const generatedScene of generatedSampleScenes) {
      if (generatedScene.id === sampleScene.id) continue;
      await payload.delete({ collection: 'scenes', id: generatedScene.id });
    }
    const mjcf = buildSo101SampleMjcf(robotMjcf, robotAssets, textureAsset.asset);
    await payload.update({
      collection: 'scenes',
      id: sampleScene.id,
      data: {
        name: SO101_SAMPLE_SCENE_NAME,
        project: null,
        isTemplate: true,
        mjcf: fixSo101SamplePad(mjcf),
        assets: [...robotAssets.map((asset) => asset.id), textureAsset.asset.id],
      },
    });
    return;
  }

  const mjcf = buildSo101SampleMjcf(robotMjcf, robotAssets, textureAsset.asset);
  await payload.create({
    collection: 'scenes',
    draft: false,
    data: {
      name: SO101_SAMPLE_SCENE_NAME,
      project: null,
      isTemplate: true,
      mjcf,
      graph: { rootId: 'body:0', nodes: {}, order: [] },
      assets: [...robotAssets.map((asset) => asset.id), textureAsset.asset.id],
    },
  });
  payload.logger.info('SO101 sample scene created.');
}

async function findSo101Robot(payload: Payload): Promise<SeedRobot | null> {
  const result = await payload.find({
    collection: 'robots',
    depth: 0,
    limit: 2,
    where: { slug: { equals: SO101_SLUG } },
  });
  if (result.docs.length > 1)
    throw new Error('More than one SO101 robot record has the same slug.');
  const robot = result.docs[0];
  if (!robot || typeof robot.id !== 'number' || typeof robot.mjcf !== 'string') return null;
  return {
    id: robot.id,
    mjcf: robot.mjcf,
    meshes: Array.isArray(robot.meshes)
      ? robot.meshes.filter((mesh): mesh is number => typeof mesh === 'number')
      : [],
    tags: stringTags(robot.tags),
  };
}

export async function ensureSo101Seed(payload: Payload): Promise<void> {
  const directory = await so101Directory();
  const source = await readFile(path.join(directory, SO101_MJCF_FILENAME), 'utf8');
  const mjcf = withVirtualRobotCapability(normalizeSo101Mjcf(source), 'so101');
  const seededAssets: SeedAsset[] = [];
  let createdAssetCount = 0;

  for (const filename of SO101_MESH_FILENAMES) {
    const result = await seedAsset(payload, directory, filename);
    seededAssets.push(result.asset);
    if (result.created) createdAssetCount++;
  }

  const tags = ['so101', 'desktop-arm', 'fixed-base', SO101_SEED_TAG];
  const data = {
    name: 'SO101',
    slug: SO101_SLUG,
    description: 'SO101 six-axis desktop arm with gripper using the new calibration model.',
    manufacturer: 'TheRobotStudio / Hugging Face LeRobot',
    mjcf,
    meshes: seededAssets.map((asset) => asset.id),
    tags,
  };
  const existing = await findSo101Robot(payload);
  let robotChange = 'created';
  if (!existing) {
    await payload.create({ collection: 'robots', draft: false, data });
  } else if (
    existing.mjcf !== data.mjcf ||
    existing.meshes.join(',') !== data.meshes.join(',') ||
    existing.tags.join(',') !== data.tags.join(',')
  ) {
    await payload.update({ collection: 'robots', id: existing.id, data });
    robotChange = 'updated';
  } else {
    robotChange = 'unchanged';
  }

  payload.logger.info(
    `SO101 seed ${robotChange}; ${seededAssets.length} source meshes (${createdAssetCount} created).`,
  );
  await ensureSo101SampleScene(payload, directory, mjcf, seededAssets);
}
