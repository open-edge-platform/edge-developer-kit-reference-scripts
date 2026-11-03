// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, IdCard, Paperclip, ScanFace, Wallet } from "lucide-react";
import type { Ask } from "@/app/api/_lib/flows/types";
import {
  CardReaderVisual,
  ContactlessVisual,
  ScannerVisual,
  type DeviceState,
} from "@/components/kiosk/device-visual";
import { WaitingDots } from "@/components/kiosk/face-scan";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { documentSource } from "@/lib/api/kiosk";
import { idGesture } from "@/lib/id-reader";
import { cn } from "@/lib/utils";
import { deviceSteps, MAX_AUTO_CAPTURES, type CaptureStatus, type Refusal } from "./device-steps";
import { StepNag, StepNote } from "./step-notes";
import { useCardWatch, useDetectionWindow } from "./use-step-detection";

/** Hold the finished frame briefly so the citizen sees the step succeed before it disappears. */
const DONE_HOLD_MS = 700;

/** Fallback copy when no reader answered — deliberately doesn't claim a card was detected. */
const NO_READER_COPY = {
  waiting: "This kiosk's card reader isn't answering — continuing without it…",
  detected: "Continuing without a card read…",
};

const DOCUMENT_HELP =
  "The document has to reach the kiosk as a file — fed into the scanner beside the " +
  "screen, or picked with the button on this card. A staff member at the counter can " +
  "take it if neither works.";

