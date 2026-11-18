// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  discardTeleoperationRecording,
  saveTeleoperationRecording,
  startTeleoperationRecording,
  stopTeleoperationRecording,
  TeleoperationSessionError,
} from '@/lib/teleoperation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof TeleoperationSessionError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    return Response.json(await startTeleoperationRecording(sessionId));
  } catch (error) {
    return errorResponse(error, 'The teleoperation recording could not be started.');
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new TeleoperationSessionError('Recording action must be valid JSON.', 400);
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      ((body as { action?: unknown }).action !== 'stop' &&
        (body as { action?: unknown }).action !== 'save' &&
        (body as { action?: unknown }).action !== 'discard')
    ) {
      throw new TeleoperationSessionError(
        "Recording action must be 'stop', 'save', or 'discard'.",
        400,
      );
    }
    return Response.json(
      (body as { action: 'stop' | 'discard' }).action === 'stop'
        ? await stopTeleoperationRecording(sessionId)
        : (body as { action: 'stop' | 'save' | 'discard' }).action === 'save'
          ? await saveTeleoperationRecording(sessionId)
          : await discardTeleoperationRecording(sessionId),
    );
  } catch (error) {
    return errorResponse(error, 'The teleoperation recording could not be updated.');
  }
}
