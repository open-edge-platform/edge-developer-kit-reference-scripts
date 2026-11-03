// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { createElement, useMemo, useState } from "react";
import { KioskApp } from "@/components/kiosk/kiosk-app";
import { ModeSwitchContext } from "@/components/kiosk/mode-toggle";
import { kioskMode } from "@/lib/kiosk-mode";
import { slotsOf } from "@/modules/slots";

/**
 * The terminal's front door: opens on whichever kiosk `terminal.mode`
 * names, with an on-screen ModeToggle to cross between touch and the
 * assistant. The toggle swaps the mounted kiosk, so any in-progress session
 * is dropped; a reload (including the idle restart) returns to the
 * configured mode. With the assistant module off or removed there is only
 * touch, and no toggle.
 */
export function KioskEntry() {
  const assistant = slotsOf("modes").find((mode) => mode.id === "chat");
  const [mode, setMode] = useState<"touch" | "chat">(() => (kioskMode() === "chat" && assistant ? "chat" : "touch"));
  const modeSwitch = useMemo(
    () => (assistant ? { mode, toggle: () => setMode(mode === "touch" ? "chat" : "touch") } : null),
    [assistant, mode],
  );

  return (
    <ModeSwitchContext.Provider value={modeSwitch}>
      {mode === "chat" && assistant ? createElement(assistant.Kiosk) : <KioskApp />}
    </ModeSwitchContext.Provider>
  );
}
