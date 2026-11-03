// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { ArrowLeft, HeartHandshake, House, Save } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { CtaButton } from "./cta-button";
import { SecondaryButton } from "./secondary-button";

type Props = {
  showBack: boolean;
  onBack: () => void;
  /** Leave the session and return to the welcome screen; hidden on the closing screens, which have their own. */
  onStartOver?: () => void;
  /** Ask before leaving: the citizen has answers that would be lost. */
  confirmStartOver?: boolean;
  /** Shown mid-flow once identity is verified: pause the application. */
  onSaveExit?: () => void;
  saving?: boolean;
};

export function KioskFooter({ showBack, onBack, onStartOver, confirmStartOver, onSaveExit, saving }: Props) {
  const [confirming, setConfirming] = useState(false);

  return (
    <footer className="ks-veil-footer flex flex-none flex-wrap items-center justify-between gap-3 border-t px-5 py-4 sm:px-8 lg:px-10">
      <div className="flex flex-wrap items-center gap-3">
        {showBack && (
          <SecondaryButton onClick={onBack} className="px-8">
            <ArrowLeft />
            Back
          </SecondaryButton>
        )}
        {onStartOver && (
          <SecondaryButton
            onClick={() => (confirmStartOver ? setConfirming(true) : onStartOver())}
            className="px-8"
          >
            <House />
            Start over
          </SecondaryButton>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2.5 text-base text-muted-foreground">
          <HeartHandshake className="size-5 shrink-0 text-primary" aria-hidden />
          Need assistance? Please ask our reception team.
        </div>
        {onSaveExit && (
          <SecondaryButton onClick={onSaveExit} disabled={saving} className="px-8">
            {saving ? <Spinner className="size-5" /> : <Save />}
            Save &amp; Exit
          </SecondaryButton>
        )}
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          showCloseButton={false}
          className="flex max-w-lg flex-col items-center gap-5 rounded-[30px] p-12 text-center sm:max-w-lg"
        >
          <DialogTitle className="text-3xl font-bold tracking-tight">Start over?</DialogTitle>
          <DialogDescription className="text-lg text-pretty text-muted-foreground">
            Your answers so far will be cleared and the kiosk will return to the welcome screen.
            {onSaveExit && " To keep them for later, choose Save & Exit instead."}
          </DialogDescription>
          <div className="mt-2 flex w-full flex-col gap-3">
            <SecondaryButton onClick={() => setConfirming(false)}>Keep going</SecondaryButton>
            <CtaButton
              onClick={() => {
                setConfirming(false);
                onStartOver?.();
              }}
            >
              <House />
              Yes, start over
            </CtaButton>
          </div>
        </DialogContent>
      </Dialog>
    </footer>
  );
}
