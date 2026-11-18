// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { listSceneVersions } from '@/lib/teleoperation/sceneVersions';
import { versionErrorResponse } from '@/lib/teleoperation/versionReview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sceneId: string }> };

/** Generate data versions of a saved scene; `?current=` names the version Generate has open. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { sceneId } = await context.params;
    const current = new URL(request.url).searchParams.get('current');
    return Response.json({ versions: await listSceneVersions(sceneId, current) });
  } catch (error) {
    return versionErrorResponse(error, 'The scene versions could not be listed.');
  }
}
