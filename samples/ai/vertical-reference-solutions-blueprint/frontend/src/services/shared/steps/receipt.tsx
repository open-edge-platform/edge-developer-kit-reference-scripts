// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Check, Clock, Info, Mail, Printer } from "lucide-react";
import { CtaButton } from "@/components/kiosk/cta-button";
import { RequestStatusBadge } from "@/components/kiosk/request-status";
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { StepCard } from "@/components/kiosk/step-card";
import { SuccessBadge } from "@/components/kiosk/success-badge";
import { useAutoRestart } from "@/hooks/use-auto-restart";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { StepProps } from "../step-props";

/** Final confirmation: case reference, amount paid and status. Then the
 *  kiosk logs the citizen out by itself — a receipt with someone's name and
 *  case id should not be left on screen for the next person in the queue. */
export default function ReceiptStep({ service, state, actions }: StepProps) {
  const { payment } = state;
  const application = state.application!;
  const restart = useAutoRestart({ when: true, onRestart: actions.reset });

  return (
    <div className="grid w-full max-w-5xl animate-ks-fade items-center gap-9 md:grid-cols-2">
      <div className="flex flex-col items-center gap-4 text-center">
        <SuccessBadge />
        <h1 className="text-4xl font-bold tracking-tight">You&apos;re all set!</h1>
        <p className="text-xl text-pretty text-muted-foreground">
          Your request for{" "}
          <strong className="font-semibold text-foreground">{service!.label}</strong> has been
          submitted successfully.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3.5">
          <SecondaryButton onClick={() => window.print()}>
            <Printer />
            Print
          </SecondaryButton>
          <SecondaryButton>
            <Mail />
            Email / SMS
          </SecondaryButton>
          <CtaButton className="h-14 px-9 text-lg" onClick={actions.reset}>
            <Check className="size-5" />
            Finish & Logout
            {restart.secondsLeft !== null && ` (${restart.secondsLeft})`}
          </CtaButton>
        </div>
        {restart.secondsLeft !== null && (
          <button
            onClick={restart.hold}
            className="flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
          >
            <Clock className="size-5" />
            Logging out automatically — I need more time
          </button>
        )}
      </div>

      <StepCard className="p-8">
        <ReceiptRow label="Case ID">
          <span className="text-xl font-bold text-primary">{application.caseId}</span>
        </ReceiptRow>
        <ReceiptRow label="Service">
          <span className="text-right text-lg font-semibold">{service!.label}</span>
        </ReceiptRow>
        <ReceiptRow label="Amount Paid">
          <span className="text-lg font-semibold">
            {payment ? formatMoney(payment.amount, payment.currency) : "No fee"}
          </span>
        </ReceiptRow>
        <ReceiptRow label="Submitted">
          <span className="text-lg font-semibold">{formatDateTime(application.submittedAt)}</span>
        </ReceiptRow>
        <ReceiptRow label="Status">
          <RequestStatusBadge status={application.status} />
        </ReceiptRow>
        {application.statusReason && (
          <div className="flex items-start gap-2.5 border-b py-4 text-base text-muted-foreground">
            <Info className="mt-0.5 size-5 shrink-0 text-warning" />
            {application.statusReason}
          </div>
        )}
        <div className="flex items-center gap-2.5 pt-4 text-base text-muted-foreground/80">
          <Mail className="size-5 shrink-0" />
          Receipt & tracking QR sent to {state.profile!.email}
        </div>
      </StepCard>
    </div>
  );
}

function ReceiptRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-4">
      <span className="shrink-0 text-lg text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
