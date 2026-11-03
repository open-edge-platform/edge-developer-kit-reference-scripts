// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CreditCard,
  FilePlus,
  FileUp,
  ListChecks,
  OctagonAlert,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import {
  CaptureProgressNote,
  DocumentPreviewDialog,
  type CaptureProgress,
} from "@/components/kiosk/document-capture";
import { IconCircle } from "@/components/kiosk/icon-circle";
import { Notice } from "@/components/kiosk/notice";
import { ReadBackRow } from "@/components/kiosk/read-back";
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { StepError } from "@/components/kiosk/status-block";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { TapCard } from "@/components/kiosk/tap-card";
import { useDocumentCapture } from "@/hooks/use-kiosk-api";
import { readDocument } from "@/lib/api/document-ai";
import { documentSource, type DocumentSource, type UploadedDocument } from "@/lib/api/kiosk";
import { awaitingPatient, displayDay, type FieldCheck } from "@/lib/document-fields";
import { ListHeading, OptionCards, SectionLabel } from "@/services/shared/fields";
import { resultData } from "@/services/shared/result";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";
import { PAYERS, payer } from "@/hospital/data";
import { isoDate, patientRecord } from "@/hospital/records";
import {
  CARD_CHOICES,
  CARD_QUESTION,
  PAYER_QUESTION,
  cardData,
  checkCard,
  coverageRows,
  withChosenPayer,
  type CardField,
  type CardRead,
} from "../card";
import { eligibility, eligibilityResult, manualOutcome } from "../eligibility";
import { formatMoney, kioskCurrency } from "@/lib/format";
import { maskId } from "@/lib/mask";

const CARD_ID = "insurance-card";

type Mode = "choose" | "scan" | "manual";

/** Not an insurance card at all, as opposed to one in another name — that one is still read and sent to the desk. */
const notACard = (doc?: UploadedDocument) => doc?.analysis?.status === "rejected" && !doc.analysis.typeMatches;

