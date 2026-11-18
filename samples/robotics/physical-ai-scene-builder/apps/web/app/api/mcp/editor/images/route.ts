// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { bearerToken, checkMcpOrigin } from '@/lib/mcp/http';
import { removeImage, shareImage } from '@/lib/mcp/imageJobs';

export const runtime = 'nodejs';

/** The editor user shares an image with the paired agent for image-to-3D. */
export async function POST(request: Request) {
  const denied = checkMcpOrigin(request, true);
  if (denied) return denied;
  try {
    const image = (await request.formData()).get('image');
    if (!(image instanceof File)) throw new Error('Choose a PNG, JPEG, or WebP image.');
    return Response.json(shareImage(bearerToken(request), image, 'editor'));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not share the image.' },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const denied = checkMcpOrigin(request, true);
  if (denied) return denied;
  try {
    removeImage(bearerToken(request), new URL(request.url).searchParams.get('id') ?? '');
    return new Response(null, { status: 204 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not remove the image.' },
      { status: 400 },
    );
  }
}
