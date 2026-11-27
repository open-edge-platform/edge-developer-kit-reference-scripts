// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { dataPath } from '@mujoco-studio/payload/storage';

import { Obj2MjcfError, runObj2Mjcf } from '@/lib/process/obj2mjcf';
import { saveObjectModelAsset } from '@/lib/process/objectModelAsset';
import { resolveGlb2ObjRunner } from '@/lib/process/pythonWorkerProcess';
import { runOneShotProcess } from '@/lib/process/runOneShotProcess';
import { requestTrellis } from '@/lib/process/trellisRequest';
import { trellisApiUrl } from '@/lib/process/trellisService';
import {
  objectModelAssetName,
  type ImageTo3dEvent,
  type ImageTo3dPipelineType,
} from '@/lib/scenes/imageTo3dApi';
import { glb2objPath, integrationPath } from './integrationPaths';

const GLB2OBJ_TIMEOUT_MS = 120_000;

export function trellisTimeoutMs(): number {
  const timeoutMs = Number(process.env.ROBOTIC_STUDIO_TRELLIS_TIMEOUT_MS ?? 600_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error(
      'ROBOTIC_STUDIO_TRELLIS_TIMEOUT_MS must be a positive timeout in milliseconds.',
    );
  }
  return timeoutMs;
}

async function assetDirectory(id: string): Promise<string> {
  const directory = dataPath('imageto3D', id);
  await mkdir(directory, { recursive: true });
  return directory;
}

/** FastAPI errors are `{"detail": "..."}`; fall back to the raw body for anything else. */
async function trellisErrorDetail(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return text || response.statusText || 'unknown error';
}

export interface ImageTo3dResult {
  assetId: string;
  mjcf: string;
  files: string[];
  libraryAssetId: number | null;
}

/**
 * Runs TRELLIS.2, glb2obj, and obj2mjcf for one validated image, saving the result under
 * `data/imageto3D/<assetId>` and to the asset library. Generated files are removed on failure.
 */
export async function runImageTo3d({
  image: imageFile,
  pipelineType,
  timeoutMs,
  signal,
  send,
}: {
  image: File;
  pipelineType: ImageTo3dPipelineType;
  timeoutMs: number;
  signal: AbortSignal;
  send: (event: Exclude<ImageTo3dEvent, { type: 'result' | 'error' }>) => void;
}): Promise<ImageTo3dResult> {
  const assetId = randomUUID();
  const directory = dataPath('imageto3D', assetId);
  try {
    await assetDirectory(assetId);
    signal.throwIfAborted();
    const glbPath = path.join(directory, 'source.glb');
    const objPath = path.join(directory, 'model.obj');

    send({ type: 'stage', stage: 'generating', label: 'Generating 3D model with TRELLIS.2…' });
    const trellisForm = new FormData();
    trellisForm.append('image', imageFile, imageFile.name || 'image');
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), timeoutMs);
    let trellisResponse: Response;
    try {
      trellisResponse = await requestTrellis(
        `${trellisApiUrl()}/generate?pipeline_type=${encodeURIComponent(pipelineType)}`,
        trellisForm,
        AbortSignal.any([signal, abort.signal]),
      );
      if (!trellisResponse.ok) {
        throw new Obj2MjcfError(
          `TRELLIS.2 could not generate a 3D model: ${await trellisErrorDetail(trellisResponse)}`,
          422,
        );
      }
      await writeFile(glbPath, new Uint8Array(await trellisResponse.arrayBuffer()));
    } catch (error) {
      if (error instanceof Obj2MjcfError || signal.aborted) throw error;
      if (abort.signal.aborted) {
        throw new Obj2MjcfError('TRELLIS.2 took too long to generate a 3D model. Try again.', 504);
      }
      throw new Obj2MjcfError(
        `TRELLIS.2 request failed at ${trellisApiUrl()}: ${error instanceof Error ? error.message : String(error)}`,
        502,
      );
    } finally {
      clearTimeout(timeout);
    }

    send({ type: 'stage', stage: 'converting-mesh', label: 'Converting mesh with glb2obj…' });
    const glb2objRunner = resolveGlb2ObjRunner(glb2objPath());
    const glb2objResult = await runOneShotProcess(
      glb2objRunner.command,
      [
        ...glb2objRunner.args,
        path.join(glb2objPath(), 'convert.py'),
        glbPath,
        objPath,
        '--simulation-ready',
      ],
      {
        cwd: glb2objPath(),
        timeoutMs: GLB2OBJ_TIMEOUT_MS,
        signal,
        onOutput: (_stream, line) => send({ type: 'log', line }),
      },
    );
    if (glb2objResult.code !== 0) {
      throw new Obj2MjcfError(
        `glb2obj could not convert the generated model: ${
          glb2objResult.stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) || 'unknown error'
        }`,
        422,
      );
    }

    send({
      type: 'stage',
      stage: 'converting-mjcf',
      label: 'Converting to MJCF with obj2mjcf…',
    });
    const { mjcf, files } = await runObj2Mjcf(
      directory,
      integrationPath(),
      (line) => send({ type: 'log', line }),
      signal,
      true,
    );
    signal.throwIfAborted();
    // Saving to the library lets the object be placed again without regenerating it; the
    // generated files stay usable for this placement even if saving fails.
    let libraryAssetId: number | null = null;
    try {
      libraryAssetId = await saveObjectModelAsset({
        bundleId: assetId,
        name: objectModelAssetName(imageFile.name),
        conversion: { mjcf, files },
        preview: new Uint8Array(await imageFile.arrayBuffer()),
        tags: ['image-to-3d'],
      });
    } catch (error) {
      send({
        type: 'log',
        line: `Warning: the object was not saved to the asset library: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    return { assetId, mjcf, files, libraryAssetId };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
