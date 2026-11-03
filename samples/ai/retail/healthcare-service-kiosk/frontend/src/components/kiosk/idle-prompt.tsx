// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Hand, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAutoRestart } from "@/hooks/use-auto-restart";
import { CtaButton } from "./cta-button";
import { SecondaryButton } from "./secondary-button";

export function IdlePrompt({
  open,
  onStay,
  onRestart,
}: {
  open: boolean;
  onStay: () => void;
  onRestart: () => void;
}) {
  const restart = useAutoRestart({ when: open, onRestart });

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="flex max-w-lg flex-col items-center gap-5 rounded-[30px] p-12 text-center sm:max-w-lg"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="flex size-20 items-center justify-center rounded-full bg-accent text-primary">
          <Hand className="size-10" aria-hidden />
        </div>
        <DialogTitle className="text-3xl font-bold tracking-tight">Are you still there?</DialogTitle>
        <DialogDescription className="text-lg text-pretty text-muted-foreground">
          To protect your privacy, this session will close in{" "}
          <strong className="font-semibold text-foreground tabular-nums">
            {restart.secondsLeft ?? 0} seconds
          </strong>
          .
        </DialogDescription>
        <div className="mt-2 flex w-full flex-col gap-3">
          <CtaButton onClick={onStay}>I&apos;m still here</CtaButton>
          <SecondaryButton onClick={onRestart}>
            <RotateCcw />
            Start over
          </SecondaryButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
