// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import {
  CameraOff,
  Check,
  CreditCard,
  Fingerprint,
  Glasses,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { CtaButton } from "@/components/kiosk/cta-button";
import { CardReaderVisual, ContactlessVisual } from "@/components/kiosk/device-visual";
import {
  FaceViewport,
  WaitingDots,
  facePhaseCopy,
  useFaceScanSequence,
  type FacePhase,
} from "@/components/kiosk/face-scan";
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { SpinnerRing } from "@/components/kiosk/spinner-ring";
import { StepError } from "@/components/kiosk/status-block";
import { useIdentityDocument, useVerifyIdentity } from "@/hooks/use-kiosk-api";
import { ApiError } from "@/lib/api/client";
import { ID_GESTURE, READER_FAULT_HELP, idReaderCopy, isReaderFault } from "@/lib/id-reader";
import type {
  IdentityDocument,
  IdentityDocumentType,
  IdentityVerification,
} from "@/lib/api/kiosk";
import { cn } from "@/lib/utils";
import type { StepProps } from "../step-props";
import { StepShell } from "../step-shell";

const DOCUMENT_LABELS: Record<IdentityDocumentType, string> = {
  mykad: t("identityDocument.mykad"),
  passport: t("identityDocument.passport"),
};

/** How long the confirmed frame stays up before the flow moves on (ms). */
const VERIFIED_HOLD_MS = 1_400;

export default function IdentityStep({ actions }: StepProps) {
  return <IdentityGate onVerified={actions.identityVerified} />;
}

