// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Check, ChevronDown, CreditCard, Nfc, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Little animated pictures of the hardware bolted to the kiosk.
 *
 * A citizen who has never used the machine cannot be expected to know that
 * "insert your MyKad" means the slot under the screen, or that "tap to pay"
 * means the pad on the right. These loop a picture of the action until the
 * device reports it has happened, which is the one instruction nobody has to
 * read.
 */

/**
 * What the hardware is doing, as one word.
 *
 * "waiting" and "paused" are separate on purpose. They used to share a frame,
 * and the result was a picture of a card already seated in the reader sitting
 * above a caption that said the kiosk had not started looking yet — the art
 * said finished while the words said not yet, on the one screen a citizen is
 * reading precisely because they do not know what to do. "paused" is the
 * kiosk talking over its own instruction; "done" is the device reporting it
 * has read something, and is the only state that is allowed to look finished.
 */
export type DeviceState = "waiting" | "paused" | "done" | "error";

/** A stylised ID card — the thing the citizen is holding, drawn back at them. */
function IdCardArt({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "ks-gradient relative flex h-16 w-26 flex-col justify-end gap-1 rounded-xl p-2.5 shadow-lg",
        className,
      )}
    >
      <span className="absolute top-2.5 left-2.5 h-4 w-5 rounded-sm bg-white/70" />
      <span className="h-1.5 w-12 rounded-full bg-white/80" />
      <span className="h-1.5 w-9 rounded-full bg-white/55" />
    </div>
  );
}

/** The tick that appears on a device the moment it reports success — the same
 *  mark on every piece of hardware, so "that worked" is one shape to learn. */
function DoneBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "absolute -top-2 -right-2 flex size-7 animate-ks-pop items-center justify-center",
        "rounded-full bg-success text-white shadow-lg",
        className,
      )}
    >
      <Check className="size-4" strokeWidth={3.2} />
    </span>
  );
}

/** The lit strip across a reader, coloured by what the device is doing. */
function slotClass(state: DeviceState): string {
  if (state === "error") return "bg-destructive/50";
  if (state === "done") return "bg-success shadow-[0_0_16px_var(--color-success)]";
  if (state === "paused") return "bg-muted-foreground/35";
  return "bg-cyan/70 shadow-[0_0_16px_var(--color-cyan)]";
}

/** The slab's outline, same idea. */
function slabClass(state: DeviceState): string {
  if (state === "error") return "border-destructive/60";
  if (state === "done") return "border-success/60";
  return "border-border";
}

/**
 * "Put your card in the slot": the card slides down into the reader on a
 * loop while the device is waiting for it.
 *
 * The loop stops for a reason in each of the other three states, and each
 * stops differently: `paused` holds the card outside the slot and dims it
 * (the kiosk is still reading the instruction aloud — nothing is being
 * looked for yet), `done` seats the card in the reader and lights the slot
 * green, and `error` greys out a card the reader could not make sense of.
 */
export function CardReaderVisual({
  state = "waiting",
  compact,
  className,
}: {
  state?: DeviceState;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center",
        compact ? "scale-75" : "",
        className,
      )}
    >
      <div className="relative h-24 w-32 overflow-hidden">
        {state === "waiting" && (
          <IdCardArt className="absolute inset-x-3 top-2 animate-ks-insert" />
        )}
        {state === "paused" && <IdCardArt className="absolute inset-x-3 top-2 opacity-35" />}
        {state === "error" && (
          <IdCardArt className="absolute inset-x-3 top-6 opacity-60 grayscale" />
        )}
        {/* Seated: only the top of the card clears the slab, the way it looks
            once the reader actually has it. */}
        {state === "done" && <IdCardArt className="absolute inset-x-3 top-16 animate-ks-seat" />}
      </div>
      {/* The reader itself: a slab with a lit slot across it. */}
      <div
        className={cn(
          "relative flex h-14 w-44 items-start justify-center rounded-2xl border-2 bg-card pt-2.5 backdrop-blur-md transition-colors",
          slabClass(state),
        )}
      >
        <span className={cn("h-1.5 w-28 rounded-full transition-colors", slotClass(state))} />
        <span className="absolute bottom-2 text-[0.65rem] font-bold tracking-[0.2em] text-muted-foreground/70 uppercase">
          Card reader
        </span>
        {state === "done" && <DoneBadge />}
      </div>
      {state === "waiting" && (
        <ChevronDown
          className="absolute -top-6 size-7 animate-ks-nudge text-cyan"
          strokeWidth={2.4}
        />
      )}
    </div>
  );
}

