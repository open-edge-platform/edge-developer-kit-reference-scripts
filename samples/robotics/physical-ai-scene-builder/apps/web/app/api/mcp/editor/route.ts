// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';

import { connectEditor, disconnect, pollEditor, setExposedTools } from '@/lib/mcp/bridge';
import { exposedToolsSchema } from '@/lib/mcp/contracts';
import { listImageJobs, listImages } from '@/lib/mcp/imageJobs';
import { bearerToken, checkMcpOrigin } from '@/lib/mcp/http';

export const runtime = 'nodejs';

const pollSchema = z.object({
  completion: z
    .object({
      id: z.string().uuid(),
      result: z.object({ data: z.unknown().optional(), error: z.string().max(10000).optional() }),
    })
    .optional(),
});
const toolsSchema = z.object({ tools: exposedToolsSchema });

export async function POST(request: Request) {
  const denied = checkMcpOrigin(request, true);
  if (denied) return denied;
  try {
    if (!request.headers.has('authorization')) {
      const body = toolsSchema.partial().safeParse(await request.json().catch(() => ({})));
      if (!body.success) return Response.json({ error: 'Invalid MCP tools.' }, { status: 400 });
      return Response.json(connectEditor(body.data.tools), {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    const body = pollSchema.safeParse(await request.json());
    if (!body.success) return Response.json({ error: 'Invalid editor poll.' }, { status: 400 });
    const editorToken = bearerToken(request);
    return Response.json(
      {
        command: pollEditor(editorToken, body.data.completion),
        images: listImages(editorToken),
        jobs: listImageJobs(editorToken),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'MCP bridge failed.' },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const denied = checkMcpOrigin(request, true);
  if (denied) return denied;
  const body = toolsSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: 'Invalid MCP tools.' }, { status: 400 });
  try {
    setExposedTools(bearerToken(request), body.data.tools);
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'MCP bridge failed.' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const denied = checkMcpOrigin(request, true);
  if (denied) return denied;
  disconnect(bearerToken(request));
  return new Response(null, { status: 204 });
}