/** One physical step: a picture of the hardware, the instruction, and however the citizen answers. */
export function AskRow({
  ask,
  busy,
  processing,
  held,
  manual,
  spoke,
  captureStatus,
  refusal,
  turn,
  onConfirm,
  onOption,
  onUpload,
}: {
  ask: Ask;
  busy: boolean;
  /** Busy with something the citizen sent, not just finishing the reply that asked for this step. */
  processing: boolean;
  held: boolean;
  /** The kiosk has given up capturing this document itself — see MAX_AUTO_CAPTURES. */
  manual: boolean;
  spoke: boolean;
  captureStatus: CaptureStatus | null;
  refusal: Refusal | null;
  /** Bumps every turn. A step asked again did not succeed, so it must re-arm. */
  turn: number;
  onConfirm: (ask: Ask) => void;
  onOption: (ask: Ask, value: string) => void;
  onUpload: (askId: string) => void;
}) {
  const step = deviceSteps()[ask.id];
  // The turn is recorded, not a bare flag: a later turn with the step still pending re-arms it.
  const [detectedAt, setDetectedAt] = useState<number | null>(null);
  const detected = detectedAt !== null;
  const [attempts, setAttempts] = useState(0);
  if (detectedAt !== null && turn !== detectedAt) {
    setDetectedAt(null);
    setAttempts((n) => n + 1);
  }

  // Only the card step has real hardware to wait on; the rest run a timer, and so does it
  // once the reader reports itself unavailable.
  const isCardStep = ask.id === "insertDocument" && ask.type === "action";
  // Listening while the kiosk still writes and talks: a card tapped mid-sentence is off the pad
  // again before the sentence ends, and would otherwise have to be tapped a second time.
  const { unavailable: noReader } = useCardWatch({
    enabled: isCardStep,
    paused: processing || detected,
    arm: attempts,
    onDetected: () => setDetectedAt(turn),
  });
  const simulated = isCardStep && noReader;
  // The card step is live the moment it is on screen: a citizen told to insert a card and then
  // told to wait for the narration doesn't know which to do. Every other step waits it out.
  const stepHeld = isCardStep ? processing : held;

  useDetectionWindow({
    ms: ask.type === "action" && (!isCardStep || noReader) ? ask.autoAdvanceMs : undefined,
    paused: stepHeld || detected,
    arm: attempts,
    onDetected: () => setDetectedAt(turn),
  });

  const confirmRef = useRef(onConfirm);
  useEffect(() => {
    confirmRef.current = onConfirm;
  });
  // A card seen while the kiosk is still talking goes in straight away — the narration stops
  // for it — once the reply that asked for it has arrived, and only once.
  const sentFor = useRef<number | null>(null);
  useEffect(() => {
    if (detectedAt === null || busy || sentFor.current === detectedAt) return;
    const timer = setTimeout(() => {
      sentFor.current = detectedAt;
      confirmRef.current(ask);
    }, DONE_HOLD_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one ask per row, keyed by id
  }, [detectedAt, busy]);

  // A step refused twice will not be argued into working — put the help on screen.
  const stalled = attempts >= 2 && !detected;

  const scanning = ask.type === "document" && documentSource() === "scanner" && !manual;
  // A refusal parks the hardware too, so the scanner isn't pulling paper the kiosk won't read.
  // The card pad stays lit while the kiosk talks: it is listening.
  const state: DeviceState = detected ? "done" : stepHeld || refusal ? "paused" : "waiting";
  const visual =
    isCardStep ? (
      idGesture() === "tap" ? (
        <ContactlessVisual state={state} />
      ) : (
        <CardReaderVisual state={state} />
      )
    ) : ask.id === "payment" ? (
      <ContactlessVisual state={state} />
    ) : scanning ? (
      <ScannerVisual state={state} />
    ) : null;

  return (
    <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-center sm:gap-8 sm:text-left">
      {visual ? (
        <div className="flex shrink-0 justify-center sm:w-56">{visual}</div>
      ) : (
        <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
          <AskIcon ask={ask} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xl font-semibold text-pretty break-words lg:text-2xl">{ask.question}</p>
        {detected ? (
          <div className="mt-4 flex items-center justify-center gap-3 text-lg font-semibold text-success sm:justify-start">
            <Check className="size-6 animate-ks-pop" strokeWidth={3} />
            {simulated ? NO_READER_COPY.detected : (step?.detected ?? "Detected — continuing…")}
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap justify-center gap-3 sm:justify-start">
            {ask.type === "action" &&
              (isCardStep && !noReader ? (
                <ReaderWaiting held={processing} />
              ) : ask.autoAdvanceMs ? (
                <DetectionBar
                  ms={ask.autoAdvanceMs}
                  held={stepHeld}
                  label={
                    simulated
                      ? NO_READER_COPY.waiting
                      : ask.id === "payment"
                        ? "Waiting for your payment…"
                        : "Waiting for the kiosk to detect this…"
                  }
                />
              ) : (
                <Button
                  className="ks-attention-ring h-14 rounded-2xl px-7 text-lg font-semibold"
                  disabled={busy}
                  onClick={() => setDetectedAt(turn)}
                >
                  <Check className="size-6" />
                  Done — continue
                </Button>
              ))}
            {ask.type === "options" &&
              ask.options?.map((option) => (
                <Button
                  key={option.value}
                  variant="outline"
                  className="h-14 rounded-2xl px-7 text-lg transition-transform hover:-translate-y-0.5"
                  disabled={busy}
                  onClick={() => onOption(ask, option.value)}
                >
                  {option.label}
                </Button>
              ))}
            {ask.type === "document" &&
              (documentSource() !== "upload" && !manual ? (
                !busy &&
                (refusal ? (
                  <div className="flex max-w-xl flex-col gap-1.5" role="status" aria-live="assertive">
                    <span className="flex items-center gap-2.5 text-lg font-semibold text-destructive">
                      <CircleAlert className="size-6 shrink-0" />
                      That document was not valid.
                    </span>
                    <span className="text-lg text-pretty text-muted-foreground">
                      {scanning
                        ? `Take it back out of the scanner and have the right one ready — scanning again in ${refusal.secondsLeft}…`
                        : `Trying again in ${refusal.secondsLeft}…`}
                    </span>
                  </div>
                ) : captureStatus ? (
                  <div className="max-w-xl text-lg text-warning" role="status">
                    {captureStatus.message}{" "}
                    {scanning
                      ? "Check that the page is in the scanner — trying again"
                      : "Trying again"}
                    {captureStatus.triesLeft
                      ? ` (${captureStatus.triesLeft} ${
                          captureStatus.triesLeft === 1 ? "try" : "tries"
                        } left before you pick the file yourself)`
                      : ""}
                    …
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-muted-foreground" aria-live="polite">
                    {scanning ? <Spinner className="size-6 text-primary" /> : <WaitingDots className="text-primary" />}
                    <span className="text-lg">{scanning ? "Scanning your document…" : "Preparing the document…"}</span>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center gap-3 sm:items-start">
                  {manual && (
                    <p className="text-lg text-pretty text-muted-foreground">
                      The kiosk tried this document {MAX_AUTO_CAPTURES} times and it was not
                      accepted — please choose the file yourself, or ask a staff member at the
                      counter.
                    </p>
                  )}
                  <Button
                    variant="outline"
                    className="ks-attention-ring h-14 rounded-2xl px-7 text-lg"
                    disabled={busy}
                    onClick={() => onUpload(ask.id)}
                  >
                    <Paperclip className="size-6 animate-ks-nudge" />
                    Choose a PDF
                  </Button>
                </div>
              ))}
          </div>
        )}
        {ask.note && !detected && <StepNote text={ask.note} tone={ask.noteTone} />}
        {(spoke || stalled) && !detected && (
          <StepNag
            help={step?.help ?? DOCUMENT_HELP}
            intro={
              stalled && !spoke
                ? "The kiosk has tried this twice and the step has not passed. It may not be " +
                  "something you can fix from here."
                : undefined
            }
            openHelp={stalled && !spoke}
          >
            {ask.type === "action" ? (
              <Button
                className="ks-attention-ring h-14 rounded-2xl px-6 text-lg font-semibold"
                disabled={busy}
                onClick={() => setDetectedAt(turn)}
              >
                <Check className="size-6" />
                {step?.confirm ?? "I've done it — continue"}
              </Button>
            ) : (
              <Button
                className="ks-attention-ring h-14 rounded-2xl px-6 text-lg font-semibold"
                disabled={busy}
                onClick={() => onUpload(ask.id)}
              >
                <Paperclip className="size-6" />
                Choose a PDF instead
              </Button>
            )}
          </StepNag>
        )}
      </div>
    </div>
  );
}

function AskIcon({ ask }: { ask: Ask }) {
  const Icon = ask.id === "insertDocument" ? IdCard : ask.id === "payment" ? Wallet : ScanFace;
  return <Icon className="size-8 text-primary" />;
}

/** The card step's wait, drawn without a bar: this wait ends when a card reaches the
 *  reader, so a filling bar would promise a duration nobody can predict. */
function ReaderWaiting({ held }: { held: boolean }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground" aria-live="polite">
      <WaitingDots className="text-primary" />
      <span className="text-lg">
        {held ? "One moment…" : "Waiting for your card…"}
      </span>
    </div>
  );
}

/** A filling bar over a hardware detection window. While the kiosk talks the bar freezes
 *  where it stands and resumes from there — see `useDetectionWindow`. */
function DetectionBar({ ms, held, label }: { ms: number; held: boolean; label: string }) {
  return (
    <div className="flex w-full flex-col items-center gap-2.5 sm:items-start">
      <div className="flex items-center gap-3 text-muted-foreground">
        <WaitingDots className="text-primary" />
        <span className="text-lg">{held ? "Listen to the instructions first…" : label}</span>
      </div>
      <div className="h-2.5 w-full max-w-sm overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "ks-gradient h-full origin-left animate-ks-fill",
            held && "[animation-play-state:paused]",
          )}
          style={{ animationDuration: `${ms}ms` }}
        />
      </div>
    </div>
  );
}
