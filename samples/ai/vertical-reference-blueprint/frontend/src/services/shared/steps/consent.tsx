// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { FileText, LockKeyhole, PenLine, ShieldCheck, type LucideIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ActionHint } from "@/components/kiosk/action-hint";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { cn } from "@/lib/utils";
import type { StepProps } from "../step-props";
import { StepShell } from "../step-shell";

const NOTICES: { icon: LucideIcon; text: string }[] = [
  {
    icon: ShieldCheck,
    text: "Your identity documents and biometric data are used only to process this request and are handled under national data-protection law.",
  },
  {
    icon: LockKeyhole,
    text: "All data is encrypted end-to-end. Nothing is stored on this kiosk after your session ends.",
  },
  {
    icon: FileText,
    text: "A record of your consent, with timestamp and reference number, is kept for audit purposes.",
  },
];

/** Privacy notice with the e-sign consent tick required before any service. */
export default function ConsentStep({ service, actions }: StepProps) {
  const [agreed, setAgreed] = useState(false);

  return (
    <StepShell
      title="Privacy notice & consent"
      subtitle={
        <>
          Please review before continuing with{" "}
          <strong className="font-semibold text-primary">{service!.label}</strong>.
        </>
      }
      className="max-w-3xl"
    >
      <StepCard>
        <div className="mb-7 ks-stagger flex flex-col gap-5">
          {NOTICES.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-start gap-4">
              <Icon className="mt-0.5 size-6 shrink-0 text-primary" strokeWidth={1.8} />
              <p className="text-lg leading-relaxed text-pretty text-ink">{text}</p>
            </div>
          ))}
        </div>

        <ActionHint icon={PenLine}>
          {agreed ? "Thank you — now tap Agree & Continue" : "Tick the box to sign and continue"}
        </ActionHint>

        {/* The tick is the only thing standing between the citizen and the
            service, so while it is empty it is the one thing on screen that
            moves. */}
        <label
          className={cn(
            "flex cursor-pointer items-center gap-4 rounded-2xl border-2 p-5 transition-all",
            agreed ? "border-ring bg-selected" : "ks-attention-ring border-input bg-background",
          )}
        >
          <Checkbox
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
            className="size-9 rounded-xl border-2 transition-transform data-checked:ks-gradient data-checked:border-ring data-checked:scale-105 [&_svg]:size-5"
          />
          <span className="text-lg leading-snug font-semibold text-pretty">
            I have read the privacy notice and consent to the processing of my identity and
            biometric data for this service (e-sign).
          </span>
        </label>

        <StepActions
          ready={agreed}
          label="Agree & Continue"
          idleLabel="Tick the box above to continue"
          onContinue={actions.next}
          className="mt-7"
        />
      </StepCard>
    </StepShell>
  );
}
