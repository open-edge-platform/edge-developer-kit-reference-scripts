// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import {
  getTeleoperationSceneBundle,
  TeleoperationSessionError,
} from '@/lib/teleoperation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    const bundle = await getTeleoperationSceneBundle(sessionId);
    const file = createReadStream(bundle.scenePath);
    const abort = () => file.destroy();
    request.signal.addEventListener('abort', abort, { once: true });
    file.once('close', () => request.signal.removeEventListener('abort', abort));
    return new Response(Readable.toWeb(file) as ReadableStream<Uint8Array>, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${bundle.filename}"`,
        'Content-Length': String(bundle.size),
        'Content-Type': 'application/octet-stream',
      },
    });
  } catch (error) {
    const status = error instanceof TeleoperationSessionError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : 'The teleoperation scene bundle could not be read.';
    return Response.json({ error: message }, { status });
  }
}
