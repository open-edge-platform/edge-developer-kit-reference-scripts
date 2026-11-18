// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import { EvaluationSessionError, getEvaluationScene } from '@/lib/evaluation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const scene = await getEvaluationScene((await context.params).sessionId);
    const stream = createReadStream(scene.scenePath);
    const abort = () => stream.destroy();
    request.signal.addEventListener('abort', abort, { once: true });
    stream.once('close', () => request.signal.removeEventListener('abort', abort));
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${scene.filename}"`,
        'Content-Length': String(scene.size),
        'X-Evaluation-Profile': encodeURIComponent(JSON.stringify(scene.profile)),
      },
    });
  } catch (error) {
    const status = error instanceof EvaluationSessionError ? error.status : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : 'Evaluation scene unavailable.' },
      { status },
    );
  }
}
