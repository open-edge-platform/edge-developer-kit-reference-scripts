// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { authenticateAgent, exposedTools } from '@/lib/mcp/bridge';
import { importDataset } from '@/lib/mcp/datasets';
import { bearerToken, checkMcpOrigin } from '@/lib/mcp/http';

export const runtime = 'nodejs';

/**
 * Lets an agent with a shell upload a LeRobot v3 recording (a zip as the raw request body) using
 * its MCP token, because MCP tool arguments cannot carry files. Allowed while list_datasets is exposed.
 */
export async function POST(request: Request) {
  const denied = checkMcpOrigin(request);
  if (denied) return denied;
  const editorToken = authenticateAgent(bearerToken(request));
  if (!editorToken) {
    return Response.json(
      { error: 'Enable MCP in the scene editor and use its Bearer token.' },
      { status: 401 },
    );
  }
  if (!exposedTools(editorToken).has('list_datasets')) {
    return Response.json(
      { error: 'Datasets are not exposed to agents. Ask the user to expose list_datasets.' },
      { status: 403 },
    );
  }
  try {
    return Response.json(
      await importDataset(editorToken, {
        body: request.body,
        name: request.headers.get('x-dataset-name') ?? 'dataset.zip',
        source: 'agent',
        signal: request.signal,
      }),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not import the dataset.' },
      { status: 400 },
    );
  }
}
