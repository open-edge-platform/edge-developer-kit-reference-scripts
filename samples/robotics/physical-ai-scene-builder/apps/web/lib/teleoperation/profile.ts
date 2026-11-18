// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { RuntimeFile } from '@mujoco-studio/mujoco';
import {
  TELEOPERATION_DEFAULT_CAPTURE_FPS,
  TELEOPERATION_DEFAULT_STREAM_HZ,
  type TeleoperationProfileV1,
} from '@mujoco-studio/types';

import { backdropProfile } from '../editor/backdropProfile';

/**
 * The Generate session profile for the scene as shown, without the per-request source
 * randomization and render budget. The panel prepares sessions from it and checks the running
 * session against it, so the two can never disagree (for example about the splat backdrop).
 */
export function generationSessionProfile({
  sceneName,
  sceneId,
  sceneFingerprint,
  template,
  runtimeFiles,
  backdropBody,
}: {
  sceneName: string;
  sceneId: number;
  sceneFingerprint: string;
  template: Pick<TeleoperationProfileV1, 'inputConvention' | 'state' | 'action' | 'cameras'>;
  runtimeFiles: readonly RuntimeFile[];
  backdropBody: string | null;
}): TeleoperationProfileV1 {
  return {
    version: 1,
    name: sceneName,
    sceneId: String(sceneId),
    sceneFingerprint,
    inputConvention: template.inputConvention,
    state: [...template.state],
    action: [...template.action],
    cameras: [...template.cameras],
    physicsSteps: 1,
    streamHz: TELEOPERATION_DEFAULT_STREAM_HZ,
    captureRgb: template.cameras.length > 0,
    captureFps: TELEOPERATION_DEFAULT_CAPTURE_FPS,
    ...backdropProfile(runtimeFiles, backdropBody),
  };
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function teleoperationCaptureSignature(
  profile: Pick<TeleoperationProfileV1, 'captureRgb' | 'cameras' | 'backdrop'>,
): string {
  const cameras = profile.cameras
    .map(({ camera, outputName, width, height }) => ({ camera, outputName, width, height }))
    .sort((left, right) => left.outputName.localeCompare(right.outputName));
  return JSON.stringify({
    captureRgb: profile.captureRgb,
    cameras,
    ...(profile.backdrop ? { backdrop: profile.backdrop } : {}),
  });
}

export function teleoperationProfilesMatch(
  existing: TeleoperationProfileV1,
  requested: TeleoperationProfileV1 | Record<string, unknown>,
): boolean {
  const requestedProfile = requested as Record<string, unknown>;
  return (
    existing.version === requestedProfile.version &&
    existing.name === requestedProfile.name &&
    existing.sceneId === requestedProfile.sceneId &&
    existing.sceneFingerprint === requestedProfile.sceneFingerprint &&
    existing.physicsSteps === requestedProfile.physicsSteps &&
    existing.streamHz === requestedProfile.streamHz &&
    (existing.captureFps ?? TELEOPERATION_DEFAULT_CAPTURE_FPS) ===
      (requestedProfile.captureFps ?? TELEOPERATION_DEFAULT_CAPTURE_FPS) &&
    existing.inputConvention === requestedProfile.inputConvention &&
    existing.captureRgb === requestedProfile.captureRgb &&
    sameJsonValue(existing.state, requestedProfile.state) &&
    sameJsonValue(existing.action, requestedProfile.action) &&
    sameJsonValue(existing.cameras, requestedProfile.cameras) &&
    sameJsonValue(existing.backdrop ?? null, requestedProfile.backdrop ?? null)
  );
}
