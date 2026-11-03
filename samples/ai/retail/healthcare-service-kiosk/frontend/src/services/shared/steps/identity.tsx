// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import {
  ArrowLeft,
  Barcode,
  BookUser,
  CalendarCheck,
  CalendarDays,
  CameraOff,
  Check,
  CreditCard,
  FileText,
  Glasses,
  HeartHandshake,
  IdCard,
  RotateCcw,
  ScanFace,
  ScanText,
  Search,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { CtaButton } from "@/components/kiosk/cta-button";
import {
  BarcodeScannerVisual,
  CardReaderVisual,
  ContactlessVisual,
  ScannerVisual,
  type DeviceState,
} from "@/components/kiosk/device-visual";
import { FaceViewport, WaitingDots, useFaceScanSequence, type FacePhase } from "@/components/kiosk/face-scan";
import { MrnPad } from "@/components/kiosk/mrn-pad";
import { NumericKeypad } from "@/components/kiosk/numeric-keypad";
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { SpinnerRing } from "@/components/kiosk/spinner-ring";
import { useBarcodeInput } from "@/hooks/use-barcode-input";
import { usePaperFeed } from "@/hooks/use-paper-feed";
import { useServiceHealth, useVerifyIdentity } from "@/hooks/use-kiosk-api";
import { ApiError } from "@/lib/api/client";
import { idGesture, idReaderCopy, isReaderFault, readerFaultHelp } from "@/lib/id-reader";
import {
  readIdentityDocument,
  readPaper,
  submitScan,
  watchIdentityDocument,
  type IdentityDocument,
  type IdentityDocumentType,
  type IdentityVerification,
} from "@/lib/api/kiosk";
import { countOf, formatLongDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StepProps } from "../step-props";
import { StepShell } from "../step-shell";

const DOCUMENT_LABELS: Record<IdentityDocumentType, string> = {
  mykad: t("identityDocument.mykad"),
  passport: t("identityDocument.passport"),
  patientCard: "Patient card",
  appointmentSlip: "Appointment slip",
};

/** A page read at the document scanner is named as one, whatever number it carried. */
const documentLabel = (document: IdentityDocument) =>
  document.via === "paper" ? "Document" : DOCUMENT_LABELS[document.documentType];

/** How long the confirmed frame stays up before the flow moves on (ms). */
const VERIFIED_HOLD_MS = 1_400;

export default function IdentityStep({ actions }: StepProps) {
  // A scanned appointment slip names the visit: check-in preselects it.
  const slip = useRef<string | null>(null);
  return (
    <IdentityGate
      onDocument={(document) => {
        slip.current = document.appointmentReference ?? null;
      }}
      onVerified={(identity) =>
        actions.identityVerified(identity, slip.current ? { appointmentReference: slip.current } : undefined)
      }
    />
  );
}

/**
 * Two-stage identity check, also used outside the service flow (signing in, the Requests screen).
 * Stage one finds the record from a MyKad, a scanned patient card or slip, or a typed MRN; stage
 * two confirms the person: a face match for a card in the reader, the date of birth for a code.
 */
