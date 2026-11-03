// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, readJson, unavailable } from "../../_lib/http";
import { AvatarServiceError, avatarEnabled, hushAvatar, validSession } from "../../_lib/avatar";
import { moduleOff } from "../../_lib/modules";

/** Cuts the avatar off mid-sentence and drops whatever it still had to say. */
export async function POST(req: Request) {
  const off = moduleOff("chat");
  if (off) return off;
  if (!avatarEnabled()) {
    return unavailable("the avatar is not configured — set KIOSK_AVATAR_BASE_URL");
  }
  const body = await readJson<{ session: string }>(req);
  if (!validSession(body.session)) return badRequest("session is required");
  try {
    await hushAvatar(body.session);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AvatarServiceError) return unavailable(error.message);
    return unavailable("could not reach the avatar service");
  }
}
