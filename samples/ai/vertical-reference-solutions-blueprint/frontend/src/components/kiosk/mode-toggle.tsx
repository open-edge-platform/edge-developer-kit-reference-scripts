// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { createContext, useContext } from "react";
import { MessagesSquare, Pointer } from "lucide-react";
import { cn } from "@/lib/utils";

export type ModeSwitch = { mode: "touch" | "chat"; toggle: () => void };

/** Provided only by KioskEntry — elsewhere the toggle renders nothing, so
 *  screens reached outside the entry page stay locked to their mode. */
export const ModeSwitchContext = createContext<ModeSwitch | null>(null);

type Props = {
  className?: string;
  /** Renders "Chat" / "Touch" next to the icon (welcome pill). */
  showLabel?: boolean;
};

/** Touch/chat switch; caller supplies the pill or tile chrome. */
export function ModeToggle({ className, showLabel = false }: Props) {
  const modeSwitch = useContext(ModeSwitchContext);
  if (!modeSwitch) return null;

  const toChat = modeSwitch.mode === "touch";
  return (
    <button
      type="button"
      onClick={modeSwitch.toggle}
      aria-label={toChat ? "Switch to chat mode" : "Switch to touch mode"}
      className={cn("cursor-pointer", className)}
    >
      {toChat ? (
        <MessagesSquare className="size-5 text-cyan" strokeWidth={1.8} />
      ) : (
        <Pointer className="size-5 text-cyan" strokeWidth={1.8} />
      )}
      {showLabel && (toChat ? "Chat" : "Touch")}
    </button>
  );
}
