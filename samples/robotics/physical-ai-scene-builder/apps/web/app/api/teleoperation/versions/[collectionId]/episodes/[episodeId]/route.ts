// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { versionEpisodeReview, versionErrorResponse } from '@/lib/teleoperation/versionReview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ collectionId: string; episodeId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { collectionId, episodeId } = await context.params;
    const body = JSON.stringify(await versionEpisodeReview(collectionId, episodeId));
    const contentLength = new TextEncoder().encode(body).byteLength;
    return new Response(body, {
      headers: {
        'Content-Length': String(contentLength),
        'Content-Type': 'application/json; charset=utf-8',
        'X-Episode-Size': String(contentLength),
      },
    });
  } catch (error) {
    return versionErrorResponse(error, 'The episode could not be loaded.');
  }
}
