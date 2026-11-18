// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Read-only review of episodes in any scene version (no running session needed). */
import {
  getTeleoperationEpisode,
  getTeleoperationVideo,
  TeleoperationReviewError,
} from './reviewStore';
import { SceneVersionError, storedCollection, versionEpisode } from './sceneVersions';
import { TeleoperationSessionError } from './sessionManager';

export async function versionEpisodeReview(collectionId: string, episodeId: string) {
  const collection = await storedCollection(collectionId);
  return getTeleoperationEpisode(collection.directory, versionEpisode(collection, episodeId));
}

export async function versionEpisodeVideo(
  collectionId: string,
  episodeId: string,
  cameraName: string,
) {
  const collection = await storedCollection(collectionId);
  return getTeleoperationVideo(
    collection.directory,
    versionEpisode(collection, episodeId),
    cameraName,
  );
}

/** JSON error response for scene version routes. */
export function versionErrorResponse(error: unknown, fallback: string): Response {
  if (
    error instanceof SceneVersionError ||
    error instanceof TeleoperationReviewError ||
    error instanceof TeleoperationSessionError
  ) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}
