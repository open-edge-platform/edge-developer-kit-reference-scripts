// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { relayEvaluationCommand } from '@/lib/evaluation/sessionManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  const { sessionId } = await context.params;
  return relayEvaluationCommand(sessionId, request);
}
