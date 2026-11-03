// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { publicEnv } from "@/lib/public-config";

export type KioskMode = "touch" | "chat";

/**
 * Which kiosk this terminal runs, fixed at install time.
 *
 *   "touch" (default) the guided touch flow
 *   "chat"            the assistant: a tool-calling model driving the kiosk's
 *                     own MCP server (see `/api/chat`)
 *
 * This names the mode a terminal starts in (and returns to on reload); the
 * entry page also offers an on-screen ModeToggle between touch and the
 * assistant. Changing the default is a settings change — edit config.yaml and
 * restart, the way every other browser-visible setting works.
 */
export function kioskMode(): KioskMode {
  return publicEnv("NEXT_PUBLIC_KIOSK_MODE") === "chat" ? "chat" : "touch";
}
