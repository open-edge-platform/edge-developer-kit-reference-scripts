// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { relayTeleoperationCommand } from '@/lib/teleoperation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await context.params;
  return relayTeleoperationCommand(sessionId, request);
}
