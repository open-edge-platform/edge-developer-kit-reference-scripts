// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { publicEnv } from "@/lib/public-config";

export type KioskMode = "touch" | "chat" | "agent";

/**
 * Which kiosk this terminal runs, fixed at install time.
 *
 *   "touch" (default) the guided touch flow
 *   "chat"            the assistant, driven by the flow engine
 *   "agent"           the same assistant, driven by a tool-calling model over
 *                     the kiosk's own MCP server (see `/api/chat/agent`)
 *
 * This names the mode a terminal starts in (and returns to on reload); the
 * entry page also offers an on-screen ModeToggle between touch and the
 * assistant. Changing the default is a settings change — edit config.yaml and
 * restart, the way every other browser-visible setting works.
 */
export function kioskMode(): KioskMode {
  const mode = publicEnv("NEXT_PUBLIC_KIOSK_MODE");
  return mode === "chat" || mode === "agent" ? mode : "touch";
}
