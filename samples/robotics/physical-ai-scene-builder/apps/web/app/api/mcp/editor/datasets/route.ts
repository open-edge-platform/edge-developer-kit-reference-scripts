// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';

import { importDataset, removeDataset } from '@/lib/mcp/datasets';
import { bearerToken, checkMcpOrigin } from '@/lib/mcp/http';

export const runtime = 'nodejs';

/** The editor user shares a LeRobot v3 recording (a zip as the raw request body) with the agent. */
export async function POST(request: Request) {
  const denied = checkMcpOrigin(request, true);
  if (denied) return denied;
  try {
    return Response.json(
      await importDataset(bearerToken(request), {
        body: request.body,
        name: decodeURIComponent(request.headers.get('x-dataset-name') ?? 'dataset.zip'),
        source: 'editor',
        signal: request.signal,
      }),
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not share the dataset.' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const denied = checkMcpOrigin(request, true);
  if (denied) return denied;
  const body = z
    .object({ id: z.string().uuid() })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: 'Invalid dataset id.' }, { status: 400 });
  try {
    await removeDataset(bearerToken(request), body.data.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not remove the dataset.' },
      { status: 400 },
    );
  }
}
