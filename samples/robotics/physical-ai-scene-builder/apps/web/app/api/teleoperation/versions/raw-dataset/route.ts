// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import {
  cancelVersionDataset,
  parseVersionList,
  prepareVersionDataset,
  versionDatasetDownload,
  versionDatasetPreparation,
} from '@/lib/teleoperation/versionDatasets';
import { versionErrorResponse } from '@/lib/teleoperation/versionReview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Raw dataset of one or more scene versions: `?versions=<first>,<more>`. The first version's
 * recording settings, scene, and episode order come first; later versions must be compatible.
 */
function versions(request: Request): string[] {
  return parseVersionList(new URL(request.url).searchParams.get('versions'));
}

export async function GET(request: Request): Promise<Response> {
  try {
    const ids = versions(request);
    if (new URL(request.url).searchParams.has('status')) {
      return Response.json(versionDatasetPreparation(ids));
    }
    const download = await versionDatasetDownload(ids);
    const file = createReadStream(download.archivePath);
    const abort = () => file.destroy();
    request.signal.addEventListener('abort', abort, { once: true });
    file.once('close', () => request.signal.removeEventListener('abort', abort));
    return new Response(Readable.toWeb(file) as ReadableStream<Uint8Array>, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${download.filename}"`,
        'Content-Length': String(download.size),
        'Content-Type': 'application/zip',
      },
    });
  } catch (error) {
    return versionErrorResponse(error, 'The raw dataset could not be downloaded.');
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return Response.json(await prepareVersionDataset(versions(request)), { status: 202 });
  } catch (error) {
    return versionErrorResponse(error, 'The raw dataset could not be prepared.');
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    return Response.json(await cancelVersionDataset(versions(request)));
  } catch (error) {
    return versionErrorResponse(error, 'The raw dataset preparation could not be cancelled.');
  }
}
