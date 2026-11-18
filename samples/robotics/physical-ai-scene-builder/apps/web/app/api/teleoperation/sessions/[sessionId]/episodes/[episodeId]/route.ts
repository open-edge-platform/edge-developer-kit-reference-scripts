// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  deleteTeleoperationEpisode,
  getTeleoperationEpisodeReview,
  TeleoperationSessionError,
  updateTeleoperationEpisode,
} from '@/lib/teleoperation/sessionManager';
import { TeleoperationReviewError } from '@/lib/teleoperation/reviewStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string; episodeId: string }> };

function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof TeleoperationSessionError || error instanceof TeleoperationReviewError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId, episodeId } = await context.params;
    const body = JSON.stringify(await getTeleoperationEpisodeReview(sessionId, episodeId));
    const contentLength = new TextEncoder().encode(body).byteLength;
    return new Response(body, {
      headers: {
        'Content-Length': String(contentLength),
        'Content-Type': 'application/json; charset=utf-8',
        'X-Episode-Size': String(contentLength),
      },
    });
  } catch (error) {
    return errorResponse(error, 'The teleoperation episode could not be loaded.');
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId, episodeId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Episode metadata must be valid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Episode metadata must be an object.' }, { status: 400 });
    }
    const value = body as { name?: unknown; notes?: unknown };
    const updates: { name?: string; notes?: string } = {};
    for (const key of ['name', 'notes'] as const) {
      const candidate = value[key];
      if (candidate === undefined) continue;
      if (typeof candidate !== 'string') {
        return Response.json({ error: `Episode ${key} must be a string.` }, { status: 400 });
      }
      const limit = key === 'name' ? 200 : 4_000;
      if (candidate.length > limit) {
        return Response.json(
          { error: `Episode ${key} must be ${limit} characters or fewer.` },
          { status: 400 },
        );
      }
      updates[key] = candidate;
    }
    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'Provide a name or notes update.' }, { status: 400 });
    }
    return Response.json(await updateTeleoperationEpisode(sessionId, episodeId, updates));
  } catch (error) {
    return errorResponse(error, 'The teleoperation episode could not be updated.');
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId, episodeId } = await context.params;
    return Response.json(await deleteTeleoperationEpisode(sessionId, episodeId));
  } catch (error) {
    return errorResponse(error, 'The teleoperation episode could not be deleted.');
  }
}
