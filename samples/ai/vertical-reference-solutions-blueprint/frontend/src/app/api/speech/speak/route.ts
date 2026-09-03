// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, readJson, unavailable } from "../../_lib/http";
import { voiceForLanguage } from "../../_lib/languages";
import { SpeechServiceError, synthesizeSpeech, ttsEnabled } from "../../_lib/speech";

/**
 * Text → speech for the assistant kiosk. Returns the synthesized audio as-is
 * so the browser can hand it straight to an <audio> element; `voice` and
 * `speed` are optional per-request overrides of the configured defaults, and
 * `language` picks the voice configured for that language (`voice.languages`)
 * without the client having to know voice ids.
 */
export async function POST(req: Request) {
  if (!ttsEnabled()) {
    return unavailable("text-to-speech is not configured — set KIOSK_TTS_BASE_URL");
  }
  const body = await readJson<{
    text: string;
    voice?: string;
    speed?: number;
    language?: string;
  }>(req);
  const text = body.text?.trim();
  if (!text) return badRequest("text is required");

  try {
    const voice = body.voice ?? (body.language ? voiceForLanguage(body.language) : undefined);
    const speech = await synthesizeSpeech(text, { voice, speed: body.speed });
    return new Response(speech.audio, {
      headers: { "content-type": speech.contentType, "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SpeechServiceError) return unavailable(error.message);
    return unavailable("could not read that out loud");
  }
}
