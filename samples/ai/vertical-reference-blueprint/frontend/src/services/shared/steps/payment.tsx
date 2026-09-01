// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import {
  ArrowRight,
  Banknote,
  Check,
  CreditCard,
  FileWarning,
  Hand,
  House,
  QrCode,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { ActionHint } from "@/components/kiosk/action-hint";
import { CtaButton } from "@/components/kiosk/cta-button";
import { ContactlessVisual } from "@/components/kiosk/device-visual";
import { IconCircle } from "@/components/kiosk/icon-circle";
import { IconTile } from "@/components/kiosk/icon-tile";
import { SpinnerRing } from "@/components/kiosk/spinner-ring";
import { LoadFailed, StepError } from "@/components/kiosk/status-block";
import { StepCard } from "@/components/kiosk/step-card";
import { SuccessBadge } from "@/components/kiosk/success-badge";
import { TapCard } from "@/components/kiosk/tap-card";
import { useFeeQuote, useRequests, useSubmitApplication } from "@/hooks/use-kiosk-api";
import { findPendingDuplicate, type PaymentMethod } from "@/lib/api/kiosk";
import { formatDateTime, formatMoney } from "@/lib/format";
import { ListHeading } from "../fields";
import type { StepProps } from "../step-props";
import { StepShell } from "../step-shell";

const METHODS: { id: PaymentMethod; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "card", label: "Card", hint: "Tap, insert or swipe", icon: CreditCard },
  { id: "qr", label: "QR / e-Wallet", hint: "Scan with your phone", icon: QrCode },
  { id: "cash", label: "Cash", hint: "Insert notes below", icon: Banknote },
];

/** What the citizen is being asked to do at the terminal, per method. */
const PAYING_ICON: Record<PaymentMethod, LucideIcon> = {
  card: CreditCard,
  qr: QrCode,
  cash: Banknote,
};
const PAYING_TITLE: Record<PaymentMethod, string> = {
  card: "Tap or insert your card",
  qr: "Scan the QR code",
  cash: "Insert your notes",
};
const PAYING_HINT: Record<PaymentMethod, string> = {
  card: "Hold your card against the contactless pad beside the screen, or push it into the slot.",
  qr: "Open your banking or e-wallet app and scan the code shown on the payment terminal.",
  cash: "Feed your notes into the cash slot one at a time. Change is returned below.",
};

/** The server's own sentence for a failed submission, or null to use the
 *  generic fallback — a network drop has no message worth printing. */
function submitFailure(error: unknown): string | null {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message || message === "Failed to fetch") return null;
  const ended = /[.!?]$/.test(message) ? message : `${message}.`;
  return ended.charAt(0).toUpperCase() + ended.slice(1);
}