export function IdentityGate({
  onVerified,
  onDocument,
  consent,
}: {
  onVerified: (identity: IdentityVerification) => void;
  /** Told what was presented, before the second factor — an appointment slip routes to check-in. */
  onDocument?: (document: IdentityDocument) => void;
  /** Signing in outside a service skips each service's consent step, so the notice is given here. */
  consent?: string;
}) {
  const [document, setDocument] = useState<IdentityDocument | null>(null);
  const [confirmed, setConfirmed] = useState<IdentityVerification | null>(null);
  const verify = useVerifyIdentity(setConfirmed);

  useEffect(() => {
    if (!confirmed) return;
    const timer = setTimeout(() => onVerified(confirmed), VERIFIED_HOLD_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onVerified identity churns per render
  }, [confirmed]);

  const presented = (found: IdentityDocument) => {
    setDocument(found);
    onDocument?.(found);
  };

  if (!document) return <IdentifyStage onDocument={presented} consent={consent} />;
  if (confirmed) return <Confirmed identity={confirmed} />;
  const restart = () => {
    verify.reset();
    setDocument(null);
  };
  if (document.secondFactor === "dob") {
    return <BirthDateStage document={document} verify={verify} onRestart={restart} />;
  }
  return <FaceStage document={document} verify={verify} onRestart={restart} />;
}

type Failure = { title: string; detail: string };

function readerFailure(error: unknown): Failure {
  const copy = idReaderCopy();
  const reason = error instanceof ApiError ? error.reason : undefined;
  const said = error instanceof Error ? error.message.trim() : "";
  switch (reason) {
    case "timeout":
      return { title: "We didn't detect your document", detail: copy.hold };
    case "read_failed":
      return { title: "We couldn't read your document", detail: copy.reseat };
    case "unregistered":
      return {
        title: "That isn't linked to a record",
        detail: `${sentence(said)} Try another way below, or ask at the registration counter.`,
      };
    default:
      if (isReaderFault(reason)) {
        return {
          title: "The card reader isn't available",
          detail: `${sentence(said)} ${readerFaultHelp()}`,
        };
      }
      // No ApiError: the request itself never came back — the kiosk's own
      // server is unreachable, not the card.
      if (!(error instanceof ApiError)) {
        return {
          title: "The kiosk lost its connection",
          detail:
            "Your card is fine — the kiosk could not reach its own server. " +
            "Please try again in a moment, or ask a staff member for help.",
        };
      }
      return {
        title: "We couldn't read your document",
        detail: said ? sentence(said) : copy.reseat,
      };
  }
}

function scanFailure(error: unknown): Failure {
  const said = error instanceof Error ? sentence(error.message) : "";
  if (!(error instanceof ApiError)) return readerFailure(error);
  return { title: "We couldn't use that code", detail: said || "Please try again, or ask at the counter." };
}

function paperFailure(error: unknown): Failure {
  if (!(error instanceof ApiError)) return readerFailure(error);
  const said = sentence(error.message);
  switch (error.reason) {
    case "nothing_to_scan":
      return { title: "No page went in", detail: "Feed the page into the document scanner, writing facing you, and wait." };
    case "blank":
    case "no_identifier":
      return { title: "We couldn't find a number on that page", detail: said };
    case "unregistered":
      return { title: "That page isn't linked to a record", detail: said };
    default:
      return { title: "The document scanner can't help right now", detail: said };
  }
}

type Source = "card" | "code" | "paper" | "mrn";

const PAPER_TAKE_BACK = "Your document has been read — please take it from the scanner.";

const READING_LABEL: Record<Source, string> = {
  card: "Reading your card…",
  code: "Reading the code…",
  paper: "Reading your document…",
  mrn: "Finding your record…",
};

/** The card reader, the barcode scanner, the document scanner and the MRN keypad are all live at once: whichever the patient uses first wins. */
function IdentifyStage({ onDocument, consent }: { onDocument: (document: IdentityDocument) => void; consent?: string }) {
  const health = useServiceHealth();
  const reader = health.services?.nfc;
  const scanner = health.services?.barcode;
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lost, setLost] = useState(false);
  const [arm, setArm] = useState(0);
  const [paperRound, setPaperRound] = useState(0);
  const [reading, setReading] = useState<Source | null>(null);
  const found = useRef(onDocument);
  useEffect(() => {
    found.current = onDocument;
  });

  useEffect(() => {
    const control = new AbortController();
    let live = true;
    void (async () => {
      while (live) {
        try {
          const document = await watchIdentityDocument(control.signal);
          if (document && live) found.current(document);
          if (document) return;
        } catch (error) {
          if (!live) return;
          setReading(null);
          setFailure(readerFailure(error));
          if (error instanceof ApiError && error.status === 404) continue;
          setLost(true);
          return;
        }
      }
    })();
    return () => {
      live = false;
      control.abort();
    };
  }, [arm]);

  const failed = (error: unknown, describe: (error: unknown) => Failure) => {
    setReading(null);
    setFailure(describe(error));
  };

  const readPage = () => {
    setFailure(null);
    setReading("paper");
    readPaper().catch((error) => {
      failed(error, paperFailure);
      setPaperRound((n) => n + 1);
    });
  };
  const busy = reading !== null;
  const paper = usePaperFeed({ enabled: !busy, round: paperRound, onFed: readPage });

  const scan = (input: { code: string } | { simulate: "card" | "slip" }, source: "code" | "mrn" = "code") => {
    setFailure(null);
    setReading(source);
    submitScan(input).catch((error) => failed(error, scanFailure));
  };
  useBarcodeInput((code) => scan({ code }));

  const demoCard = () => {
    setFailure(null);
    setReading("card");
    readIdentityDocument()
      .then((document) => found.current(document))
      .catch((error) => failed(error, readerFailure));
  };

  const CardVisual = idGesture() === "tap" ? ContactlessVisual : CardReaderVisual;
  const state = (source: Source): DeviceState => (reading === source ? "done" : reading ? "paused" : "waiting");
  const cardSide = reading === "card" || reading === "code";
  const showPaper = paper !== null && paper !== "off";
  const cardLive = reader === "ok" || scanner === "ok";
  const cardSimulated = reader === "off" || scanner === "off";
  const cardDemos: Demo[] = [
    ...(reader === "off" ? [{ label: "MyKad", name: "Demo MyKad", onClick: demoCard }] : []),
    ...(scanner === "off"
      ? [
          { label: "Patient card", name: "Demo patient card", onClick: () => scan({ simulate: "card" }) },
          { label: "Slip", name: "Demo slip", onClick: () => scan({ simulate: "slip" }) },
        ]
      : []),
  ];

  return (
    <StepShell className="max-w-6xl" title="Let's find your record" subtitle="Use any one of these — no need to choose first.">
      <StageDots stage={1} className="mb-6" />
      {failure && (
        <div
          role="alert"
          className="mx-auto mb-6 flex max-w-4xl animate-ks-pop items-start gap-4 rounded-2xl border-2 border-destructive/30 bg-destructive/5 px-6 py-4 text-left"
        >
          <TriangleAlert className="mt-0.5 size-6 shrink-0 text-destructive" />
          <div>
            <div className="text-lg font-semibold">{failure.title}</div>
            <p className="text-base text-pretty text-muted-foreground">{failure.detail}</p>
          </div>
          {lost && (
            <CtaButton
              className="ml-auto h-12 shrink-0 px-6 text-base"
              onClick={() => {
                setLost(false);
                setFailure(null);
                setArm((n) => n + 1);
              }}
            >
              <RotateCcw />
              Try again
            </CtaButton>
          )}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {reading ? READING_LABEL[reading] : ""}
      </p>
      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:portrait:grid-cols-1">
        <div className="flex flex-col gap-3">
          <WayTile
            step={1}
            tone="teal"
            stacked={!showPaper}
            title="Scan your card"
            active={cardSide}
            dimmed={busy && !cardSide}
            visual={
              <div className={cn("flex items-end gap-2", showPaper ? "[zoom:0.8]" : "gap-6")}>
                <CardVisual state={state("card")} />
                <BarcodeScannerVisual state={state("code")} />
              </div>
            }
            lines={[
              { icon: IdCard, text: `MyKad — ${idGesture() === "tap" ? "tap it on the reader" : "insert it in the reader"}` },
              { icon: Barcode, text: "Patient card or slip — under the light" },
            ]}
            status={
              cardSide ? (
                <Reading label={READING_LABEL[reading!]} />
              ) : cardLive ? (
                <Ready label="Ready — just scan" />
              ) : !cardSimulated ? (
                <span className="text-base font-semibold text-muted-foreground">Card reader unavailable</span>
              ) : null
            }
            demos={!cardSide && <DemoChips demos={cardDemos} disabled={busy} />}
          />
          {showPaper && (
            <>
              <div className="flex items-center gap-3 px-8" aria-hidden>
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs font-bold tracking-[0.16em] text-muted-foreground uppercase">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <WayTile
                step={2}
                tone="blue"
                title="Feed in a document"
                active={reading === "paper"}
                dimmed={busy && reading !== "paper"}
                visual={
                  <div className="[zoom:1.15]">
                    <ScannerVisual state={state("paper")} />
                  </div>
                }
                lines={[
                  { icon: FileText, text: "A hospital letter or patient card" },
                  { icon: BookUser, text: "Your passport photo page" },
                ]}
                status={
                  reading === "paper" ? (
                    <Reading label={READING_LABEL.paper} />
                  ) : paper === "sensor" ? (
                    <Ready label="Ready — just feed it in" />
                  ) : paper === "button" ? (
                    <SecondaryButton className="h-12 px-5 text-base" onClick={readPage} disabled={busy}>
                      <ScanText className="size-5" />
                      Scan my document
                    </SecondaryButton>
                  ) : null
                }
                demos={
                  paper === "simulated" &&
                  reading !== "paper" && (
                    <DemoChips demos={[{ label: "ID copy", name: "Demo ID copy", onClick: readPage }]} disabled={busy} />
                  )
                }
              />
            </>
          )}
        </div>
        <section
          aria-label={`${showPaper ? 3 : 2}. Type your MRN`}
          className={cn(
            "ks-rest relative flex flex-col items-center gap-4 rounded-[2rem] border bg-card p-6 transition duration-300",
            reading === "mrn" && "border-success/60 ring-4 ring-success/15",
            busy && reading !== "mrn" && "opacity-45",
          )}
        >
          <span
            className={cn(
              "absolute -left-6 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border bg-background px-2.5 py-1 text-xs font-bold tracking-[0.16em] text-muted-foreground uppercase lg:landscape:block",
              showPaper ? "top-[23%]" : "top-1/2",
            )}
          >
            or
          </span>
          <div className="flex items-center gap-3">
            <StepBadge n={showPaper ? 3 : 2} />
            <h2 className="text-3xl font-bold tracking-tight">Type your MRN</h2>
          </div>
          <MrnPad busy={busy} finding={reading === "mrn"} onSubmit={(code) => scan({ code }, "mrn")} />
        </section>
      </div>
      <div className="mt-7 flex items-center justify-center gap-2.5 text-base text-muted-foreground">
        <HeartHandshake className="size-5 text-primary" />
        None of these with you? The registration counter can find your record.
      </div>
      {consent && (
        <p className="mx-auto mt-4 max-w-3xl text-center text-base text-pretty text-muted-foreground">{consent}</p>
      )}
      <PrivacyNote />
    </StepShell>
  );
}

const TONE = {
  teal: { tile: "border-teal/20 bg-teal/[0.06]", icon: "bg-teal/12 text-teal" },
  blue: { tile: "border-blue/20 bg-blue/[0.06]", icon: "bg-blue/12 text-blue" },
};

function StepBadge({ n }: { n: number }) {
  return (
    <span className="ks-gradient flex size-10 shrink-0 items-center justify-center rounded-full text-xl font-bold text-on-accent">
      {n}
    </span>
  );
}

/** A way in that needs no tap: the hardware is listening, so the tile only shows what to do with it. */
function WayTile({
  step,
  tone,
  stacked,
  title,
  active,
  dimmed,
  visual,
  lines,
  status,
  demos,
}: {
  step: number;
  tone: keyof typeof TONE;
  /** The only tile beside the keypad: picture on top, so it fills the height without stretching. */
  stacked?: boolean;
  title: string;
  active: boolean;
  dimmed: boolean;
  visual: React.ReactNode;
  lines: { icon: LucideIcon; text: string }[];
  status: React.ReactNode;
  demos: React.ReactNode;
}) {
  return (
    <section
      aria-label={`${step}. ${title}`}
      className={cn(
        "relative flex flex-1 items-center gap-6 rounded-[2rem] border p-5 transition duration-300",
        stacked ? "flex-col justify-center p-7 text-center" : "text-left",
        TONE[tone].tile,
        active && "border-success/60 ring-4 ring-success/15",
        dimmed && "opacity-45",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-3xl bg-card/80",
          stacked ? "h-52 w-full max-w-md" : "min-h-44 w-72 self-stretch",
        )}
      >
        {visual}
      </div>
      <div className={cn("flex min-w-0 flex-col gap-3 py-1", stacked ? "items-center" : "flex-1")}>
        <div className="flex items-center gap-3">
          <StepBadge n={step} />
          <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
        </div>
        <ul className="flex flex-col gap-2">
          {lines.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-lg font-medium text-ink">
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", TONE[tone].icon)}>
                <Icon className="size-5" />
              </span>
              {text}
            </li>
          ))}
        </ul>
        {(status || demos) && (
          <div className={cn("mt-1 flex flex-wrap items-center gap-x-4 gap-y-2", stacked && "justify-center")}>
            {status}
            {demos}
          </div>
        )}
      </div>
    </section>
  );
}

