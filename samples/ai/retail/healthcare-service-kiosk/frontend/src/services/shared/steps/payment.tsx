// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowRight,
  Banknote,
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
import { LoadFailed, StatusBlock, StepError } from "@/components/kiosk/status-block";
import { StepCard } from "@/components/kiosk/step-card";
import { SuccessBadge } from "@/components/kiosk/success-badge";
import { TapCard } from "@/components/kiosk/tap-card";
import { useFeeQuote, useRequests, useSubmitApplication } from "@/hooks/use-kiosk-api";
import { findPendingDuplicate, type KioskRequest, type PaymentMethod } from "@/lib/api/kiosk";
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

/** Shows the fee breakdown, takes payment, and submits the application. A
 *  free service has nothing to show here: it submits on arrival and goes
 *  straight to the receipt. */
export default function PaymentStep(props: StepProps) {
  return <Payment {...props} />;
}

/** The payment screen; a service's own `steps/payment.tsx` may pass `pending`, its screen for a case
 *  already under review (null keeps the standard one). */
export function Payment({
  service,
  state,
  actions,
  pending,
}: StepProps & { pending?: (duplicate: KioskRequest) => ReactNode }) {
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

  const loading = quote.isPending || (checkDuplicates && existing.isPending);
  const duplicate =
    checkDuplicates && !loading
      ? findPendingDuplicate(existing.data?.requests ?? [], service!)
      : undefined;
  const free = quote.isSuccess && quote.data.total === 0;

  const submitFree = () =>
    submit.mutate(null, {
      onSuccess: ({ payment, application }) => actions.submitted(payment, application),
    });
  const filed = useRef(false);
  useEffect(() => {
    if (loading || duplicate || !free || filed.current) return;
    filed.current = true;
    submitFree();
  });

  if (loading) {
    return <Spinner className="size-12 text-primary" />;
  }

  const ownPending = duplicate ? pending?.(duplicate) : null;
  if (ownPending) return ownPending;
  if (duplicate) {
    const charges = Boolean(quote.data && quote.data.total > 0);
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
            Your {service!.label} request submitted on {formatDateTime(duplicate.updatedAt)} is
            still in process. To avoid a duplicate submission
            {charges && " and double payment"}, please wait for it to be completed. You can track
            it under My Requests on the home screen.
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
  if (free) {
    return submit.isError ? (
      <StatusBlock
        icon={FileWarning}
        iconClassName="text-warning"
        title="Your request could not be submitted"
        description={submitFailure(submit.error) ?? "Something went wrong — please try again."}
        action={<CtaButton onClick={submitFree}>Try Again</CtaButton>}
      />
    ) : (
      <Spinner className="size-12 text-primary" />
    );
  }

  const { total, currency, serviceFee, processingFee } = quote.data;
  const amountLabel = formatMoney(total, currency);

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
        <FeeRow label={service!.variableFee ? "Amount due" : "Service fee"} value={formatMoney(serviceFee, currency)} />
        <Separator />
        {processingFee > 0 && (
          <>
            <FeeRow label="Kiosk processing fee" value={formatMoney(processingFee, currency)} />
            <Separator />
          </>
        )}
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
              <DialogTitle className="text-3xl font-bold tracking-tight">Payment received</DialogTitle>
              <div className="flex w-full items-center justify-between rounded-2xl border bg-background px-6 py-5">
                <span className="text-lg text-muted-foreground">Amount paid</span>
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
              {submit.variables === "card" ? (
                <ContactlessVisual />
              ) : (
                <SpinnerRing
                  icon={PAYING_ICON[submit.variables ?? "card"]}
                  className="size-28"
                  ringClassName="border-[6px]"
                  iconClassName="size-10"
                />
              )}
              <DialogTitle className="text-3xl font-bold tracking-tight">
                {PAYING_TITLE[submit.variables ?? "card"]}
              </DialogTitle>
              <p className="max-w-sm text-lg text-pretty text-muted-foreground">
                {PAYING_HINT[submit.variables ?? "card"]}
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
