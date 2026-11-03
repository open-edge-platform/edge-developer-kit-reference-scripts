// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, readJson, unavailable } from "../../_lib/http";
import {
  AvatarServiceError,
  avatarEnabled,
  hushAvatar,
  sayThroughAvatar,
  speechPieces,
  validSession,
} from "../../_lib/avatar";
import { SpeechServiceError, synthesizeSpeech, ttsEnabled, ttsMaxChars } from "../../_lib/speech";

/**
 * Text → the avatar's voice. The reply is synthesized here, with the voice
 * `/api/speech/speak` would pick, and handed straight to the lipsync worker
 * piece by piece (see `speechPieces`) — the worker queues them in order, so
 * the avatar starts talking after the first sentence rather than after the
 * whole reply. The audio never makes the round trip through the browser; the
 * browser hears it in the avatar's stream.
 *
 * Answers NDJSON, one `{ text, seconds }` line per piece as the worker takes
 * it. A voice or avatar that fails on the first piece is a 503, and the
 * browser plays the reply itself instead; one that fails later leaves the
 * avatar saying what it has.
 */
export async function POST(req: Request) {
  if (!avatarEnabled() || !ttsEnabled()) {
    return unavailable("the avatar needs KIOSK_AVATAR_BASE_URL and KIOSK_TTS_BASE_URL");
  }
  const body = await readJson<{ session: string; text: string; language?: string }>(req);
  const text = body.text?.trim().slice(0, ttsMaxChars());
  if (!text) return badRequest("text is required");
  const session = body.session;
  if (!validSession(session)) return badRequest("session is required");

  const pieces = speechPieces(text);
  let stopped = false;
  const handOver = async (piece: string) => {
    // WAV: the worker reads it without a decoder, and there is no MP3 priming delay to lip-sync.
    const speech = await synthesizeSpeech(piece, { language: body.language, format: "wav" });
    // Stopped or replaced while it was synthesized: the avatar must not say it after all.
    if (stopped || req.signal.aborted) return null;
    return { text: piece, seconds: await sayThroughAvatar(session, speech) };
  };

  let first: Awaited<ReturnType<typeof handOver>>;
  try {
    first = await handOver(pieces[0]);
  } catch (error) {
    if (error instanceof SpeechServiceError || error instanceof AvatarServiceError) {
      return unavailable(error.message);
    }
    return unavailable("the avatar could not say that");
  }
  if (!first) return new Response(null, { status: 204 });

  const encoder = new TextEncoder();
  const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(line(first));
      for (const piece of pieces.slice(1)) {
        const said = await handOver(piece).catch(() => null);
        if (!said) break;
        try {
          controller.enqueue(line(said));
        } catch {
          stopped = true;
          break;
        }
      }
      // The browser let go while the rest went over: what reached the worker must not be said.
      if (stopped || req.signal.aborted) await hushAvatar(session).catch(() => {});
      try {
        controller.close();
      } catch {
        // Already cancelled by the browser.
      }
    },
    cancel() {
      stopped = true;
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}
