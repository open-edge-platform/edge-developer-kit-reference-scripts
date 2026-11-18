// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { dataPath } from '@mujoco-studio/payload/storage';

import { conversionWorkDirectory } from '@/lib/process/obj2mjcf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ assetId: string; name: string }> };

const CONTENT_TYPES: Record<string, string> = {
  obj: 'text/plain; charset=utf-8',
  mtl: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

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

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { assetId, name } = await context.params;
  const filename = safeBasename(name);
  if (!/^[a-zA-Z0-9_-]+$/.test(assetId) || !filename) {
    return Response.json({ errors: [{ message: 'Invalid file reference.' }] }, { status: 400 });
  }

  const workDirectory = await conversionWorkDirectory(dataPath('imageto3D', assetId));
  if (!workDirectory) {
    return Response.json({ errors: [{ message: 'Converted object not found.' }] }, { status: 404 });
  }

  const filePath = path.join(/* turbopackIgnore: true */ workDirectory, filename);
  const fileStat = await stat(/* turbopackIgnore: true */ filePath).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!fileStat || !fileStat.isFile()) {
    return Response.json({ errors: [{ message: 'File not found.' }] }, { status: 404 });
  }

  const bytes = await readFile(/* turbopackIgnore: true */ filePath);
  const extension = filename.split('.').at(-1)?.toLowerCase() ?? '';
  return new Response(bytes, {
    headers: {
      'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      ETag: `${assetId}-${filename}-${fileStat.size}`,
    },
  });
}
