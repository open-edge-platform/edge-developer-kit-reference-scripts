// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  parseTeleoperationProfileV1,
  TELEOPERATION_DEFAULT_CAPTURE_FPS,
  TELEOPERATION_DEFAULT_STREAM_HZ,
  type TeleoperationProfileV1,
} from '@mujoco-studio/types';
import type { TeleoperationSessionSummary } from '../teleoperation/sessionManager';
import type { EvaluationSessionSummary } from './sessionManager';

export interface EvaluationEpisodeSummary {
  index: number;
  active: boolean;
  step: number;
  seed: number | null;
  task: {
    success: boolean;
    terminated: boolean;
    truncated: boolean;
    reason: string | null;
  } | null;
  finished: number;
  succeeded: number;
}

export function sharedStreamProfile(profile: Record<string, unknown>): TeleoperationProfileV1 {
  const stream = { ...profile };
  for (const key of ['task', 'randomization', 'baseline', 'actionRangePolicy', 'profileId']) {
    delete stream[key];
  }
  return parseTeleoperationProfileV1({
    ...stream,
    streamHz: profile.streamHz ?? TELEOPERATION_DEFAULT_STREAM_HZ,
    captureFps: profile.captureFps ?? TELEOPERATION_DEFAULT_CAPTURE_FPS,
    captureRgb:
      profile.captureRgb ?? (Array.isArray(profile.cameras) && profile.cameras.length > 0),
  });
}

export function evaluationSessionSummary(
  session: TeleoperationSessionSummary,
): EvaluationSessionSummary {
  return {
    protocolVersion: 1,
    sessionId: session.sessionId,
    sceneId: session.sceneId,
    sceneFingerprint: session.sceneFingerprint,
    status: session.status === 'active' ? 'ready' : session.status,
    endpoints: { control: session.endpoints.control, stream: session.endpoints.stream },
    profile: session.evaluationProfile ?? {
      ...session.profile,
      baseline: { kind: 'model-default' },
      randomization: [],
      actionRangePolicy: 'clip',
    },
    pid: session.pid,
  };
}
