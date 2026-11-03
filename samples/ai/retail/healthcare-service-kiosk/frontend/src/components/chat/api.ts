// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { apiGet, apiPost, apiPostStream, apiUpload } from "@/lib/api/client";

/** An utterance recognized: its text, the kiosk language it was spoken in,
 *  and the language Whisper said it heard (when it says). */
export type Transcript = { text: string; language?: string; heard?: string };

/** Transcribe an utterance from the kiosk microphone. `language` is the
 *  session's current language, kept when Whisper names one the kiosk does
 *  not speak. */
export function transcribeSpeech(
  audio: Blob,
  fileName = "speech.wav",
  language?: string,
  signal?: AbortSignal,
) {
  const form = new FormData();
  form.append("file", audio, fileName);
  if (language) form.append("language", language);
  return apiUpload<Transcript>("/speech/transcribe", form, "POST", signal);
}

/** The lipsync worker's answer to the avatar stream's WebRTC offer. */
export function openAvatar(offer: RTCSessionDescriptionInit) {
  return apiPost<{ sdp: string; type: RTCSdpType; session_id: string }>("/avatar/offer", {
    sdp: offer.sdp,
    type: offer.type,
  });
}

/** Have the avatar say `text`. It is handed over a piece at a time; each piece
 *  is yielded as the worker takes it, with its length in seconds. */
export async function* sayThroughAvatar(
  session: string,
  text: string,
  language: string | undefined,
  signal: AbortSignal,
): AsyncGenerator<{ text: string; seconds: number }> {
  const body = await apiPostStream("/avatar/say", { session, text, ...(language ? { language } : {}) }, signal);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffered += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, end).trim();
      buffered = buffered.slice(end + 1);
      if (line) yield JSON.parse(line) as { text: string; seconds: number };
    }
  }
}

/** Cut the avatar off and drop what it still had to say. */
export function hushAvatar(session: string) {
  return apiPost<{ ok: boolean }>("/avatar/stop", { session });
}

/**
 * Run the attached scanner for the next document ask (scanner mode only).
 * Resolves once the citizen has fed the page in, or fails when the scan times
 * out — so a document ask can be answered without touching the screen. The
 * requirement is named because a kiosk with no scanner attached stands in the
 * right document for it instead.
 */
export function waitForScannedDocument(serviceId: string, documentId: string) {
  return apiGet<{ fileName: string; fileBase64: string; simulated?: boolean }>(
    `/documents/scan/next?serviceId=${encodeURIComponent(serviceId)}` +
      `&documentId=${encodeURIComponent(documentId)}`,
  );
}

/** Mock-mode bytes for the assistant kiosk, to answer a document ask with. */
export function getMockDocument(serviceId: string, documentId: string) {
  return apiGet<{ fileName: string; fileBase64: string }>(
    `/documents/mock/next?serviceId=${encodeURIComponent(serviceId)}&documentId=${encodeURIComponent(documentId)}`,
  );
}
