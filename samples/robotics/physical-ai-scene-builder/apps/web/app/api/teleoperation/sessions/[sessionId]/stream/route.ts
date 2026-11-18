// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { proxyNativeStream } from '@/lib/process/nativeStreamProxy';
import { getTeleoperationSession } from '@/lib/teleoperation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { sessionId } = await context.params;
  const session = getTeleoperationSession(sessionId);
  if (!session) {
    return Response.json({ error: 'Teleoperation session not found.' }, { status: 404 });
  }
  return proxyNativeStream(request, session.endpoints.stream, 'teleoperation');
}
