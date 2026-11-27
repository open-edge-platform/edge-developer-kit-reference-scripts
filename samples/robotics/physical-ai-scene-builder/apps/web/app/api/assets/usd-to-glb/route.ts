// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { dataPath } from '@mujoco-studio/payload/storage';

import { integrationPath } from '@/lib/process/integrationPaths';
import { resolvePythonRunner } from '@/lib/process/pythonWorkerProcess';
import { runOneShotProcess } from '@/lib/process/runOneShotProcess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const USD_EXTENSION = /\.(usd|usda|usdc|usdz)$/i;

function errorResponse(message: string, status = 400): Response {
  return Response.json({ errors: [{ message }] }, { status });
}

/**
 * Converts one uploaded USD/USDZ file into a Y-up, metre-scaled GLB (`robotic_studio.usd_import`)
 * and returns its bytes, so the browser can feed it through the normal mesh upload. Conversion
 * metadata (bounds, UsdPhysics mass/friction, warnings) travels in the `X-Usd-Import` header.
 */
export async function POST(request: Request): Promise<Response> {
  const directory = dataPath('usd-import', randomUUID());
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !USD_EXTENSION.test(file.name)) {
      return errorResponse('Choose a USD, USDA, USDC, or USDZ file.');
    }
    if (file.size > MAX_FILE_BYTES) return errorResponse('Choose a file smaller than 200 MB.');

    await mkdir(directory, { recursive: true });
    // The upload's own name is never used as a path: only its extension selects the USD format.
    const extension = path.extname(file.name).toLowerCase();
    const input = path.join(directory, `asset${extension}`);
    const output = path.join(directory, 'asset.glb');
    await writeFile(input, new Uint8Array(await file.arrayBuffer()));

    const runner = resolvePythonRunner(integrationPath(), 'usd');
    const result = await runOneShotProcess(
      runner.command,
      [...runner.args, '-m', 'robotic_studio.usd_import', input, output],
      { cwd: integrationPath(), timeoutMs: 120_000, signal: request.signal },
    );
    if (result.code !== 0) {
      const detail = result.stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) || 'unknown error';
      return errorResponse(`This USD asset could not be converted: ${detail}`, 422);
    }
    const glb = await readFile(output);
    const info = result.stdout.trim().split(/\r?\n/).at(-1) ?? '{}';
    return new Response(new Uint8Array(glb), {
      headers: {
        'Content-Type': 'model/gltf-binary',
        'X-Usd-Import': encodeURIComponent(info),
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
