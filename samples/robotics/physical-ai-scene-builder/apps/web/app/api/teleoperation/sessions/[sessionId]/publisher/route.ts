// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { relayTeleoperationPublisher } from '@/lib/teleoperation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await context.params;
  return relayTeleoperationPublisher(sessionId, request);
}
