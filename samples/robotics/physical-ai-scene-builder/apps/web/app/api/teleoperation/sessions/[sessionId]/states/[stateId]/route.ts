// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  deleteTeleoperationState,
  selectTeleoperationState,
  TeleoperationSessionError,
} from '@/lib/teleoperation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string; stateId: string }> };

function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof TeleoperationSessionError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

export async function PUT(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId, stateId } = await context.params;
    return Response.json(await selectTeleoperationState(sessionId, stateId));
  } catch (error) {
    return errorResponse(error, 'The randomized state could not be selected.');
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId, stateId } = await context.params;
    return Response.json(await deleteTeleoperationState(sessionId, stateId));
  } catch (error) {
    return errorResponse(error, 'The randomized state could not be deleted.');
  }
}
