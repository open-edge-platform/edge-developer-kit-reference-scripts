// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { authenticateAgent } from '@/lib/mcp/bridge';
import { bearerToken, checkMcpOrigin } from '@/lib/mcp/http';
import { handleMcpRequest } from '@/lib/mcp/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const denied = checkMcpOrigin(request);
  if (denied) return denied;
  const editorToken = authenticateAgent(bearerToken(request));
  if (!editorToken) {
    return Response.json(
      {
        error:
          'Enable MCP in the scene editor and use its Bearer token. Keep the browser tab open.',
      },
      { status: 401 },
    );
  }
  return handleMcpRequest(request, editorToken);
}

export function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
