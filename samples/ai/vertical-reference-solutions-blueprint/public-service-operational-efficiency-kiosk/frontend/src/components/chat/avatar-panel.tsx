// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { AvatarFigure, type AvatarState } from "./avatar-figure";

/** The animated assistant beside the conversation, with a live caption while
 *  the voice plays. */

/** The states worth naming on the badge. */
const BADGES: Partial<Record<AvatarState, string>> = {
  speaking: "Speaking",
  listening: "Listening",
  thinking: "Thinking",
  pointing: "Your turn",
  celebrating: "All done",
};

/** The sentence being spoken, split at the last word boundary reached. The
 *  synthesis has no word timestamps, so the position is proportional. */
function captionWindow(text: string, progress: number): { spoken: string; ahead: string } {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const said = progress * text.length;
  let start = 0;
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const end = start + sentence.length;
    if (said < end || i === sentences.length - 1) {
      // Light up whole words only — a half-highlighted word reads as a glitch.
      const words = sentence.trimEnd().match(/\S+\s*/g) ?? [sentence];
      let reached = start;
      let lit = 0;
      for (const word of words) {
        if (reached + word.length > said) break;
        reached += word.length;
        lit += 1;
      }
      return {
        spoken: words.slice(0, lit).join(""),
        ahead: words.slice(lit).join(""),
      };
    }
    start = end;
  }
  return { spoken: text, ahead: "" };
}

export function AvatarPanel({
  state,
  caption,
  progress,
  className,
}: {
  state: AvatarState;
  /** The reply being read aloud — empty when nothing is playing. */
  caption: string;
  /** How far through the reply the voice is, 0–1. */
  progress: number;
  className?: string;
}) {
  // Wave once when the panel mounts, and only until something real happens.
  const [greeted, setGreeted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGreeted(true), 2600);
    return () => clearTimeout(timer);
  }, []);
  const shown: AvatarState = !greeted && state === "idle" ? "greeting" : state;

  const speaking = shown === "speaking";
  const badge = BADGES[shown];
  const { spoken, ahead } = speaking && caption ? captionWindow(caption, progress) : { spoken: "", ahead: "" };

  return (
    <div
      className={cn(
        "ks-rest flex flex-col gap-4 rounded-3xl border bg-card p-5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Kiosk assistant</div>
          <div className="text-sm text-muted-foreground">Guides you through each step</div>
        </div>
        {badge && (
          <div className="flex items-center gap-2 rounded-full border border-cyan/30 bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-foreground">
            <span className="size-2 animate-ks-blink rounded-full bg-cyan shadow-[0_0_10px_var(--color-cyan)]" />
            {badge}
          </div>
        )}
      </div>

      {/* The assistant's stage, with the live caption along its floor. */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border bg-field [background-image:radial-gradient(60%_45%_at_50%_92%,rgba(0,163,232,0.14),transparent_70%),radial-gradient(45%_40%_at_16%_6%,rgba(0,104,181,0.11),transparent_66%)]">
        <AvatarFigure state={shown} className="h-[90%] max-w-[88%]" />
        {speaking && caption && (
          // Fixed cyan on the dark caption plate — same reasoning as AvatarFigure.
          <div className="absolute inset-x-3.5 bottom-3.5 flex flex-col gap-1.5 rounded-[18px] bg-[#0d1730]/85 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-3.5 items-end gap-[3px]" aria-hidden>
                {[0, 1, 2, 3].map((bar) => (
                  <span
                    key={bar}
                    className={cn(
                      "h-3.5 w-[3px] origin-bottom animate-ks-equalize rounded-full",
                      bar % 2 === 0 ? "bg-[#00c7fd]" : "bg-[#00a3e8]",
                    )}
                    style={{ animationDelay: `${bar * 150}ms` }}
                  />
                ))}
              </div>
              <span className="text-[11px] font-bold tracking-[0.14em] text-[#00c7fd] uppercase">
                Reading aloud
              </span>
            </div>
            <p className="line-clamp-3 text-base text-pretty text-white" aria-live="polite">
              {spoken}
              <span className="opacity-45">{ahead}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