function Ready({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2.5 rounded-full bg-success/10 px-4 py-2 text-base font-semibold text-success">
      <span className="relative flex size-2.5">
        <span className="absolute inset-0 animate-ping rounded-full bg-success/60" />
        <span className="relative size-2.5 rounded-full bg-success" />
      </span>
      {label}
    </span>
  );
}

type Demo = { label: string; name: string; onClick: () => void };

/** Stands a read in when the peripheral is simulated — for demos, not a choice the patient makes. */
function DemoChips({ demos, disabled }: { demos: Demo[]; disabled: boolean }) {
  if (!demos.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-bold tracking-[0.14em] text-muted-foreground/80 uppercase">Demo</span>
      {demos.map((demo) => (
        <button
          key={demo.name}
          type="button"
          aria-label={demo.name}
          onClick={demo.onClick}
          disabled={disabled}
          className="h-10 cursor-pointer rounded-full border border-dashed border-muted-foreground/40 bg-card/70 px-3.5 text-sm font-semibold text-muted-foreground transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {demo.label}
        </button>
      ))}
    </div>
  );
}

function Reading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-full bg-success/10 px-5 py-2.5 text-base font-semibold text-success">
      <Check className="size-5" strokeWidth={2.6} />
      {label}
    </div>
  );
}

