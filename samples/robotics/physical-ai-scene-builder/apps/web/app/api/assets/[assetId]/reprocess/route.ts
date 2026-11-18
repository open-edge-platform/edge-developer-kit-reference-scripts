// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import config from '@payload-config';
import { getPayload } from 'payload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ assetId: string }> };

function errorResponse(error: unknown, status = 500): Response {
  return Response.json(
    {
      errors: [
        {
          message: error instanceof Error ? error.message : 'The mesh could not be reprocessed.',
        },
      ],
    },
    { status },
  );
}

function assetIdValue(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function sourceFilename(value: unknown): string | null {
  if (typeof value !== 'string' || !value || path.basename(value) !== value) return null;
  return value;
}

function sourceMimeType(filename: string, value: unknown): string {
  if (typeof value === 'string' && value) return value;
  const extension = filename.split('.').at(-1)?.toLowerCase();
  if (extension === 'glb') return 'model/gltf-binary';
  if (extension === 'obj') return 'model/obj';
  return 'model/stl';
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { assetId: rawAssetId } = await context.params;
    const id = assetIdValue(rawAssetId);
    if (id === null) return errorResponse(new Error('Asset id is invalid.'), 400);

    const payload = await getPayload({ config });
    const asset = await payload.findByID({ collection: 'assets', id, depth: 0 });
    if (asset.kind !== 'mesh' || asset.primitive?.type || asset.customSource) {
      return errorResponse(new Error('Only uploaded mesh assets can be reprocessed.'), 409);
    }
    if (asset.processingStatus !== 'failed' && asset.processingStatus !== 'ready') {
      return errorResponse(new Error('Only failed or ready mesh assets can be reprocessed.'), 409);
    }

    const filename = sourceFilename(asset.filename);
    if (!filename) return errorResponse(new Error('The asset has no source file.'), 422);
    const upload = payload.collections.assets.config.upload;
    if (!upload || typeof upload.staticDir !== 'string') {
      return errorResponse(new Error('Asset upload storage is not configured.'));
    }
    const bytes = await readFile(
      /* turbopackIgnore: true */ path.resolve(upload.staticDir, filename),
    );
    const metadata = asset.metadata;
    const updated = await payload.update({
      collection: 'assets',
      id,
      data: {
        kind: 'mesh',
        ...(asset.category ? { category: asset.category } : {}),
        metadata: {
          unit: metadata?.unit ?? 'm',
          upAxis: metadata?.upAxis ?? undefined,
          collisionStrategy: metadata?.collisionStrategy ?? 'box',
        },
        processingStatus: 'uploaded',
        processingProgress: 0,
        processingError: null,
      },
      file: {
        data: bytes,
        mimetype: sourceMimeType(filename, asset.mimeType),
        name: filename,
        size: bytes.byteLength,
      },
    });
    return Response.json({ doc: updated, message: 'Asset reprocessed successfully.' });
  } catch (error) {
    if (error instanceof Error && 'status' in error && typeof error.status === 'number') {
      return errorResponse(error, error.status);
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return errorResponse(new Error('The asset source file is missing.'), 422);
    }
    return errorResponse(error);
  }
}
