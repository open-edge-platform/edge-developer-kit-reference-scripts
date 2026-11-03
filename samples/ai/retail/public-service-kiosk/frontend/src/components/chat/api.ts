// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { apiPost, apiPostStream } from "@/lib/api/client";

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
