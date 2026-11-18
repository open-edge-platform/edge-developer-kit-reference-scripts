// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { authenticateAgent, exposedTools } from '@/lib/mcp/bridge';
import { bearerToken, checkMcpOrigin } from '@/lib/mcp/http';
import { shareImage } from '@/lib/mcp/imageJobs';

export const runtime = 'nodejs';

/**
 * Lets an agent with a shell upload an image (multipart field `image`) using its MCP token,
 * because MCP tool arguments cannot carry image bytes. Allowed only while generation is exposed.
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
  if (!exposedTools(editorToken).has('start_image_to_3d')) {
    return Response.json(
      { error: 'Image-to-3D is not exposed to agents. Ask the user to expose start_image_to_3d.' },
      { status: 403 },
    );
  }
  try {
    const image = (await request.formData()).get('image');
    if (!(image instanceof File)) throw new Error('Upload the image as multipart field "image".');
    return Response.json(shareImage(editorToken, image, 'agent'));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not upload the image.' },
      { status: 400 },
    );
  }
}