export default function InsuranceCardStep({ service, state, actions }: StepProps) {
  const serviceId = service?.id ?? "";
  const documentNumber = state.identity?.documentNumber ?? "";
  const currency = kioskCurrency();
  const money = (amount: number) => formatMoney(amount, currency);
  const profile = state.identity?.profile;
  const card = state.documents[CARD_ID];
  const source = documentSource();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(card ? "scan" : state.data.cardChoice === "manual" ? "manual" : "choose");
  const [payerPick, setPayerPick] = useState(state.data.payerId ?? "");

  const capture = useDocumentCapture(serviceId, documentNumber || undefined, actions.documentUploaded);
  const progress: CaptureProgress = { phase: capture.phase, page: capture.page, pageCount: capture.pageCount };

  const read = useQuery({
    queryKey: ["document-ai", serviceId, CARD_ID, card?.uploadedAt],
    queryFn: () =>
      readDocument<CardRead>({ serviceId, documentId: CARD_ID, documentNumber, uploadedAt: card?.uploadedAt ?? "" }),
    enabled: Boolean(serviceId && card && documentNumber && !notACard(card)),
    retry: false,
    staleTime: Infinity,
  });

  const startScan = () => {
    setMode("scan");
    if (source === "upload") inputRef.current?.click();
    else capture.start({ documentId: CARD_ID });
  };

  const picker = source === "upload" && (
    <input
      ref={inputRef}
      type="file"
      accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) capture.start({ documentId: CARD_ID, file });
        event.target.value = "";
      }}
    />
  );
  const preview = (
    <DocumentPreviewDialog
      capture={capture.pending?.capture ?? null}
      requirementLabel="insurance card"
      source={source}
      busy={capture.confirming}
      progress={progress}
      error={capture.pending ? capture.error?.message : undefined}
      onConfirm={capture.confirm}
      onDiscard={capture.discard}
    />
  );

  // One mounted file input and preview dialog across every screen: a picker unmounted mid-dialog drops the file.
  const body = (): React.ReactNode => {
    if (mode === "choose") {
      return (
        <StepShell
          title={CARD_QUESTION}
          subtitle="Scanning it reads your insurer and member details, ready for a Guarantee Letter request."
          className="max-w-3xl"
        >
          <StepCard>
            <OptionCards
              options={CARD_CHOICES.map((c) => ({
                id: c.id,
                label: c.label,
                icon: c.id === "scan" ? CreditCard : ListChecks,
              }))}
              value={null}
              onSelect={(id) => (id === "scan" ? startScan() : setMode("manual"))}
              columns={2}
            />
          </StepCard>
        </StepShell>
      );
    }

    if (mode === "manual") {
      const chosen = payer(payerPick);
      return (
        <StepShell
          title={PAYER_QUESTION}
          subtitle="We'll look for the policy we have on file for you."
          className="max-w-3xl"
        >
          <StepCard>
            <OptionCards
              options={PAYERS.map((p) => ({ id: p.id, label: p.name, icon: ShieldCheck }))}
              value={payerPick}
              onSelect={setPayerPick}
              columns={2}
            />
            <StepActions
              ready={Boolean(chosen)}
              idleLabel="Select your insurer to continue"
              label="Check eligibility"
              onContinue={() => {
                const outcome = eligibility(patientRecord(documentNumber), payerPick, isoDate(new Date()));
                actions.stepCompleted("application", {
                  cardChoice: "manual",
                  payerId: payerPick,
                  eligibilityOutcome: manualOutcome(outcome),
                  ...resultData(eligibilityResult(outcome, chosen?.name ?? "", chosen?.id ?? "", money)),
                });
              }}
            />
          </StepCard>
          <div className="mt-6 flex justify-center">
            <SecondaryButton onClick={startScan}>
              <ScanLine /> Scan my card instead
            </SecondaryButton>
          </div>
        </StepShell>
      );
    }

    const capturing = capture.busyId === CARD_ID;
    const fallbackActions = (
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <SecondaryButton onClick={startScan} disabled={capture.busy}>
          <RotateCcw /> Scan again
        </SecondaryButton>
        <SecondaryButton onClick={() => setMode("manual")}>
          <ListChecks /> Choose my insurer instead
        </SecondaryButton>
      </div>
    );

    if (!card || capturing || notACard(card)) {
      return (
        <StepShell title="Scan your insurance card" subtitle="The front of the card is enough." className="max-w-3xl">
          <CardCaptureBox busy={capturing} progress={progress} source={source} onCapture={startScan} />
          {capture.error && !capture.pending && (
            <StepError>{capture.error.message || "The card could not be captured — please try again."}</StepError>
          )}
          {notACard(card) && !capturing && (
            <Notice tone="danger" icon={OctagonAlert} className="mt-6">
              That doesn&apos;t look like an insurance card{card?.analysis?.summary ? `: ${card.analysis.summary}` : "."}
            </Notice>
          )}
          <div className="mt-6 flex justify-center">
            <SecondaryButton onClick={() => setMode("manual")}>
              <ListChecks /> My card isn&apos;t with me
            </SecondaryButton>
          </div>
        </StepShell>
      );
    }

    if (read.isFetching && !read.data) {
      return (
        <StepShell title="Reading your card" className="max-w-3xl">
          <StepCard className="flex flex-col items-center gap-5 py-16 text-center">
            <Spinner className="size-12 text-primary" />
            <div className="text-xl font-semibold">Reading your insurer and member details</div>
          </StepCard>
        </StepShell>
      );
    }

    if (!read.data) {
      return (
        <StepShell title="We couldn't read your card" className="max-w-3xl">
          <Notice tone="warning" icon={OctagonAlert}>
            The text on your card couldn&apos;t be read. Scan it again, or choose your insurer instead.
          </Notice>
          {fallbackActions}
        </StepShell>
      );
    }

    const printed = read.data.reading;
    const reading = payerPick && !printed.payerName ? withChosenPayer(printed, payerPick) : printed;
    const patient = { name: profile?.name ?? "", nationalId: profile?.nationalId ?? "" };
    const onFile = patientRecord(documentNumber).policy;
    const checks = checkCard(reading, patient, new Date(), onFile);
    const row = (field: CardField): FieldCheck<CardField> =>
      checks.find((c) => c.field === field) ?? { field, status: "ok", note: "" };
    const payerCheck = row("payer");
    const staff = checks.filter((c) => c.status === "staff");

    return (
      <StepShell
        title="Check your card details"
        subtitle="Here's what we read from your card — the counter uses it to request your Guarantee Letter."
        className="max-w-4xl"
      >
        <StepCard>
          <ListHeading className="flex items-center gap-2">
            <CreditCard className="size-5" /> From your insurance card
          </ListHeading>
          <ReadBackRow
            label={reading.payerKind === "tpa" ? "TPA" : "Insurer"}
            value={reading.payerName}
            status={payerCheck.status}
            note={payerCheck.note}
          >
            {!printed.payerName && (
              <>
                <SectionLabel className="mt-0">{PAYER_QUESTION}</SectionLabel>
                <OptionCards
                  options={PAYERS.map((p) => ({ id: p.id, label: p.name, icon: ShieldCheck }))}
                  value={payerPick}
                  onSelect={setPayerPick}
                  columns={2}
                  prompt={false}
                />
              </>
            )}
          </ReadBackRow>
          <ReadBackRow label="Member ID" value={reading.memberId} {...note(row("memberId"))} />
          <ReadBackRow label="Policy number" value={reading.policyNo} {...note(row("policyNo"))} />
          <ReadBackRow label="Name on card" value={reading.holderName} {...note(row("holderName"))} />
          <ReadBackRow label="IC on card" value={reading.nricOnCard ? maskId(reading.nricOnCard) : "Not printed"} {...note(row("nricOnCard"))} />
          <ReadBackRow label="Valid until" value={displayDay(reading.expiry) || null} {...note(row("expiry"))} />
          {reading.panelId && (
            <ReadBackRow
              label="Our records"
              value={coverageRows(reading.panelId, onFile, money).map((r) => `${r.label}: ${r.value}`).join(" · ") || null}
              {...note(row("policy"))}
            />
          )}
          {staff.length > 0 && (
            <Notice tone="warning" icon={UserRound} className="mt-6">
              The Billing &amp; Insurance Counter will need to check: {staff.map((c) => c.note).join("; ")}.
            </Notice>
          )}
          <StepActions
            ready={!awaitingPatient(checks)}
            idleLabel="Choose your insurer to continue"
            label="Check eligibility"
            onContinue={() => actions.stepCompleted("application", cardData(reading, checks, read.data?.readBy ?? "rules", onFile, money))}
          />
        </StepCard>
        {fallbackActions}
      </StepShell>
    );
  };

  return (
    <>
      {picker}
      {body()}
      {preview}
    </>
  );
}