const DOB_DIGITS = 8;

/** "DDMMYYYY" to "YYYY-MM-DD", or null for a date that cannot exist. */
function birthDateIso(digits: string): string | null {
  if (digits.length !== DOB_DIGITS) return null;
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4));
  const date = new Date(year, month - 1, day);
  const real = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  if (!real || year < 1900 || date > new Date()) return null;
  return `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
}

type VerifyMutation = ReturnType<typeof useVerifyIdentity>;

/** Step two's frame: what was read and a way back, the check itself, and what stays private. */
function VerifyShell({
  title,
  subtitle,
  document,
  onRestart,
  privacy,
  children,
}: {
  title: string;
  subtitle: string;
  document: IdentityDocument;
  onRestart: () => void;
  privacy: string;
  children: React.ReactNode;
}) {
  return (
    <StepShell className="max-w-6xl" title={title} subtitle={subtitle}>
      <StageDots stage={2} className="mb-6" />
      <FoundBar document={document} onRestart={onRestart} />
      {children}
      <PrivacyNote text={privacy} />
    </StepShell>
  );
}

function FoundBar({ document, onRestart }: { document: IdentityDocument; onRestart: () => void }) {
  const Icon =
    document.via === "paper"
      ? ScanText
      : document.documentType === "appointmentSlip"
        ? CalendarCheck
        : document.documentType === "patientCard"
          ? CreditCard
          : IdCard;
  const detail =
    document.secondFactor === "dob"
      ? document.mrnHint
        ? `MRN ending ${document.mrnHint}`
        : "Your record is found"
      : document.holderName;
  // Skipped on a simulated read — there is no card or page to take back.
  const takeBack = document.simulated
    ? null
    : document.via === "paper"
      ? PAPER_TAKE_BACK
      : document.secondFactor === "face"
        ? idReaderCopy().remove
        : null;

  return (
    <div className="mx-auto mb-8 flex max-w-3xl animate-ks-pop items-center gap-4 rounded-2xl border bg-card px-5 py-3.5 text-left shadow-sm">
      <span className="relative flex size-13 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
        <Icon className="size-6" strokeWidth={2} />
        <span className="absolute -right-1.5 -bottom-1.5 flex size-6 items-center justify-center rounded-full bg-success text-white ring-3 ring-card">
          <Check className="size-3.5" strokeWidth={3.2} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-lg font-semibold">{documentLabel(document)} read</div>
        <div className="truncate text-base text-muted-foreground">{detail}</div>
        {takeBack && <div className="mt-0.5 text-sm font-medium text-pretty text-primary">{takeBack}</div>}
      </div>
      <button
        type="button"
        onClick={onRestart}
        aria-label="Not you? Use a different card or code"
        className="flex h-12 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-4 text-base font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <ArrowLeft className="size-5" />
        Not you?
      </button>
    </div>
  );
}

function BirthDateStage({
  document,
  verify,
  onRestart,
}: {
  document: IdentityDocument;
  verify: VerifyMutation;
  onRestart: () => void;
}) {
  const [digits, setDigits] = useState("");
  const iso = birthDateIso(digits);
  const error = verify.error instanceof ApiError ? verify.error : null;
  const locked = error?.reason === "locked";
  const impossible = digits.length === DOB_DIGITS && !iso;
  const segments = [
    { label: "Day", placeholder: "DD", from: 0 },
    { label: "Month", placeholder: "MM", from: 2 },
    { label: "Year", placeholder: "YYYY", from: 4 },
  ];

  return (
    <VerifyShell
      title="Confirm your date of birth"
      subtitle="So that only you can open your record."
      document={document}
      onRestart={onRestart}
      privacy="Your name stays hidden until your date of birth matches."
    >
      <div className="mx-auto grid max-w-5xl items-center gap-12 lg:grid-cols-[1fr_22rem] lg:portrait:grid-cols-1 lg:portrait:gap-10">
        <div className="flex flex-col items-center gap-5 lg:items-start lg:portrait:items-center">
          <div className="flex items-end gap-3">
            {segments.map((segment, index) => {
              const size = segment.placeholder.length;
              const typed = digits.slice(segment.from, segment.from + size);
              const active = !locked && digits.length >= segment.from && digits.length < segment.from + size;
              return (
                <div key={segment.label} className="flex items-end gap-3">
                  {index > 0 && <span className="pb-5 text-4xl font-bold text-muted-foreground/60">/</span>}
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-sm font-bold tracking-[0.14em] text-muted-foreground uppercase">{segment.label}</span>
                    <span
                      className={cn(
                        "flex h-22 items-center justify-center rounded-2xl border-2 bg-card font-heading text-5xl font-bold tracking-[0.08em] tabular-nums transition-shadow",
                        size === 4 ? "w-44" : "w-28",
                        active ? "border-primary ring-4 ring-primary/15" : "border-border",
                        (impossible || verify.isError) && "border-destructive/50",
                      )}
                    >
                      {typed}
                      <span className="text-muted-foreground/35">{segment.placeholder.slice(typed.length)}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex min-h-9 items-center">
            {impossible ? (
              <p className="flex items-center gap-2.5 text-lg font-medium text-destructive">
                <TriangleAlert className="size-5 shrink-0" />
                That date doesn&apos;t exist — please check it.
              </p>
            ) : iso ? (
              <p className="flex animate-ks-pop items-center gap-2.5 text-xl font-semibold">
                <CalendarDays className="size-6 text-primary" />
                {formatLongDate(iso)}
              </p>
            ) : (
              <p className="text-lg text-muted-foreground">Day, month, then year — for example 05 11 1990.</p>
            )}
          </div>
          {error && (
            <div
              role="alert"
              className="flex w-full max-w-[27.5rem] animate-ks-pop items-start gap-3 rounded-2xl border-2 border-destructive/30 bg-destructive/5 px-4 py-3"
            >
              {locked ? (
                <HeartHandshake className="mt-0.5 size-6 shrink-0 text-destructive" />
              ) : (
                <TriangleAlert className="mt-0.5 size-6 shrink-0 text-destructive" />
              )}
              <div>
                <p className="text-lg font-semibold text-pretty text-destructive">{sentence(error.message)}</p>
                {!locked && error.attemptsLeft !== undefined && (
                  <p className="text-base text-muted-foreground">
                    {countOf(error.attemptsLeft, "try", "tries")} left
                  </p>
                )}
              </div>
            </div>
          )}
          <CtaButton
            className="w-full max-w-[27.5rem]"
            disabled={!iso || verify.isPending || locked}
            onClick={() =>
              verify.mutate({ method: "dob", documentNumber: document.documentNumber, dateOfBirth: iso! })
            }
          >
            <ShieldCheck />
            {verify.isPending ? "Checking…" : "Confirm"}
          </CtaButton>
        </div>
        <NumericKeypad
          className="w-full max-w-[22rem] justify-self-center"
          disabled={verify.isPending || locked}
          onDigit={(digit) => {
            if (verify.isError) verify.reset();
            setDigits((current) => (current.length < DOB_DIGITS ? current + digit : current));
          }}
          onBack={() => setDigits((current) => current.slice(0, -1))}
          onClear={() => setDigits("")}
        />
      </div>
    </VerifyShell>
  );
}

function FaceStage({
  document,
  verify,
  onRestart,
}: {
  document: IdentityDocument;
  verify: VerifyMutation;
  onRestart: () => void;
}) {
  const [cameraless, setCameraless] = useState(false);
  const target = document.via === "paper" ? "your record" : `your ${documentLabel(document)}`;

  const runMatch = (frame: string | null) =>
    verify.mutate({ method: "face", documentNumber: document.documentNumber, image: frame });

  const scan = useFaceScanSequence({
    enabled: !cameraless,
    outcome: verify.isError ? "failed" : "pending",
    onCapture: runMatch,
  });
  const blocked = scan.blocked && !cameraless;
  const failure = verify.isError ? verifyFailure(verify.error) : null;

  return (
    <VerifyShell
      title="Now let's check it's you"
      subtitle={`A quick face scan matches you to ${target}. Nothing is recorded.`}
      document={document}
      onRestart={onRestart}
      privacy="Camera images never leave this device."
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-10 lg:flex-row lg:justify-center lg:gap-16">
        {blocked || cameraless ? (
          <IdleViewport
            icon={blocked ? CameraOff : ScanFace}
            label={blocked ? "Camera off" : verify.isPending ? "Verifying…" : "No camera"}
            pending={verify.isPending}
          />
        ) : (
          <FaceViewport phase={scan.phase} videoRef={scan.videoRef} live={scan.live} className="shrink-0 lg:w-[22rem]" />
        )}
        <div className="flex w-full max-w-md flex-col gap-6 text-left">
          {blocked ? (
            <CameraBlocked
              denied={scan.cameraStatus === "denied"}
              onRetry={scan.retryCamera}
              onSkip={() => setCameraless(true)}
            />
          ) : cameraless ? (
            <CameralessCheck
              pending={verify.isPending}
              failure={failure}
              onStart={() => runMatch(null)}
              onRetry={() => verify.reset()}
            />
          ) : (
            <ScanTracker
              phase={scan.phase}
              target={target}
              failure={failure}
              canSkip={scan.canSkip}
              onScanNow={scan.scanNow}
              onRetry={() => {
                verify.reset();
                scan.restart();
              }}
            />
          )}
        </div>
      </div>
    </VerifyShell>
  );
}

/** The three beats of the face check, so the patient can see how far along it is. */
function ScanTracker({
  phase,
  target,
  failure,
  canSkip,
  onScanNow,
  onRetry,
}: {
  phase: FacePhase;
  target: string;
  failure: string | null;
  canSkip: boolean;
  onScanNow: () => void;
  onRetry: () => void;
}) {
  const at = phase === "starting" || phase === "position" ? 0 : phase === "hold" ? 1 : phase === "verified" ? 3 : 2;
  const beats = [
    {
      title: "Get in the frame",
      hint: phase === "starting" ? "Starting the camera…" : "Stand an arm's length back with your face inside the oval.",
    },
    { title: "Hold still", hint: "Keep looking at the screen for a couple of seconds." },
    failure
      ? { title: "That didn't match", hint: failure }
      : { title: `Matching you to ${target}`, hint: "This takes a moment — please keep still." },
  ];

  return (
    <>
      <ol className="flex flex-col gap-1" aria-live="polite">
        {beats.map((beat, index) => {
          const done = index < at;
          const active = index === at;
          const failed = active && failure !== null;
          return (
            <li
              key={index}
              className={cn(
                "flex items-start gap-4 rounded-2xl px-4 py-3.5 transition-colors duration-300",
                active && (failed ? "bg-destructive/5" : "bg-accent/70"),
              )}
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-bold transition-colors duration-300",
                  done && "bg-success/15 text-success",
                  active && !failed && "ks-gradient text-on-accent",
                  failed && "bg-destructive text-white",
                  !done && !active && "bg-secondary text-muted-foreground/70",
                )}
              >
                {done ? (
                  <Check className="size-5" strokeWidth={2.8} />
                ) : failed ? (
                  <X className="size-5" strokeWidth={2.8} />
                ) : active && index === 2 ? (
                  <WaitingDots />
                ) : (
                  index + 1
                )}
              </span>
              <div className="min-w-0 pt-1.5">
                <div
                  className={cn(
                    "text-xl font-semibold tracking-tight",
                    !active && "text-muted-foreground",
                    failed && "text-destructive",
                  )}
                >
                  {beat.title}
                </div>
                {active && <p className="mt-1 text-base text-pretty text-muted-foreground">{beat.hint}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {failure ? (
        <CtaButton className="self-start" onClick={onRetry}>
          <RotateCcw />
          Try again
        </CtaButton>
      ) : (
        at < 2 && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {FACE_TIPS.map(({ icon: Icon, text }) => (
                <span
                  key={text}
                  className="flex items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-sm font-medium text-muted-foreground"
                >
                  <Icon className="size-4 text-primary" />
                  {text}
                </span>
              ))}
            </div>
            {canSkip && (
              <SecondaryButton className="self-start" onClick={onScanNow}>
                <ScanFace className="size-5" />
                I&apos;m ready — scan now
              </SecondaryButton>
            )}
          </div>
        )
      )}
    </>
  );
}

const FACE_TIPS: { icon: LucideIcon; text: string }[] = [
  { icon: UserRound, text: "Arm's length back" },
  { icon: ScanFace, text: "Look straight ahead" },
  { icon: Glasses, text: "No hat or sunglasses" },
];

/** The frame where the camera would be, so the screen keeps its shape without one. */
function IdleViewport({ icon: Icon, label, pending }: { icon: LucideIcon; label: string; pending: boolean }) {
  return (
    <div className="relative flex aspect-3/4 w-72 shrink-0 flex-col items-center justify-center gap-5 overflow-hidden rounded-[36px] border-2 border-white/10 bg-[#0b1220] text-white/65 lg:w-[22rem]">
      <div className="pointer-events-none absolute inset-[13%] rounded-[50%] border-2 border-dashed border-white/15" />
      {pending ? (
        <SpinnerRing icon={Icon} className="size-28" iconClassName="size-12 text-white/80" />
      ) : (
        <Icon className="size-16" strokeWidth={1.3} />
      )}
      <span className="absolute bottom-4 rounded-full bg-white/10 px-4 py-2 text-base font-semibold text-white/80 backdrop-blur-md">
        {label}
      </span>
    </div>
  );
}

function CameraBlocked({ denied, onRetry, onSkip }: { denied: boolean; onRetry: () => void; onSkip: () => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="text-3xl font-bold tracking-tight">
          {denied ? "The camera is blocked" : "The camera isn't working"}
        </div>
        <p className="mt-2 text-lg text-pretty text-muted-foreground">
          {denied
            ? "This kiosk needs the camera to match your face. Allow camera access when the browser asks, then try again."
            : "You can still confirm it's you without it, or ask a staff member for help."}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <CtaButton onClick={onRetry}>
          <RotateCcw />
          Try the camera again
        </CtaButton>
        <SecondaryButton onClick={onSkip}>Verify without the camera</SecondaryButton>
      </div>
    </div>
  );
}

function CameralessCheck({
  pending,
  failure,
  onStart,
  onRetry,
}: {
  pending: boolean;
  failure: string | null;
  onStart: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-5" aria-live="polite">
      <div>
        <div className={cn("text-3xl font-bold tracking-tight", failure && "text-destructive")}>
          {pending ? "Verifying your identity…" : failure ? "That didn't match" : "Ready when you are"}
        </div>
        <p className="mt-2 text-lg text-pretty text-muted-foreground">
          {pending
            ? "Please hold still while your identity is confirmed securely."
            : (failure ?? "Stand in front of the kiosk, then start the check.")}
        </p>
      </div>
      {!pending && (
        <CtaButton className="self-start" onClick={failure ? onRetry : onStart}>
          {failure ? <RotateCcw /> : <ShieldCheck />}
          {failure ? "Try again" : "Start verification"}
        </CtaButton>
      )}
    </div>
  );
}

/** The same moment for every way in: who is welcomed, and that the kiosk is moving on by itself. */
function Confirmed({ identity }: { identity: IdentityVerification }) {
  return (
    <StepShell title={`Welcome, ${identity.profile.name.split(" ")[0]}`} subtitle="Thank you — your record is open.">
      <StageDots stage={2} done />
      <div className="flex flex-col items-center gap-8">
        <div className="flex size-36 animate-ks-pop items-center justify-center rounded-full bg-[image:var(--gradient-success)] shadow-[0_18px_50px_-8px_rgba(33,128,92,0.55)]">
          <Check
            className="size-16 animate-ks-draw text-white [stroke-dasharray:30] [stroke-dashoffset:30]"
            strokeWidth={2.6}
          />
        </div>
        <div className="flex flex-col items-center gap-3">
          <p className="text-xl text-muted-foreground">Taking you to the next step…</p>
          <div className="h-2 w-72 overflow-hidden rounded-full bg-muted">
            <div
              className="ks-gradient h-full origin-left animate-ks-fill"
              style={{ animationDuration: `${VERIFIED_HOLD_MS}ms` }}
            />
          </div>
        </div>
      </div>
    </StepShell>
  );
}

function verifyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return "The face check didn't match — please try again.";
  return sentence(message);
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const ended = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return ended.charAt(0).toUpperCase() + ended.slice(1);
}

function StageDots({ stage, done, className }: { stage: 1 | 2; done?: boolean; className?: string }) {
  const stages: { n: 1 | 2; icon: LucideIcon; label: string }[] = [
    { n: 1, icon: Search, label: "Find your record" },
    { n: 2, icon: ShieldCheck, label: "Confirm it's you" },
  ];
  const at = done ? 3 : stage;
  return (
    <div className={cn("mb-8 flex items-center justify-center gap-4", className)}>
      {stages.map(({ n, icon: Icon, label }, index) => (
        <div key={n} className="flex items-center gap-4">
          {index > 0 && (
            <span
              className={cn(
                "h-0.5 w-10 rounded-full transition-colors duration-500",
                at > index ? "bg-primary" : "bg-border",
              )}
            />
          )}
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-full border px-5 py-2.5 text-base font-semibold transition-all duration-500",
              at === n
                ? "ks-gradient ks-glow border-transparent text-on-accent"
                : at > n
                  ? "border-success/40 bg-success/10 text-success"
                  : "bg-secondary text-muted-foreground/70",
            )}
          >
            {at > n ? (
              <Check className="size-5" strokeWidth={2.6} />
            ) : (
              <Icon className="size-5" strokeWidth={1.9} />
            )}
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

function PrivacyNote({
  text = "Nothing about you is shown until you confirm it's you. Camera images never leave this device.",
}: {
  text?: string;
}) {
  return (
    <div className="mt-8 flex items-center justify-center gap-2.5 text-base text-muted-foreground/80">
      <ShieldCheck className="size-5" />
      {text}
    </div>
  );
}
