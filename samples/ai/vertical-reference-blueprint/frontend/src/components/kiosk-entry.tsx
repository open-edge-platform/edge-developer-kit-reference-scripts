// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo, useState } from "react";
import { ChatKiosk } from "@/components/chat/chat-kiosk";
import { KioskApp } from "@/components/kiosk/kiosk-app";
import { ModeSwitchContext } from "@/components/kiosk/mode-toggle";
import { KIOSK_MODE } from "@/lib/kiosk-mode";

/**
 * The terminal's front door: opens on whichever kiosk `NEXT_PUBLIC_KIOSK_MODE`
 * names, with an on-screen ModeToggle to cross between touch and the
 * assistant. The toggle swaps the mounted kiosk, so any in-progress session
 * is dropped; a reload (including the idle restart) returns to the
 * configured mode.
 */
export function KioskEntry() {
  const [mode, setMode] = useState<"touch" | "chat">(
    KIOSK_MODE === "touch" ? "touch" : "chat",
  );
  const modeSwitch = useMemo(
    () => ({ mode, toggle: () => setMode(mode === "touch" ? "chat" : "touch") }),
    [mode],
  );

  return (
    <ModeSwitchContext.Provider value={modeSwitch}>
      {mode === "touch" ? (
        <KioskApp />
      ) : (
        // Same component for both assistants — only the endpoint behind it differs.
        <ChatKiosk api={KIOSK_MODE === "agent" ? "/api/chat/agent" : "/api/chat"} />
      )}
    </ModeSwitchContext.Provider>
  );
}
