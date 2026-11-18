// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { availableParallelism } from 'node:os';

import { maxBatchWorkers, parseTeleoperationBatchRequest } from '@/lib/teleoperation/batchRequest';
import {
  cancelTeleoperationBatch,
  getTeleoperationBatch,
  startTeleoperationBatch,
  TeleoperationSessionError,
} from '@/lib/teleoperation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

function errorResponse(error: unknown): Response {
  if (error instanceof TeleoperationSessionError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : 'Batch request failed.' },
    { status: 500 },
  );
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    return Response.json(await getTeleoperationBatch((await context.params).sessionId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Batch settings must be valid JSON.' }, { status: 400 });
  }
  const parsed = parseTeleoperationBatchRequest(body, maxBatchWorkers(availableParallelism()));
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    return Response.json(
      await startTeleoperationBatch((await context.params).sessionId, parsed.value),
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    return Response.json(await cancelTeleoperationBatch((await context.params).sessionId));
  } catch (error) {
    return errorResponse(error);
  }
}
