// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  cleanupSceneBundleUpload,
  parseSceneBundleUpload,
  SceneBundleUploadError,
} from '@/lib/process/sceneBundleUpload';
import {
  endTeleoperationSession,
  MAX_TELEOPERATION_SCENE_BUNDLE_BYTES,
  refreshTeleoperationSession,
  startTeleoperationSession,
  stopTeleoperationStream,
  TeleoperationSessionError,
} from '@/lib/teleoperation/sessionManager';
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
    const session = await refreshTeleoperationSession(
      new URL(request.url).searchParams.get('sessionId') || undefined,
    );
    return session
      ? Response.json({
          ...session,
          relay: nativeRelayEndpoints('teleoperation', session.sessionId),
        })
      : Response.json({ error: 'Teleoperation session not found.' }, { status: 404 });
  } catch (error) {
    return errorResponse(error, 'The teleoperation session could not be loaded.');
  }
}

export async function POST(request: Request): Promise<Response> {
  let upload = null;
  try {
    upload = await parseSceneBundleUpload(
      request,
      'teleoperation',
      MAX_TELEOPERATION_SCENE_BUNDLE_BYTES,
    );
    const session = await startTeleoperationSession({
      sceneBundlePath: upload.sceneBundlePath,
      sceneBundleName: upload.sceneBundleName,
      profile: upload.profile,
    });
    return Response.json(session, { status: 201 });
  } catch (error) {
    return errorResponse(error, 'The teleoperation session could not be started.');
  } finally {
    await cleanupSceneBundleUpload(upload);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const sessionId = new URL(request.url).searchParams.get('sessionId') || undefined;
    const session = await endTeleoperationSession(sessionId);
    return session
      ? Response.json(session)
      : Response.json({ error: 'Teleoperation session not found.' }, { status: 404 });
  } catch (error) {
    return errorResponse(error, 'The teleoperation session could not be stopped.');
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('sessionId' in body) ||
      typeof body.sessionId !== 'string'
    ) {
      throw new TeleoperationSessionError('A sessionId is required.', 400);
    }
    return Response.json(await stopTeleoperationStream(body.sessionId));
  } catch (error) {
    return errorResponse(error, 'The shared stream could not stop.');
  }
}
