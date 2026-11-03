// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, unavailable } from "../../_lib/http";
import { SpeechServiceError, sttEnabled, transcribeAudio } from "../../_lib/speech";
import { moduleOff } from "../../_lib/modules";

/**
 * Microphone → text for the assistant kiosk. The browser posts one utterance
 * (a 16 kHz WAV its VAD cut) as multipart `file`, with the session's current
 * language as an optional `language`; the reply is `{ text, language, heard? }`
 * — `text` empty when nothing intelligible was picked up, `language` the
 * kiosk language it was spoken in, as Whisper detected it (always the session's
 * on a single-language kiosk), and `heard` the language Whisper named, when it
 * names one.
 */
export async function POST(req: Request) {
  const off = moduleOff("chat");
  if (off) return off;
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
    const name = file instanceof File ? file.name : "speech.wav";
    return Response.json(
      await transcribeAudio(file, name, typeof language === "string" ? language : undefined, req.signal),
    );
  } catch (error) {
    if (error instanceof SpeechServiceError) return unavailable(error.message);
    return unavailable("could not transcribe the recording");
  }
}