/** "Tap your card here": a card dipping onto the contactless pad, with waves. */
export function ContactlessVisual({
  state = "waiting",
  className,
  compact,
}: {
  state?: DeviceState;
  className?: string;
  compact?: boolean;
}) {
  const live = state === "waiting";
  return (
    <div className={cn("relative flex flex-col items-center", compact && "scale-75", className)}>
      <div className="relative h-20 w-32">
        <IdCardArt
          className={cn(
            "absolute inset-x-3 top-0 animate-ks-tap",
            state === "paused" && "opacity-35 [animation-play-state:paused]",
            state === "done" && "translate-y-2.5 [animation-play-state:paused]",
            state === "error" && "opacity-60 grayscale [animation-play-state:paused]",
          )}
        />
      </div>
      <div
        className={cn(
          "relative flex h-16 w-40 items-center justify-center rounded-2xl border-2 bg-card backdrop-blur-md transition-colors",
          slabClass(state),
        )}
      >
        {/* The waves say "this pad is live" — so they only run when it is. */}
        {live && (
          <>
            <span className="pointer-events-none absolute size-14 animate-ks-wave rounded-full border-2 border-cyan/70" />
            <span
              className="pointer-events-none absolute size-14 animate-ks-wave rounded-full border-2 border-violet/60"
              style={{ animationDelay: "0.7s" }}
            />
          </>
        )}
        <Nfc
          className={cn(
            "size-8 transition-colors",
            state === "done"
              ? "text-success"
              : state === "paused"
                ? "text-muted-foreground/50"
                : "text-primary",
          )}
          strokeWidth={1.8}
        />
        {state === "done" && <DoneBadge />}
      </div>
    </div>
  );
}

/** "Feed the page in": a sheet being drawn into the flatbed scanner. */
export function ScannerVisual({
  state = "waiting",
  className,
}: {
  state?: DeviceState;
  className?: string;
}) {
  return (
    <div className={cn("relative flex flex-col items-center", className)}>
      <div className="relative h-20 w-28 overflow-hidden">
        <div
          className={cn(
            "absolute inset-x-2 top-1 flex h-16 animate-ks-insert flex-col gap-1.5 rounded-lg border bg-card p-2.5 shadow-lg",
            state !== "waiting" && "[animation-play-state:paused]",
            state === "paused" && "opacity-35",
            state === "done" && "translate-y-10 opacity-70",
          )}
        >
          <span className="h-1.5 w-14 rounded-full bg-muted-foreground/40" />
          <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          <span className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
        </div>
      </div>
      <div
        className={cn(
          "relative flex h-14 w-40 items-start justify-center rounded-2xl border-2 bg-card pt-2.5 backdrop-blur-md transition-colors",
          slabClass(state),
        )}
      >
        <span className={cn("h-1.5 w-24 rounded-full transition-colors", slotClass(state))} />
        <ScanLine className="absolute bottom-2 size-4 text-muted-foreground/70" />
        {state === "done" && <DoneBadge />}
      </div>
    </div>
  );
}

/** Generic "your card is being read" glyph for compact rows in the chat. */
export function DeviceGlyph({
  kind,
  className,
}: {
  kind: "reader" | "payment";
  className?: string;
}) {
  const Icon = kind === "reader" ? CreditCard : Nfc;
  return <Icon className={cn("size-6 text-primary", className)} />;
}
