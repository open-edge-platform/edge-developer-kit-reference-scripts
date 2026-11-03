// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { unavailable } from "../../_lib/http";
import { AvatarServiceError, avatarEnabled, avatarPreview } from "../../_lib/avatar";

/** Only a picture is passed through: anything else would be served from the kiosk's own origin. */
const IMAGE_TYPE = /^image\/(jpeg|png|webp)$/i;

/**
 * A still of the person the avatar's stream shows, for the panel to hold
 * while the stream connects. The browser keeps it for a day, so the next
 * start shows the face before the worker is even up.
 */
export async function GET() {
  if (!avatarEnabled()) {
    return unavailable("the avatar is not configured — set KIOSK_AVATAR_BASE_URL");
  }
  try {
    const { image, contentType } = await avatarPreview();
    if (!IMAGE_TYPE.test(contentType)) return unavailable("the avatar service sent no picture");
    return new Response(image, {
      headers: { "content-type": contentType, "cache-control": "private, max-age=86400" },
    });
  } catch (error) {
    if (error instanceof AvatarServiceError) return unavailable(error.message);
    return unavailable("could not reach the avatar service");
  }
}
