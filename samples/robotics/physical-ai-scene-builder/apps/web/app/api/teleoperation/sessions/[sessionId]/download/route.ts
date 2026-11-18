// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { requestOrigin } from '@/lib/http/requestOrigin';

import {
  teleoperationDownload,
  TeleoperationSessionError,
} from '@/lib/teleoperation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    const download = await teleoperationDownload(sessionId, request.signal, requestOrigin(request));
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
    const message =
      error instanceof Error ? error.message : 'The teleoperation samples could not be downloaded.';
    return Response.json({ error: message }, { status });
  }
}
