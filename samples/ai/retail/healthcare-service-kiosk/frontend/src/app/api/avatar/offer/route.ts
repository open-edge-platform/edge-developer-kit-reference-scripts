// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, readJson, unavailable } from "../../_lib/http";
import { AvatarServiceError, avatarEnabled, openAvatarSession } from "../../_lib/avatar";
import { moduleOff } from "../../_lib/modules";

/** An SDP offer for one video and one audio track is a few kilobytes. */
const MAX_SDP_CHARS = 64_000;

/**
 * Opens the avatar's stream: the browser's WebRTC offer goes to the lipsync
 * worker, and its answer comes back with the `session_id` that later
 * `/api/avatar/say` and `/api/avatar/stop` calls name.
 */
export async function POST(req: Request) {
  const off = moduleOff("chat");
  if (off) return off;
  if (!avatarEnabled()) {
    return unavailable("the avatar is not configured — set KIOSK_AVATAR_BASE_URL");
  }
  const body = await readJson<{ sdp: string; type: string }>(req);
  if (typeof body.sdp !== "string" || !body.sdp || body.sdp.length > MAX_SDP_CHARS || body.type !== "offer") {
    return badRequest("an SDP offer is required");
  }
  try {
    return Response.json(await openAvatarSession({ sdp: body.sdp, type: body.type }), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AvatarServiceError) return unavailable(error.message);
    return unavailable("could not reach the avatar service");
  }
}
