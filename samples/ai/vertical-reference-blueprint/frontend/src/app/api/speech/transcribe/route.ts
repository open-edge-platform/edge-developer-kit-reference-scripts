// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, unavailable } from "../../_lib/http";
import { SpeechServiceError, sttEnabled, transcribeAudio } from "../../_lib/speech";

/**
 * Microphone → text for the assistant kiosk. The browser posts the recorded
 * clip as multipart `file`, with the session's current language as an
 * optional `language` hint; the reply is `{ text, language }` — `text` empty
 * when the recorder picked up nothing intelligible, `language` the one the
 * utterance was detected to be in (always the hint on a single-language
 * kiosk).
 */
export async function POST(req: Request) {
  if (!sttEnabled()) {
    return unavailable("speech-to-text is not configured — set KIOSK_STT_BASE_URL");
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return badRequest("file is required");
  }
  const language = form?.get("language");
  try {
    const name = file instanceof File ? file.name : "recording.webm";
    return Response.json(
      await transcribeAudio(file, name, typeof language === "string" ? language : undefined),
    );
  } catch (error) {
    if (error instanceof SpeechServiceError) return unavailable(error.message);
    return unavailable("could not transcribe the recording");
  }
}
