// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { ReactNode } from "react";
import { FolderClock, Info } from "lucide-react";
import { ClosingActions } from "@/components/kiosk/closing-actions";
import { RequestStatusBadge } from "@/components/kiosk/request-status";
import { StepCard } from "@/components/kiosk/step-card";
import { SuccessBadge } from "@/components/kiosk/success-badge";
import { useAutoRestart } from "@/hooks/use-auto-restart";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { StepProps } from "../step-props";

/** What a patient walks away with — a queue ticket, a slip, a patient card — in place of the case card.
 *  `printCode` is the card's MRN or the slip's code, for the kiosk's receipt printer. */
export type Takeaway = { title: string; detail: string; artifact: ReactNode; printCode?: string };

/** Final confirmation: case reference, amount paid and status. Then the
 *  kiosk logs the citizen out by itself — a receipt with someone's name and
 *  case id should not be left on screen for the next person in the queue. */
export default function ReceiptStep(props: StepProps) {
  return <Receipt {...props} />;
}

/** The receipt screen; a service's own `steps/receipt.tsx` passes its `takeaway`, and `next` when the visit usually goes on (paying after check-in). */
export function Receipt({
  service,
  state,
  actions,
  takeaway,
  next,
}: StepProps & { takeaway?: Takeaway | null; next?: ReactNode }) {
  const { payment } = state;
  const application = state.application!;
  const restart = useAutoRestart({ when: true, onRestart: actions.reset });
  const held = application.status === "on_hold";
  const shown = held ? null : takeaway;
  const heading = held
    ? { title: "We've recorded your request", detail: application.statusReason ?? "" }
    : (shown ?? { title: "You're all set!", detail: `Your ${service!.label} request has been submitted.` });

  return (
    <div className="grid w-full max-w-5xl animate-ks-fade items-center gap-9 md:landscape:grid-cols-2 portrait:max-w-3xl">
      <div className="flex flex-col items-center gap-4 text-center">
        <SuccessBadge />
        <h1 className="text-4xl font-bold tracking-tight text-balance">{heading.title}</h1>
        <p className="text-xl text-pretty text-muted-foreground">{heading.detail}</p>
        {!held && next}
        <ClosingActions
          restart={restart}
          signedIn={Boolean(state.identity)}
          onFinish={actions.reset}
          onAnother={actions.anotherService}
          printCode={shown?.printCode}
        />
      </div>

      {shown ? (
        shown.artifact
      ) : (
        <StepCard className="p-8" data-print>
          <ReceiptRow label="Case ID">
            <span className="text-xl font-bold text-primary">{application.caseId}</span>
          </ReceiptRow>
          <ReceiptRow label="Service">
            <span className="text-right text-lg font-semibold">{service!.label}</span>
          </ReceiptRow>
          {payment && (
            <ReceiptRow label="Amount Paid">
              <span className="text-lg font-semibold">{formatMoney(payment.amount, payment.currency)}</span>
            </ReceiptRow>
          )}
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
          <div className="flex items-center gap-2.5 pt-4 text-base text-muted-foreground">
            <FolderClock className="size-5 shrink-0" />
            Track this request any time under My Requests on the home screen.
          </div>
        </StepCard>
      )}
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
