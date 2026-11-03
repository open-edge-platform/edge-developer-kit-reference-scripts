// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { safeUrl, URL_CHARS } from "@/lib/validation";
import { healthCheckEnabled, probeService, type ServiceHealth } from "./health";

/**
 * The assistant's face: the studio's lipsync worker (Wav2Lip), which streams a
 * real person to the chat screen over WebRTC and lip-syncs into that stream
 * whatever speech it is handed — the voice then comes back with the video, in
 * step with the lips.
 *
 * The browser negotiates the stream through these calls rather than with the
 * worker itself: the worker's CORS admits the studio's own origins only. The
 * media still flows directly between the browser and the worker.
 */

/** Unset base URL means no avatar: the chat has no avatar tile and plays replies itself. */
const AVATAR_BASE_URL = process.env.KIOSK_AVATAR_BASE_URL?.replace(/\/$/, "");
const AVATAR_TIMEOUT_MS = Number(process.env.KIOSK_AVATAR_TIMEOUT_MS ?? 60_000);

/** The worker's session ids are short hex strings; anything else never reaches it. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export class AvatarServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvatarServiceError";
  }
}

export const avatarEnabled = () => Boolean(AVATAR_BASE_URL);

export const avatarHealth = (): Promise<ServiceHealth> =>
  probeService({
    baseUrl: AVATAR_BASE_URL,
    path: process.env.KIOSK_AVATAR_HEALTH_PATH ?? "",
    enabled: healthCheckEnabled("KIOSK_AVATAR_HEALTH_CHECK"),
  });

export const validSession = (session: unknown): session is string =>
  typeof session === "string" && SESSION_ID.test(session);

/** A first piece shorter than this is merged with the next sentence: "Sure." alone sounds clipped. */
const FIRST_PIECE_CHARS = 24;
/** Later pieces gather sentences up to about this long — fewer requests, fewer breaks in the prosody. */
const PIECE_CHARS = 220;

/**
 * A reply cut into the pieces the avatar is handed one at a time: the first
 * sentence alone, so it starts talking after one short synthesis, then a few
 * sentences at a time, each synthesized while the one before is being said.
 * Cuts fall only where a sentence ends and a space follows, so "12.50" and
 * "5A-12" stay whole.
 */
export function speechPieces(text: string): string[] {
  const sentences = text.trim().split(/(?<=[.!?…])\s+/);
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (pieces.length === 0) {
      current = current ? `${current} ${sentence}` : sentence;
      if (current.length >= FIRST_PIECE_CHARS) {
        pieces.push(current);
        current = "";
      }
      continue;
    }
    if (current && current.length + sentence.length > PIECE_CHARS) {
      pieces.push(current);
      current = "";
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) pieces.push(current);
  return pieces;
}

/** The worker's SDP answer to the browser's offer, and the session it opened for it. */
export async function openAvatarSession(offer: {
  sdp: string;
  type: string;
}): Promise<{ sdp: string; type: string; session_id: string }> {
  const res = await request("/lipsync/offer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sdp: offer.sdp, type: offer.type }),
  });
  const answer = (await res.json().catch(() => null)) as {
    sdp?: unknown;
    type?: unknown;
    session_id?: unknown;
    error?: unknown;
  } | null;
  if (typeof answer?.sdp !== "string" || typeof answer.type !== "string" || !validSession(answer.session_id)) {
    throw new AvatarServiceError(
      typeof answer?.error === "string" ? answer.error : "the avatar service gave no answer",
    );
  }
  return { sdp: answer.sdp, type: answer.type, session_id: answer.session_id };
}

/**
 * Hand one utterance to the avatar to say. It is queued behind anything the
 * session is still saying and heard through the stream a moment later; the
 * reply is how long it lasts, in seconds.
 */
export async function sayThroughAvatar(
  session: string,
  speech: { audio: ArrayBuffer; contentType: string },
): Promise<number> {
  // The worker decodes by file name, and takes WAV or MP3 only.
  const ext = /wav/i.test(speech.contentType) ? "wav" : /mpeg|mp3/i.test(speech.contentType) ? "mp3" : null;
  if (!ext) throw new AvatarServiceError(`the avatar cannot say ${speech.contentType} audio`);
  const form = new FormData();
  form.append("file", new Blob([speech.audio], { type: speech.contentType }), `speech.${ext}`);
  form.append("session_id", session);
  const res = await request("/lipsync", { method: "POST", body: form });
  const body = (await res.json().catch(() => null)) as {
    audio_info?: { duration_seconds?: unknown };
  } | null;
  const seconds = Number(body?.audio_info?.duration_seconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

/** The worker's skin ids are its avatar folder names. */
const SKIN_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * A still of the person the stream shows (the worker's default skin), for the
 * panel to hold while the stream connects. It is a small thumbnail: the panel
 * softens it rather than pass it off as the live picture.
 */
export async function avatarPreview(): Promise<{ image: ArrayBuffer; contentType: string }> {
  const skins = (await (await request("/avatar", {})).json().catch(() => null)) as {
    default_skin?: unknown;
  } | null;
  const skin = skins?.default_skin;
  if (typeof skin !== "string" || !SKIN_ID.test(skin)) {
    throw new AvatarServiceError("the avatar service has no default face");
  }
  const res = await request(`/avatar/${skin}/preview`, {});
  return {
    image: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "image/jpeg",
  };
}

/** Drop what the session has queued and stop talking. */
export async function hushAvatar(session: string): Promise<void> {
  await request("/lipsync/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_id: session, chat_type: "stop" }),
  });
}

async function request(path: string, init: RequestInit): Promise<Response> {
  if (!AVATAR_BASE_URL) throw new AvatarServiceError("the avatar is not configured");
  // Rebuilt inline, character by character off the allowlist: the security
  // scan only trusts sanitization done in the same function as the fetch.
  let target = "";
  for (const ch of safeUrl(`${AVATAR_BASE_URL}${path}`)) {
    let ok = "";
    for (const allowed of URL_CHARS) {
      if (allowed === ch) {
        ok = allowed;
        break;
      }
    }
    if (!ok) throw new AvatarServiceError("the avatar service URL contains a forbidden character");
    target += ok;
  }
  let res: Response;
  try {
    res = await fetch(target, { ...init, signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) });
  } catch {
    throw new AvatarServiceError("the avatar service is not responding");
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new AvatarServiceError(
      `the avatar service returned ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return res;
}
