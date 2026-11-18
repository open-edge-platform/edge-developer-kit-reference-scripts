// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  refreshTeleoperationSession,
  TeleoperationSessionError,
} from '@/lib/teleoperation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sessionId } = await context.params;
    const session = await refreshTeleoperationSession(sessionId);
    return session
      ? Response.json({ episodes: session.episodes })
      : Response.json({ error: 'Teleoperation session not found.' }, { status: 404 });
  } catch (error) {
    if (error instanceof TeleoperationSessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : 'The episodes could not be loaded.' },
      { status: 500 },
    );
  }
}