const note = ({ status, note }: FieldCheck) => ({ status, note });

function CardCaptureBox({
  busy,
  progress,
  source,
  onCapture,
}: {
  busy: boolean;
  progress: CaptureProgress;
  source: DocumentSource;
  onCapture: () => void;
}) {
  const scanner = source === "scanner";
  const Icon = scanner ? ScanLine : source === "upload" ? FileUp : FilePlus;
  return (
    <TapCard
      onClick={onCapture}
      disabled={busy}
      className="flex min-h-60 w-full flex-col items-center justify-center gap-4 border-2 border-dashed border-dash p-10 text-center"
    >
      <IconCircle>
        {busy ? <Spinner className="size-10 text-primary" /> : <Icon className="size-10 text-primary" strokeWidth={1.7} />}
      </IconCircle>
      <div className="text-2xl font-bold">Insurance card</div>
      {busy ? (
        <CaptureProgressNote
          progress={progress}
          fallback={scanner ? "Feed your card into the scanner" : "Reading your card"}
        />
      ) : (
        <div className="text-lg text-muted-foreground">
          {scanner
            ? "Tap, then feed your card into the scanner"
            : source === "upload"
              ? "Tap and pick a PDF of your card"
              : "Tap to add your card"}
        </div>
      )}
    </TapCard>
  );
}
