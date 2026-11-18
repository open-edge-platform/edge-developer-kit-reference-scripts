// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  configureTeleoperationEvaluation,
  endTeleoperationSession,
  getTeleoperationSceneBundle,
  getTeleoperationSession,
  MAX_TELEOPERATION_SCENE_BUNDLE_BYTES,
  onTeleoperationSessionEnded,
  onTeleoperationStreamStopped,
  relaySharedEvaluationCommand,
  startTeleoperationSession,
  TeleoperationSessionError,
} from '../teleoperation/sessionManager';
import { teleoperationProfilesMatch } from '../teleoperation/profile';
import { evaluationSessionSummary, sharedStreamProfile } from './sharedSession';

export const MAX_EVALUATION_SCENE_BUNDLE_BYTES = MAX_TELEOPERATION_SCENE_BUNDLE_BYTES;

export interface CreateEvaluationSessionInput {
  sceneBundlePath: string;
  profile: Record<string, unknown>;
}

export interface EvaluationEndpointsV1 {
  control: string;
  stream: string;
}

export interface EvaluationSessionSummary {
  protocolVersion: 1;
  sessionId: string;
  sceneId: string;
  sceneFingerprint: string;
  status: 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
  endpoints: EvaluationEndpointsV1;
  profile: Record<string, unknown>;
  pid: number | null;
}

export interface EvaluationSceneFile {
  scenePath: string;
  profile: Record<string, unknown>;
  filename: string;
  size: number;
}

export class EvaluationSessionError extends TeleoperationSessionError {}

export async function getEvaluationScene(sessionId: string): Promise<EvaluationSceneFile> {
  const session = getEvaluationSession(sessionId);
  if (!session) throw new EvaluationSessionError('Evaluation scene is unavailable.', 404);
  return { ...(await getTeleoperationSceneBundle(sessionId)), profile: session.profile };
}

export function onEvaluationSessionEnded(
  name: string,
  listener: (sessionId: string) => Promise<void>,
): void {
  onTeleoperationSessionEnded(name, listener);
}

export function onEvaluationStreamStopped(
  name: string,
  listener: (sessionId: string) => Promise<void>,
): void {
  onTeleoperationStreamStopped(name, listener);
}

export const relayEvaluationCommand = relaySharedEvaluationCommand;

export async function startEvaluationSession(
  input: CreateEvaluationSessionInput,
): Promise<EvaluationSessionSummary> {
  const profile = sharedStreamProfile(input.profile);
  const existing = getTeleoperationSession();
  if (existing && !teleoperationProfilesMatch(existing.profile, profile)) {
    throw new EvaluationSessionError(
      'Stop the shared stream before changing its scene or profile.',
      409,
    );
  }
  const session =
    existing ??
    (await startTeleoperationSession({
      sceneBundlePath: input.sceneBundlePath,
      profile,
    }));
  return evaluationSessionSummary(
    await configureTeleoperationEvaluation(session.sessionId, input.profile),
  );
}

export async function configureEvaluationSession(
  sessionId: string,
  profile: Record<string, unknown>,
): Promise<EvaluationSessionSummary> {
  return evaluationSessionSummary(await configureTeleoperationEvaluation(sessionId, profile));
}

export function getEvaluationSession(sessionId?: string): EvaluationSessionSummary | null {
  const session = getTeleoperationSession(sessionId);
  return session ? evaluationSessionSummary(session) : null;
}

export async function endEvaluationSession(
  sessionId?: string,
): Promise<EvaluationSessionSummary | null> {
  const session = await endTeleoperationSession(sessionId);
  return session ? evaluationSessionSummary(session) : null;
}
