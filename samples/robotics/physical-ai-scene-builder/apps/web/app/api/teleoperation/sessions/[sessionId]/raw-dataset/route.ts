// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import {
  cancelTeleoperationRawDataset,
  getTeleoperationRawDatasetDownload,
  getTeleoperationRawDatasetPreparation,
  prepareTeleoperationRawDataset,
  TeleoperationSessionError,
} from '@/lib/teleoperation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    if (new URL(request.url).searchParams.has('status')) {
      return Response.json(await getTeleoperationRawDatasetPreparation(sessionId));
    }
    const download = await getTeleoperationRawDatasetDownload(sessionId);
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
    const status = error instanceof TeleoperationSessionError ? error.status : 500;
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'The raw dataset could not be downloaded.',
      },
      { status },
    );
  }
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    return Response.json(await prepareTeleoperationRawDataset(sessionId), { status: 202 });
  } catch (error) {
    const status = error instanceof TeleoperationSessionError ? error.status : 500;
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'The raw dataset could not be prepared.',
      },
      { status },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    return Response.json(await cancelTeleoperationRawDataset(sessionId));
  } catch (error) {
    const status = error instanceof TeleoperationSessionError ? error.status : 500;
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'The raw dataset preparation could not be cancelled.',
      },
      { status },
    );
  }
}
