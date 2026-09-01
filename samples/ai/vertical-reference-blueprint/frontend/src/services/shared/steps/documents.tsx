// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useRef, useState } from "react";
import {
  Check,
  FilePlus,
  FileUp,
  MapPin,
  OctagonAlert,
  Hand,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { ActionHint } from "@/components/kiosk/action-hint";
import {
  CaptureProgressNote,
  DocumentPreviewDialog,
  type CaptureProgress,
} from "@/components/kiosk/document-capture";
import { IconCircle } from "@/components/kiosk/icon-circle";
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { StepError } from "@/components/kiosk/status-block";
import { StepActions } from "@/components/kiosk/step-actions";
import { TapCard } from "@/components/kiosk/tap-card";
import type { Tone } from "@/components/kiosk/tone";
import { useDocumentCapture } from "@/hooks/use-kiosk-api";
import { DOCUMENT_SOURCE, type DocumentSource, type UploadedDocument } from "@/lib/api/kiosk";
import { plural } from "@/lib/format";
import type { DocumentRequirement } from "@/services/types";
import { cn } from "@/lib/utils";
import type { StepProps } from "../step-props";
import { StepShell } from "../step-shell";

/**
 * The only verdict that satisfies a requirement. Everything else leaves the
 * document outstanding: a rejection, a check that could not run, and a draft
 * saved before verdicts carried a status. Written as "is it a pass?" rather
 * than "is it a failure?" on purpose — the old test asked the latter, so
 * every verdict that never arrived counted as a pass and any document the
 * pipeline choked on went through unchecked.
 */
const isAccepted = (doc?: UploadedDocument) => doc?.analysis?.status === "accepted";

/** The AI ruled on it and said no. */
const isRejected = (doc?: UploadedDocument) => doc?.analysis?.status === "rejected";

/** Right kind of document, but it carries another person's name. */
const isWrongHolder = (doc?: UploadedDocument) =>
  isRejected(doc) && doc?.analysis?.typeMatches === true;

/**
 * On file, but nobody could check it — the services behind the check were
 * unavailable, or the page carried no readable text. Not the citizen's fault
 * and not a rejection, but not a pass either.
 */
const isUnverified = (doc?: UploadedDocument) =>
  Boolean(doc) && !isAccepted(doc) && !isRejected(doc);

type CardStatus = "empty" | "accepted" | "warn" | "unverified" | "rejected";

/** Per-status colouring for the card border, icon disc and result text. */
const CARD_STATUS: Record<CardStatus, { tone: Tone; border: string; text: string }> = {
  empty: { tone: "info", border: "border-2 border-dashed border-dash", text: "" },
  accepted: {
    tone: "success",
    border: "border-2 border-success/40 bg-success/5 disabled:opacity-100",
    text: "text-success",
  },
  warn: {
    tone: "warning",
    border: "border-2 border-warning/50 bg-warning/5",
    text: "text-warning",
  },
  unverified: {
    tone: "warning",
    border: "border-2 border-warning/50 bg-warning/5",
    text: "text-warning",
  },
  rejected: {
    tone: "danger",
    border: "border-2 border-destructive/50 bg-destructive/5",
    text: "text-destructive",
  },
};

/**
 * A requirement plus its session state. When the upload names someone other
 * than the applicant and the service allows proving a family link
 * (`relationshipProof`), the extra proof requirement becomes active and the
 * original upload is only satisfied once that proof is accepted.
 */
type RequirementState = {
  requirement: DocumentRequirement;
  uploaded?: UploadedDocument;
  proof: DocumentRequirement | null;
  proofUploaded?: UploadedDocument;
  satisfied: boolean;
};

/** Collects and verifies every document the selected service requires. */
export default function DocumentsStep({ service, state, actions }: StepProps) {
  const [staffOpen, setStaffOpen] = useState(false);
  // NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE picks the capture method for the whole kiosk.
  const scanner = DOCUMENT_SOURCE === "scanner";
  const mocked = DOCUMENT_SOURCE === "mock";
  // One capture, two phases: the paper is fetched and shown back, and only
  // filed and checked once the citizen confirms the preview.
  const capture = useDocumentCapture(
    service!.id,
    state.identity?.documentNumber,
    actions.documentUploaded,
  );
  const progress: CaptureProgress = {
    phase: capture.phase,
    page: capture.page,
    pageCount: capture.pageCount,
  };

  const entries: RequirementState[] = service!.documents.map((requirement) => {
    const uploaded = state.documents[requirement.id];
    const proof =
      requirement.relationshipProof && isWrongHolder(uploaded)
        ? requirement.relationshipProof
        : null;
    const proofUploaded = proof ? state.documents[proof.id] : undefined;
    const satisfied = proof ? isAccepted(proofUploaded) : isAccepted(uploaded);
    return { requirement, uploaded, proof, proofUploaded, satisfied };
  });

  /** Uploads that are dead ends — wrong-holder docs with a proof path are not. */
  const rejected = entries.flatMap((entry) => [
    ...(isRejected(entry.uploaded) && !entry.proof ? [entry.uploaded!] : []),
    ...(isRejected(entry.proofUploaded) ? [entry.proofUploaded!] : []),
  ]);
  const needsProof = entries.filter((entry) => entry.proof && !entry.satisfied);
  /** Captured but unchecked — a service outage, not a bad document. */
  const unverified = entries.flatMap((entry) => [
    ...(isUnverified(entry.uploaded) ? [entry.uploaded!] : []),
    ...(isUnverified(entry.proofUploaded) ? [entry.proofUploaded!] : []),
  ]);
  const allVerified = entries.every((entry) => entry.satisfied);

  const busyId = capture.busyId;
  /** The requirement whose preview is on screen, for the dialog's wording. */
  const previewing = capture.pending
    ? [...entries.flatMap((entry) => [entry.requirement, entry.proof])].find(
        (requirement) => requirement?.id === capture.pending!.capture.documentId,
      )
    : undefined;

  // The next box the citizen has to deal with, in the order the cards are
  // laid out. Highlighting every empty box at once is just noise; highlighting
  // one is an instruction.
  const nextId = busyId
    ? undefined
    : (entries.find((entry) => !entry.proof && !entry.satisfied)?.requirement.id ??
      entries.find((entry) => entry.proof && !entry.satisfied)?.proof?.id);

  /** Answers harvested from the accepted documents, e.g. the new address. */
  const continueWith = () => {
    const data: Record<string, string> = {};
    for (const { requirement, uploaded } of entries) {
      if (requirement.addressField && isAccepted(uploaded) && uploaded?.analysis?.address) {
        data[requirement.addressField] = uploaded.analysis.address;
      }
    }
    actions.stepCompleted("documents", data);
  };

  const verb = scanner ? "Scan" : mocked ? "Add" : "Upload";
  const idleLabel =
    unverified.length > 0
      ? `Could not be checked — ${scanner ? "scan again" : "try again"} to continue`
      : rejected.length > 0
        ? `Verification failed — ${scanner ? "scan again" : mocked ? "try again" : "re-upload"} to continue`
        : needsProof.length > 0
          ? `${verb} proof of relationship to continue`
          : `${verb} all documents to continue`;

  return (
    <StepShell
      title={`${verb} supporting documents`}
      subtitle={
        <>
          Required for <strong className="font-semibold text-primary">{service!.label}</strong>.
          Each one is checked against your identity before you continue.
        </>
      }
    >
      <ActionHint icon={Hand}>
        {allVerified
          ? "All documents verified — tap Continue below"
          : scanner
            ? "Tap the highlighted box, then feed that document into the scanner"
            : mocked
              ? "Tap the highlighted box to add that document"
              : "Tap the highlighted box and pick that document as a PDF"}
      </ActionHint>
      <div className="ks-stagger grid gap-6 md:grid-cols-2">
        {entries.map((entry) => (
          <DocumentCard
            key={entry.requirement.id}
            highlight={nextId === entry.requirement.id}
            requirement={entry.requirement}
            uploaded={entry.uploaded}
            status={cardStatus(entry.uploaded, entry.proof ? entry.satisfied : undefined)}
            busy={busyId === entry.requirement.id}
            progress={progress}
            source={DOCUMENT_SOURCE}
            onCapture={(file) => capture.start({ documentId: entry.requirement.id, file })}
          />
        ))}
        {entries.map(
          (entry) =>
            entry.proof && (
              <DocumentCard
                key={entry.proof.id}
                highlight={nextId === entry.proof.id}
                requirement={entry.proof}
                uploaded={entry.proofUploaded}
                status={cardStatus(entry.proofUploaded)}
                busy={busyId === entry.proof.id}
                progress={progress}
                source={DOCUMENT_SOURCE}
                onCapture={(file) =>
                  capture.start({
                    documentId: entry.proof!.id,
                    file,
                    relatedName: entry.uploaded?.analysis?.holderName ?? undefined,
                  })
                }
              />
            ),
        )}
      </div>
      {capture.error && !capture.pending && (
        <StepError>
          {capture.error.message ||
            (scanner
              ? "Scan failed — please try again."
              : mocked
                ? "The document could not be added — please try again."
                : "Upload failed — please try again.")}
        </StepError>
      )}
      {needsProof.length > 0 && (
        <Alert
          tone="warning"
          icon={TriangleAlert}
          title="Document is in someone else's name"
        >
          Your {needsProof[0].requirement.label.toLowerCase()} belongs to{" "}
          <strong className="font-semibold text-foreground">
            {needsProof[0].uploaded?.analysis?.holderName ?? "another person"}
          </strong>
          . If that person is your parent or child, {scanner ? "scan" : "upload"} a birth
          certificate showing both names in the Proof of Relationship box. Otherwise, tap the
          document box to {scanner ? "scan" : "upload"} one in your own name.
        </Alert>
      )}
      {unverified.length > 0 && (
        <Alert
          tone="warning"
          icon={ShieldAlert}
          title="Document could not be checked"
          actions={
            <Button
              variant="outline"
              className="h-14 rounded-2xl px-6 text-lg font-semibold"
              onClick={() => setStaffOpen(true)}
            >
              <UserRound className="size-5" />
              Contact staff
            </Button>
          }
        >
          The check that confirms this document belongs to you could not be completed, so it
          cannot be accepted yet. Tap its box to {scanner ? "scan" : "upload"} it again — if that
          keeps happening, the checking service is down and a staff member will need to process
          your application at the counter.
        </Alert>
      )}
      {rejected.length > 0 && (
        <Alert
          tone="danger"
          icon={OctagonAlert}
          title="Document verification failed"
          actions={
            <>
              <SecondaryButton className="px-6" onClick={actions.reset}>
                <RotateCcw className="size-5" />
                Start over
              </SecondaryButton>
              <Button
                variant="destructive"
                className="h-14 rounded-2xl px-6 text-lg font-semibold"
                onClick={() => setStaffOpen(true)}
              >
                <UserRound className="size-5" />
                Contact staff
              </Button>
            </>
          }
        >
          A document could not be verified against your identity. Tap its box to{" "}
          {scanner ? "scan" : "upload"} the correct document again, or start over. If you
          believe this check is wrong, contact a staff member.
        </Alert>
      )}
      <StepActions ready={allVerified} idleLabel={idleLabel} onContinue={continueWith} />
      <DocumentPreviewDialog
        capture={capture.pending?.capture ?? null}
        requirementLabel={previewing?.label ?? "document"}
        source={DOCUMENT_SOURCE}
        busy={capture.confirming}
        progress={progress}
        error={capture.pending ? capture.error?.message : undefined}
        onConfirm={capture.confirm}
        onDiscard={capture.discard}
      />
      <StaffDialog
        open={staffOpen}
        onOpenChange={setStaffOpen}
        rejected={[...rejected, ...unverified]}
      />
    </StepShell>
  );
}

/** Full-width banner explaining a problem that blocks the step, with fixes. */
function Alert({
  tone,
  icon: Icon,
  title,
  actions,
  children,
}: {
  tone: "warning" | "danger";
  icon: typeof TriangleAlert;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const accent = tone === "warning" ? "text-warning" : "text-destructive";
  return (
    <div
      className={cn(
        "mt-8 rounded-3xl border-2 p-6",
        tone === "warning"
          ? "border-warning/40 bg-warning/5"
          : "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="flex items-start gap-4">
        <Icon className={cn("mt-1 size-7 shrink-0", accent)} strokeWidth={2} />
        <div className="flex-1">
          <div className={cn("text-xl font-bold", accent)}>{title}</div>
          <p className="mt-1 text-base text-muted-foreground">{children}</p>
          {actions && <div className="mt-4 flex flex-wrap gap-3">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * Wrong-holder uploads show as a warning while the relationship proof is
 * pending (`proofSatisfied` false) and as accepted once it clears; without a
 * proof path they are plain rejections.
 */
function cardStatus(uploaded?: UploadedDocument, proofSatisfied?: boolean): CardStatus {
  if (!uploaded) return "empty";
  if (proofSatisfied !== undefined && isWrongHolder(uploaded)) {
    return proofSatisfied ? "accepted" : "warn";
  }
  if (isAccepted(uploaded)) return "accepted";
  return isRejected(uploaded) ? "rejected" : "unverified";
}

function DocumentCard({
  requirement,
  uploaded,
  status,
  busy,
  progress,
  highlight,
  source,
  onCapture,
}: {
  requirement: DocumentRequirement;
  uploaded?: UploadedDocument;
  status: CardStatus;
  /** This card's document is being captured right now. */
  busy: boolean;
  /** How far the running capture has got, for the card's progress line. */
  progress: CaptureProgress;
  /** The one box the step is waiting on — it pulses until it is dealt with. */
  highlight?: boolean;
  /** How this kiosk captures documents — only "upload" opens a file picker. */
  source: DocumentSource;
  /** `file` is passed only on an upload terminal; elsewhere the kiosk fetches it. */
  onCapture: (file?: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const style = CARD_STATUS[status];
  // A file dialog is the one thing a kiosk visitor cannot answer, so it opens
  // only where picking a file IS the capture method.
  const picksFile = source === "upload";
  const scanner = source === "scanner";
  // The picture matches what the tap does: feed a page into the scanner, pick
  // a file, or have the kiosk add the document itself.
  const CaptureIcon = scanner ? ScanLine : picksFile ? FileUp : FilePlus;

  return (
    <>
      {picksFile && (
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onCapture(file);
            event.target.value = "";
          }}
        />
      )}
      <TapCard
        onClick={() => (picksFile ? inputRef.current?.click() : onCapture())}
        disabled={busy || status === "accepted"}
        className={cn(
          "flex min-h-60 flex-col items-center justify-center gap-4 p-10 text-center",
          style.border,
          highlight && "ks-attention-ring border-ring",
        )}
      >
        <IconCircle tone={style.tone}>
          {busy ? (
            <Spinner className="size-10 text-primary" />
          ) : status === "accepted" ? (
            <Check className="size-11 text-success" strokeWidth={2.2} />
          ) : status === "rejected" ? (
            <OctagonAlert className="size-11 text-destructive" strokeWidth={2} />
          ) : status === "warn" ? (
            <TriangleAlert className="size-11 text-warning" strokeWidth={2} />
          ) : status === "unverified" ? (
            <ShieldAlert className="size-11 text-warning" strokeWidth={2} />
          ) : (
            <CaptureIcon
              className={cn("size-10 text-primary", highlight && "animate-ks-nudge")}
              strokeWidth={1.7}
            />
          )}
        </IconCircle>
        <div className="text-2xl font-bold">{requirement.label}</div>
        {uploaded && !busy ? (
          <div className="flex flex-col gap-1">
            <div className={cn("text-base font-semibold", style.text)}>
              {uploaded.title ?? uploaded.fileName}
            </div>
            <div className="text-sm text-muted-foreground">
              {uploaded.fileName} · {uploaded.pages} {plural(uploaded.pages, "page")} ·{" "}
              {uploaded.sizeKb} KB
            </div>
            <div
              className={cn(
                "text-sm",
                status === "rejected"
                  ? "font-medium text-destructive"
                  : status === "unverified"
                    ? "font-medium text-warning"
                    : "text-muted-foreground",
              )}
            >
              {status === "unverified"
                ? `Not checked: ${
                    uploaded.analysis?.summary ?? "this document has not been verified."
                  }`
                : status === "rejected"
                  ? `Not accepted: ${uploaded.analysis?.summary ?? "verification failed."}`
                  : status === "accepted" && isWrongHolder(uploaded)
                    ? `Accepted with proof of relationship to ${
                        uploaded.analysis?.holderName ?? "the document holder"
                      }.`
                    : uploaded.analysis?.summary}
            </div>
            {requirement.addressField && uploaded.analysis?.address && status !== "rejected" && (
              <div className="mt-1 inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-primary">
                <MapPin className="size-4 shrink-0" />
                New address: {uploaded.analysis.address}
              </div>
            )}
            {status === "rejected" && (
              <div className="mt-1 text-sm font-semibold text-primary">
                Tap to {scanner ? "scan" : "upload"} the correct document again
              </div>
            )}
            {status === "unverified" && (
              <div className="mt-1 text-sm font-semibold text-primary">
                Tap to {scanner ? "scan" : "upload"} it again
              </div>
            )}
          </div>
        ) : busy ? (
          <CaptureProgressNote
            progress={progress}
            fallback={
              scanner ? "Feed your document into the scanner" : "Reading your document"
            }
          />
        ) : (
          <div className="text-base text-muted-foreground">{requirement.hint}</div>
        )}
      </TapCard>
    </>
  );
}

function StaffDialog({
  open,
  onOpenChange,
  rejected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rejected: UploadedDocument[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-8 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl leading-tight">Staff assistance</DialogTitle>
          <DialogDescription className="text-base">
            Please take your original document to the service counter and show a staff member
            this screen. They can review the document and complete your application manually if
            the automated check is wrong.
          </DialogDescription>
        </DialogHeader>
        {rejected.length > 0 && (
          <ul className="flex flex-col gap-2 rounded-2xl bg-muted/60 p-4 text-sm">
            {rejected.map(
              (doc) =>
                doc.analysis && (
                  <li key={doc.documentId} className="text-muted-foreground">
                    <span className="font-semibold text-foreground">
                      {doc.title ?? doc.fileName}:
                    </span>{" "}
                    {doc.analysis.summary}
                  </li>
                ),
            )}
          </ul>
        )}
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