/** Two-stage identity check (document reader, then face scan), also used outside the service flow — e.g. to unlock the Requests screen. */
export function IdentityGate({
  onVerified,
}: {
  onVerified: (identity: IdentityVerification) => void;
}) {
  const reader = useIdentityDocument();
  const [confirmed, setConfirmed] = useState<IdentityVerification | null>(null);
  const verify = useVerifyIdentity(setConfirmed);

  useEffect(() => {
    if (!confirmed) return;
    const timer = setTimeout(() => onVerified(confirmed), VERIFIED_HOLD_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onVerified identity churns per render
  }, [confirmed]);

  if (!reader.data) {
    return (
      <ReaderView
        // Not just `isError`: React Query keeps the old error until a refetch
        // resolves, and a reader with a fetch in flight is genuinely waiting.
        failure={reader.isError && !reader.isFetching ? readerFailure(reader.error) : null}
        onRetry={() => reader.refetch()}
      />
    );
  }

  return <FaceStage document={reader.data} verify={verify} confirmed={confirmed} />;
}

function readerFailure(error: unknown): { title: string; detail: string } {
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
        title: "That card isn't linked to a record",
        detail: `${sentence(said)} ${copy.remove}`,
      };
    default:
      if (isReaderFault(reason)) {
        return {
          title: "The card reader isn't available",
          detail: `${sentence(said)} ${READER_FAULT_HELP}`,
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

function ReaderView({
  failure,
  onRetry,
}: {
  /** Null while the reader is still being waited on. */
  failure: { title: string; detail: string } | null;
  onRetry: () => void;
}) {
  const Visual = ID_GESTURE === "tap" ? ContactlessVisual : CardReaderVisual;
  const copy = idReaderCopy();
  return (
    <StepShell
      title="Verify your identity"
      subtitle="This takes two quick steps and about ten seconds."
    >
      <StageDots stage={1} />
      <div className="flex animate-ks-fade flex-col items-center gap-8 text-center">
        <Visual state={failure ? "error" : "waiting"} />
        <div className="flex flex-col items-center gap-3">
          <h2 className="text-3xl font-bold tracking-tight lg:text-4xl">
            {failure ? failure.title : copy.title}
          </h2>
          <p className="max-w-xl text-xl text-pretty text-muted-foreground">
            {failure ? failure.detail : copy.detail}
          </p>
        </div>
        {failure ? (
          <CtaButton onClick={onRetry}>
            <RotateCcw />
            Try Again
          </CtaButton>
        ) : (
          <div className="flex items-center gap-3 rounded-full border bg-secondary px-6 py-3 text-lg font-semibold text-secondary-foreground">
            <WaitingDots className="text-primary" />
            Waiting for your document…
          </div>
        )}
      </div>
      <PrivacyNote />
    </StepShell>
  );
}

type VerifyMutation = ReturnType<typeof useVerifyIdentity>;

function FaceStage({
  document,
  verify,
  confirmed,
}: {
  document: IdentityDocument;
  verify: VerifyMutation;
  confirmed: IdentityVerification | null;
}) {
  const [cameraless, setCameraless] = useState(false);
  const documentLabel = DOCUMENT_LABELS[document.documentType];

  const runMatch = (frame: string | null) =>
    verify.mutate({ method: "face", documentNumber: document.documentNumber, image: frame });

  const scan = useFaceScanSequence({
    enabled: !cameraless && !confirmed,
    outcome: confirmed ? "verified" : verify.isError ? "failed" : "pending",
    onCapture: runMatch,
  });

  const retry = () => {
    verify.reset();
    scan.restart();
  };

  const copy = facePhaseCopy(scan.phase);

  return (
    <StepShell
      title={confirmed ? `Welcome, ${confirmed.profile.name.split(" ")[0]}` : "Now let's check it's you"}
      subtitle={
        confirmed
          ? "Your identity is confirmed — taking you to the next step."
          : `A quick face scan matches you to your ${documentLabel}. Nothing is recorded.`
      }
    >
      <div className="mb-7 flex flex-wrap items-center justify-center gap-4">
        <StageDots stage={2} className="mb-0" />
        <div className="flex animate-ks-pop items-center gap-3 rounded-full bg-success/10 px-5 py-2.5 text-base font-semibold text-success">
          <Check className="size-5" strokeWidth={2.6} />
          {documentLabel} read — {document.holderName}
        </div>
        {/* Skipped on a simulated read — there is no card in any reader to take back. */}
        {!document.simulated && (
          <div className="flex animate-ks-pop items-center gap-3 rounded-full bg-primary/10 px-5 py-2.5 text-base font-semibold text-primary">
            <CreditCard className="size-5" strokeWidth={2.4} />
            {idReaderCopy().remove}
          </div>
        )}
      </div>

      {scan.blocked && !cameraless ? (
        <CameraBlocked
          denied={scan.cameraStatus === "denied"}
          onRetry={scan.retryCamera}
          onSkip={() => setCameraless(true)}
        />
      ) : cameraless ? (
        <CamerelessScan
          verified={Boolean(confirmed)}
          pending={verify.isPending}
          failed={verify.isError}
          failure={verifyFailure(verify.error)}
          onStart={() => runMatch(null)}
          onRetry={() => verify.reset()}
        />
      ) : (
        <div className="flex flex-col items-center gap-9 lg:flex-row lg:items-center lg:justify-center lg:gap-12">
          <FaceViewport
            phase={scan.phase}
            videoRef={scan.videoRef}
            live={scan.live}
            className="shrink-0"
          />
          <div className="flex max-w-md flex-col gap-5 text-center lg:text-left">
            <div>
              <div className="text-2xl font-bold tracking-tight lg:text-3xl">{copy.caption}</div>
              <p className="mt-2 text-lg text-pretty text-muted-foreground">{copy.hint}</p>
            </div>
            {scan.canSkip && (
              <SecondaryButton className="self-center lg:self-start" onClick={scan.scanNow}>
                <ScanFace className="size-5" />
                I&apos;m ready — scan now
              </SecondaryButton>
            )}
            {verify.isError && (
              <div className="flex flex-col items-center gap-4 lg:items-start">
                <StepError>{verifyFailure(verify.error)}</StepError>
                <CtaButton onClick={retry}>
                  <RotateCcw />
                  Try Again
                </CtaButton>
              </div>
            )}
            <PositionChecklist phase={scan.phase} />
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center justify-center gap-2.5 text-base text-muted-foreground/70">
        <Fingerprint className="size-5" />
        The thumbprint scanner on this kiosk is out of service.
      </div>
      <PrivacyNote />
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

function PositionChecklist({ phase }: { phase: FacePhase }) {
  const done = phase === "hold" || phase === "scanning" || phase === "verified";
  const items: { icon: LucideIcon; text: string }[] = [
    { icon: UserRound, text: "Stand centred in front of the screen, about an arm's length back" },
    { icon: ScanFace, text: "Fill the oval with your face and look straight ahead" },
    { icon: Glasses, text: "Take off hats, sunglasses and face coverings" },
  ];
  return (
    <ul className="flex flex-col gap-3.5">
      {items.map(({ icon: Icon, text }, index) => (
        <li
          key={text}
          className="flex animate-ks-rise items-start gap-3.5 text-left"
          style={{ animationDelay: `${index * 90}ms` }}
        >
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-500",
              done ? "bg-success/15 text-success" : "bg-accent text-accent-foreground",
            )}
          >
            {done ? (
              <Check className="size-5" strokeWidth={2.6} />
            ) : (
              <Icon className="size-5" strokeWidth={1.9} />
            )}
          </span>
          <span className="pt-1 text-base text-pretty text-ink">{text}</span>
        </li>
      ))}
    </ul>
  );
}

function CameraBlocked({
  denied,
  onRetry,
  onSkip,
}: {
  denied: boolean;
  onRetry: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-xl animate-ks-fade flex-col items-center gap-6 rounded-3xl border-2 border-warning/40 bg-warning/5 p-10 text-center">
      <CameraOff className="size-12 text-warning" strokeWidth={1.7} />
      <div className="text-2xl font-bold tracking-tight">
        {denied ? "The camera is blocked" : "No camera is available on this kiosk"}
      </div>
      <p className="text-lg text-pretty text-muted-foreground">
        {denied
          ? "This terminal needs the camera to match your face to your ID. Allow camera access when the browser asks, then try again."
          : "The face scanner on this terminal is not responding. You can still verify without it, or ask a staff member for help."}
      </p>
      <div className="flex flex-wrap justify-center gap-4">
        <CtaButton onClick={onRetry}>
          <RotateCcw />
          Try the camera again
        </CtaButton>
        <SecondaryButton onClick={onSkip}>Verify without the camera</SecondaryButton>
      </div>
    </div>
  );
}

function CamerelessScan({
  verified,
  pending,
  failed,
  failure,
  onStart,
  onRetry,
}: {
  verified: boolean;
  pending: boolean;
  failed: boolean;
  failure: string;
  onStart: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex animate-ks-fade flex-col items-center gap-7 py-6 text-center">
      <SpinnerRing
        icon={verified ? Check : failed ? CameraOff : ScanFace}
        spinning={pending}
        className="size-40"
        ringClassName="border-[5px]"
        iconClassName="size-14"
      />
      <div className="text-3xl font-bold tracking-tight">
        {verified
          ? "Identity confirmed"
          : pending
            ? "Verifying your identity…"
            : failed
              ? "That didn't match"
              : "Ready when you are"}
      </div>
      <p className="max-w-xl text-xl text-pretty text-muted-foreground">
        {verified
          ? "Thank you — taking you to the next step."
          : pending
            ? "Please hold still while your identity is confirmed securely."
            : failed
              ? failure
              : "Stand in front of the kiosk and start the check when you are ready."}
      </p>
      {!verified && !pending && (
        <CtaButton onClick={failed ? onRetry : onStart}>
          {failed ? (
            <>
              <RotateCcw />
              Try Again
            </>
          ) : (
            <>
              <ShieldCheck />
              Start verification
            </>
          )}
        </CtaButton>
      )}
    </div>
  );
}

function StageDots({ stage, className }: { stage: 1 | 2; className?: string }) {
  const stages: { n: 1 | 2; icon: LucideIcon; label: string }[] = [
    { n: 1, icon: CreditCard, label: "Read your ID" },
    { n: 2, icon: ScanFace, label: "Face check" },
  ];
  return (
    <div className={cn("mb-8 flex items-center justify-center gap-4", className)}>
      {stages.map(({ n, icon: Icon, label }, index) => (
        <div key={n} className="flex items-center gap-4">
          {index > 0 && (
            <span
              className={cn(
                "h-0.5 w-10 rounded-full transition-colors duration-500",
                stage > index ? "bg-primary" : "bg-border",
              )}
            />
          )}
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-full border px-5 py-2.5 text-base font-semibold transition-all duration-500",
              stage === n
                ? "ks-gradient ks-glow border-transparent text-on-accent"
                : stage > n
                  ? "border-success/40 bg-success/10 text-success"
                  : "bg-secondary text-muted-foreground/70",
            )}
          >
            {stage > n ? (
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

function PrivacyNote() {
  return (
    <div className="mt-4 flex items-center justify-center gap-2.5 text-base text-muted-foreground/80">
      <ShieldCheck className="size-5" />
      Your data is encrypted, and the camera image never leaves this device.
    </div>
  );
}
