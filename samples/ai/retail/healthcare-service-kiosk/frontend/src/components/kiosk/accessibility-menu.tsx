// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Accessibility, Check, Contrast, Square, Volume2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useServiceHealth } from "@/hooks/use-kiosk-api";
import { useSpeechPlayback } from "@/hooks/use-speech-playback";
import { setA11y, useA11y, type TextSize } from "@/lib/a11y";
import { cn } from "@/lib/utils";
import { CtaButton } from "./cta-button";
import { SecondaryButton } from "./secondary-button";

const SIZES: { id: TextSize; label: string; sample: string }[] = [
  { id: "standard", label: "Standard", sample: "text-xl" },
  { id: "large", label: "Large", sample: "text-2xl" },
  { id: "extra", label: "Extra large", sample: "text-3xl" },
];

function screenText(): string {
  const heading = document.querySelector("main h1");
  if (!heading) return "";
  const next = heading.nextElementSibling;
  const subtitle = next && !next.querySelector("button") ? next.textContent : "";
  return [heading.textContent, subtitle].filter(Boolean).join(". ");
}

export function AccessibilityMenu({ className, showLabel = false }: { className?: string; showLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const { textSize, highContrast } = useA11y();
  const tts = useServiceHealth().services?.tts === "ok";
  const speech = useSpeechPlayback();
  const reading = speech.speakingId === "screen";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Accessibility options"
        className={cn("cursor-pointer", className)}
      >
        <Accessibility className="size-5 text-primary" strokeWidth={1.8} />
        {showLabel && "Accessibility"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="flex max-w-xl flex-col gap-6 rounded-[30px] p-10 sm:max-w-xl">
          <div>
            <DialogTitle className="text-3xl font-bold tracking-tight">Accessibility</DialogTitle>
            <DialogDescription className="mt-2 text-lg text-muted-foreground">
              These settings last until you finish.
            </DialogDescription>
          </div>

          <section>
            <h3 className="mb-3 text-lg font-semibold">Text size</h3>
            <div className="grid grid-cols-3 gap-3" role="group" aria-label="Text size">
              {SIZES.map(({ id, label, sample }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={textSize === id}
                  onClick={() => setA11y({ textSize: id })}
                  className={cn(
                    "flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 px-2 font-semibold transition-colors",
                    textSize === id ? "border-ring bg-selected" : "border-input bg-background hover:border-primary/40",
                  )}
                >
                  <span className={cn("leading-none font-bold", sample)} aria-hidden>Aa</span>
                  <span className="text-base">{label}</span>
                </button>
              ))}
            </div>
          </section>

          <button
            type="button"
            aria-pressed={highContrast}
            onClick={() => setA11y({ highContrast: !highContrast })}
            className={cn(
              "flex min-h-16 cursor-pointer items-center gap-4 rounded-2xl border-2 px-5 text-left text-lg font-semibold transition-colors",
              highContrast ? "border-ring bg-selected" : "border-input bg-background hover:border-primary/40",
            )}
          >
            <Contrast className="size-6 shrink-0 text-primary" aria-hidden />
            <span className="flex-1">High contrast</span>
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-lg border-2",
                highContrast ? "border-ring bg-primary text-primary-foreground" : "border-input",
              )}
            >
              {highContrast && <Check className="size-5" strokeWidth={3} />}
            </span>
          </button>

          {tts && (
            <SecondaryButton
              onClick={() => (reading ? speech.stop() : speech.speak("screen", screenText()))}
              className="h-16"
            >
              {reading ? <Square /> : <Volume2 />}
              {reading ? "Stop reading" : "Read this screen aloud"}
            </SecondaryButton>
          )}

          <CtaButton onClick={() => setOpen(false)}>Done</CtaButton>
        </DialogContent>
      </Dialog>
    </>
  );
}
