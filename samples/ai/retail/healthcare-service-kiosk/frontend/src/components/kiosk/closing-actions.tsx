// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Check, Clock, LayoutGrid } from "lucide-react";
import type { AutoRestart } from "@/hooks/use-auto-restart";
import { CtaButton } from "./cta-button";
import { PrintButton } from "./print-button";
import { SecondaryButton } from "./secondary-button";

/** The end of a request: print it, carry on with another service (still signed in), or finish and clear the screen.
 *  `printCode` — the card's MRN or the slip's code — goes to the kiosk's receipt printer when it has one. */
export function ClosingActions({
  restart,
  signedIn,
  onFinish,
  onAnother,
  printCode,
}: {
  restart: AutoRestart;
  signedIn: boolean;
  onFinish: () => void;
  onAnother: () => void;
  printCode?: string;
}) {
  return (
    <>
      <div className="mt-2 flex flex-wrap items-start justify-center gap-3.5">
        <PrintButton code={printCode} fallback />
        <SecondaryButton onClick={onAnother}>
          <LayoutGrid />
          Something else
        </SecondaryButton>
        <CtaButton className="h-14 px-9 text-lg" onClick={onFinish}>
          <Check className="size-5" />
          {signedIn ? "Finish & sign out" : "Finish"}
          {restart.secondsLeft !== null && ` (${restart.secondsLeft})`}
        </CtaButton>
      </div>
      {restart.secondsLeft !== null && (
        <button
          onClick={restart.hold}
          className="flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
        >
          <Clock className="size-5" />
          {signedIn ? "Signing out automatically" : "Finishing automatically"} — I need more time
        </button>
      )}
    </>
  );
}
