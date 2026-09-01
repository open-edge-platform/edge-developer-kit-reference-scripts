// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

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
 * assistant. Changing the default is a deployment change — set the env var
 * and restart, the way the other NEXT_PUBLIC_ kiosk settings work.
 */
export const KIOSK_MODE: KioskMode =
  process.env.NEXT_PUBLIC_KIOSK_MODE === "chat"
    ? "chat"
    : process.env.NEXT_PUBLIC_KIOSK_MODE === "agent"
      ? "agent"
      : "touch";