/** Shows the fee breakdown, takes payment, and submits the application. */
export default function PaymentStep({ service, state, actions }: StepProps) {
  const quote = useFeeQuote(service!.id, state.data);
  // Duplicate guard before any money changes hands: an application for this
  // service already under review blocks a second submission (the server
  // enforces the same rule as a backstop). Repeatable services skip it.
  const checkDuplicates = Boolean(state.identity && !service!.repeatable);
  const existing = useRequests(state.identity?.documentNumber, service!.id, checkDuplicates);
  const submit = useSubmitApplication({
    serviceId: service!.id,
    data: state.data,
    documentNumber: state.identity?.documentNumber,
  });

  if (quote.isPending || (checkDuplicates && existing.isPending)) {
    return <Spinner className="size-12 text-primary" />;
  }

  const duplicate = checkDuplicates
    ? findPendingDuplicate(existing.data?.requests ?? [])
    : undefined;
  if (duplicate) {
    return (
      <StepShell title="This request is already pending" className="max-w-3xl">
        <Card className="flex flex-col items-center gap-4 rounded-3xl p-10 text-center">
          <IconCircle tone="warning">
            <FileWarning className="size-11 text-warning" strokeWidth={2} />
          </IconCircle>
          <div className="text-2xl font-bold">
            Case {duplicate.reference} is still being reviewed
          </div>
          <div className="max-w-xl text-lg text-pretty text-muted-foreground">
            Your {service!.label} application submitted on{" "}
            {formatDateTime(duplicate.updatedAt)} is still in process. To avoid a duplicate
            submission and double payment, please wait for it to be completed. You can track it
            under My Requests on the home screen.
          </div>
          <CtaButton onClick={actions.reset} className="mt-3">
            <House />
            Back to Home
          </CtaButton>
        </Card>
      </StepShell>
    );
  }
  if (quote.isError) {
    return <LoadFailed message="Could not load the fee breakdown" onRetry={() => quote.refetch()} />;
  }

  const { total, currency, serviceFee, processingFee } = quote.data;
  const hasFee = total > 0;
  const amountLabel = hasFee ? formatMoney(total, currency) : "No fee";

  return (
    <StepShell
      title="Service fee & payment"
      subtitle={
        <>
          Fee breakdown for{" "}
          <strong className="font-semibold text-primary">{service!.label}</strong>.
        </>
      }
      className="max-w-3xl"
    >
      <StepCard>
        {hasFee ? (
          <>
            <FeeRow label="Service fee" value={formatMoney(serviceFee, currency)} />
            <Separator />
            <FeeRow label="Kiosk processing fee" value={formatMoney(processingFee, currency)} />
            <Separator />
            <div className="flex items-center justify-between py-5">
              <span className="text-xl font-bold">Total due</span>
              <span className="text-3xl font-bold text-primary">{amountLabel}</span>
            </div>
            <ListHeading className="mb-4">Select a payment method</ListHeading>
            <ActionHint icon={Hand}>
              Tap how you would like to pay — the terminal lights up next to the screen
            </ActionHint>
            <div className="ks-stagger grid gap-4 md:grid-cols-3">
              {METHODS.map((method) => (
                <TapCard
                  key={method.id}
                  onClick={() => submit.mutate(method.id)}
                  className="flex flex-col items-center gap-3 rounded-[20px] bg-field p-7 text-center hover:border-ring"
                >
                  <IconTile icon={method.icon} className="size-16 rounded-2xl" iconClassName="size-8" />
                  <div className="text-lg font-bold">{method.label}</div>
                  <div className="text-sm text-muted-foreground">{method.hint}</div>
                </TapCard>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 py-5 text-center">
            <IconCircle tone="success">
              <Check className="size-11 text-success" strokeWidth={2.2} />
            </IconCircle>
            <div className="text-2xl font-bold">No fee is required for this service</div>
            <div className="max-w-lg text-lg text-pretty text-muted-foreground">
              You can submit your request right away.
            </div>
            <CtaButton className="mt-2" onClick={() => submit.mutate(null)}>
              Submit Request
              <ArrowRight />
            </CtaButton>
          </div>
        )}
        {/* The server's reason, not a shrug: "an application is already
            pending" and "the payment service is down" ask for different next
            moves, and this was the one step that flattened both. */}
        {submit.isError && (
          <StepError>{submitFailure(submit.error) ?? "Something went wrong — please try again."}</StepError>
        )}
      </StepCard>

      <Dialog open={submit.isPending || submit.isSuccess}>
        <DialogContent
          showCloseButton={false}
          className="flex max-w-lg flex-col items-center gap-5 rounded-[30px] p-12 text-center sm:max-w-lg"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {submit.isSuccess ? (
            <>
              <SuccessBadge />
              <DialogTitle className="text-3xl font-bold tracking-tight">
                {hasFee ? "Payment received" : "Request submitted"}
              </DialogTitle>
              <div className="flex w-full items-center justify-between rounded-2xl border bg-background px-6 py-5">
                <span className="text-lg text-muted-foreground">
                  {hasFee ? "Amount paid" : "Fee"}
                </span>
                <span className="text-2xl font-bold text-primary">{amountLabel}</span>
              </div>
              <p className="max-w-md text-lg text-pretty text-muted-foreground">
                A receipt is being prepared with your case reference number.
              </p>
              <CtaButton
                className="mt-1"
                onClick={() => actions.submitted(submit.data.payment, submit.data.application)}
              >
                View Receipt
                <ArrowRight />
              </CtaButton>
            </>
          ) : (
            <>
              {/* Card payers get a picture of the tap they are being asked to
                  make; the other methods have no gesture to show. */}
              {hasFee && submit.variables === "card" ? (
                <ContactlessVisual />
              ) : (
                <SpinnerRing
                  icon={hasFee ? PAYING_ICON[submit.variables ?? "card"] : CreditCard}
                  className="size-28"
                  ringClassName="border-[6px]"
                  iconClassName="size-10"
                />
              )}
              <DialogTitle className="text-3xl font-bold tracking-tight">
                {hasFee ? PAYING_TITLE[submit.variables ?? "card"] : "Submitting request…"}
              </DialogTitle>
              <p className="max-w-sm text-lg text-pretty text-muted-foreground">
                {hasFee
                  ? PAYING_HINT[submit.variables ?? "card"]
                  : "Please wait while your request is sent for processing."}
              </p>
              <div className="text-2xl font-bold text-primary">{amountLabel}</div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </StepShell>
  );
}

function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-4">
      <span className="text-lg text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold">{value}</span>
    </div>
  );
}
