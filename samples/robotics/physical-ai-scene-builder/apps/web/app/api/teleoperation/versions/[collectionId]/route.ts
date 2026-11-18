// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { deleteSceneVersion, sceneVersionDetail } from '@/lib/teleoperation/sceneVersions';
import { teleoperationCollectionInUse } from '@/lib/teleoperation/sessionManager';
import { forgetVersionDatasets } from '@/lib/teleoperation/versionDatasets';
import { versionErrorResponse } from '@/lib/teleoperation/versionReview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ collectionId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { collectionId } = await context.params;
    return Response.json(await sceneVersionDetail(collectionId));
  } catch (error) {
    return versionErrorResponse(error, 'The scene version could not be loaded.');
  }
}

/** Deletes an earlier version's generated scenes and recorded episodes. */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { collectionId } = await context.params;
    forgetVersionDatasets(collectionId);
    await deleteSceneVersion(collectionId, teleoperationCollectionInUse);
    return Response.json({ deleted: true });
  } catch (error) {
    return versionErrorResponse(error, 'The scene version could not be deleted.');
  }
}
