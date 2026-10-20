// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { notFound, unavailable } from "../../_lib/http";
import { SpeechServiceError, speechStreamTarget, sttEnabled } from "../../_lib/speech";

/**
 * Where the browser streams the microphone: `{ protocol, url, turnDetection? }`
 * for the speech-to-text worker's socket, asked again for every socket since
 * the worker's port is only allocated while it runs. 404 when the recognizer
 * cannot stream, and the browser uploads clips instead.
 */
export async function GET() {
  if (!sttEnabled()) {
    return unavailable("speech-to-text is not configured — set KIOSK_STT_BASE_URL");
  }
  try {
    const target = await speechStreamTarget();
    if (!target) return notFound("the recognizer cannot stream");
    return Response.json(target, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof SpeechServiceError) return unavailable(error.message);
    return unavailable("could not reach the speech-to-text service");
  }
}
