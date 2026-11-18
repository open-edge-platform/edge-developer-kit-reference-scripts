// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  cleanupSceneBundleUpload,
  parseSceneBundleUpload,
  SceneBundleUploadError,
} from '@/lib/process/sceneBundleUpload';
import {
  endEvaluationSession,
  EvaluationSessionError,
  getEvaluationSession,
  MAX_EVALUATION_SCENE_BUNDLE_BYTES,
  startEvaluationSession,
  configureEvaluationSession,
} from '@/lib/evaluation/sessionManager';
import { TeleoperationSessionError } from '@/lib/teleoperation/sessionManager';
import { nativeRelayEndpoints } from '@/lib/process/nativeRelay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof SyntaxError) {
    return Response.json({ error: 'The request body must be valid JSON.' }, { status: 400 });
  }
  if (error instanceof TeleoperationSessionError || error instanceof SceneBundleUploadError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    const session = getEvaluationSession(
      new URL(request.url).searchParams.get('sessionId') || undefined,
    );
    return session
      ? Response.json({
          ...session,
          relay: nativeRelayEndpoints('evaluation', session.sessionId),
        })
      : Response.json({ error: 'Evaluation session not found.' }, { status: 404 });
  } catch (error) {
    return errorResponse(error, 'The evaluation session could not be loaded.');
  }
}

export async function POST(request: Request): Promise<Response> {
  let upload = null;
  try {
    upload = await parseSceneBundleUpload(request, 'evaluation', MAX_EVALUATION_SCENE_BUNDLE_BYTES);
    const session = await startEvaluationSession({
      sceneBundlePath: upload.sceneBundlePath,
      profile: upload.profile,
    });
    return Response.json(session, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'The evaluation session could not start.');
  } finally {
    await cleanupSceneBundleUpload(upload);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const sessionId = new URL(request.url).searchParams.get('sessionId') || undefined;
    const session = await endEvaluationSession(sessionId);
    return session
      ? Response.json(session)
      : Response.json({ error: 'Evaluation session not found.' }, { status: 404 });
  } catch (error) {
    return errorResponse(error, 'The evaluation session could not be stopped.');
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('sessionId' in body) ||
      typeof body.sessionId !== 'string' ||
      !('profile' in body) ||
      !body.profile ||
      typeof body.profile !== 'object' ||
      Array.isArray(body.profile)
    ) {
      throw new EvaluationSessionError('A sessionId and evaluation profile are required.', 400);
    }
    return Response.json(
      await configureEvaluationSession(body.sessionId, body.profile as Record<string, unknown>),
    );
  } catch (error) {
    return errorResponse(error, 'The evaluation task could not be configured.');
  }
}
