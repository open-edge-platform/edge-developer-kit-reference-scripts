// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOff, Check, ScanFace } from "lucide-react";
import type { Ask } from "@/app/api/_lib/flows/types";
import {
  FaceViewport,
  captureFrame,
  facePhaseCopy,
  useFaceScanSequence,
} from "@/components/kiosk/face-scan";
import { Button } from "@/components/ui/button";
import { deviceSteps } from "./device-steps";
import { StepNag, StepNote } from "./step-notes";

const PORTRAIT_COPY = {
  scanning: { caption: "Taking your photo…", hint: "Keep still a moment while it is saved to your record." },
  blocked: "This kiosk cannot take your photo, so your record is made without one — the registration counter will take it.",
};

/** The face check — or a new patient's record photo — in the conversation. Deliberately shows
 *  no local tick: the server decides whether the face matched, or whether the photo is usable. */
export function FaceAsk({
  ask,
  held,
  spoke,
  turn,
  onDone,
}: {
  ask: Ask;
  held: boolean;
  spoke: boolean;
  turn: number;
  /** Handed the captured JPEG data URL, or null when there was no camera. */
  onDone: (frame: string | null) => void;
}) {
  // Recording the turn rather than a bare flag keeps the reset below exact: a turn the
  // citizen caused by typing at the composer must not look like an answer to the scan.
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const captured = capturedAt !== null;

  const scan = useFaceScanSequence({
    enabled: true,
    paused: held,
    outcome: "pending",
    onCapture: (frame) => {
      setCapturedAt(turn);
      onDone(frame);
    },
  });

  // A turn landing after the frame was sent, with this step still asked, means the frame
  // did not settle it — without re-arming the step sits on "Checking…" for ever.
  const retry = capturedAt !== null && turn !== capturedAt;
  if (retry) {
    setCapturedAt(null);
    scan.restart();
  }

  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (!scan.blocked || held || captured) return;
    const timer = setTimeout(() => {
      setCapturedAt(turn);
      doneRef.current(null);
    }, ask.autoAdvanceMs ?? 2_300);
    return () => clearTimeout(timer);
  }, [scan.blocked, held, captured, turn, ask.autoAdvanceMs]);

  const portrait = ask.id === "portrait";
  const step = deviceSteps()[ask.id] ?? deviceSteps().biometric;
  // A blocked camera must say so rather than leaving "Starting the camera…" up while the
  // step quietly answers itself.
  const copy = scan.blocked
    ? {
        caption:
          scan.cameraStatus === "denied"
            ? "The camera is blocked"
            : "No camera is available",
        hint: portrait
          ? PORTRAIT_COPY.blocked
          : "This kiosk cannot run the face scan, so verification continues without it — " +
            "a staff member may ask to confirm your identity instead.",
      }
    : portrait && scan.phase === "scanning"
      ? PORTRAIT_COPY.scanning
      : facePhaseCopy(scan.phase);

  return (
    <div className="flex flex-col items-center gap-7 text-center sm:flex-row sm:items-center sm:gap-9 sm:text-left">
      <div className="flex shrink-0 justify-center">
        {scan.blocked ? (
          <div className="flex size-16 items-center justify-center rounded-2xl bg-warning/10">
            <CameraOff className="size-8 text-warning" />
          </div>
        ) : (
          <FaceViewport phase={scan.phase} videoRef={scan.videoRef} live={scan.live} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xl font-semibold text-pretty break-words lg:text-2xl">{ask.question}</p>
        <div className="mt-4 flex flex-col items-center gap-3 sm:items-start">
          <div className="text-2xl font-bold tracking-tight text-primary lg:text-3xl">
            {copy.caption}
          </div>
          <p className="text-lg text-pretty text-muted-foreground">{copy.hint}</p>
          {ask.note && <StepNote text={ask.note} tone={ask.noteTone} />}
          {spoke && !captured && (
            <StepNag help={step.help}>
              <Button
                className="ks-attention-ring h-14 rounded-2xl px-6 text-lg font-semibold"
                onClick={() => {
                  setCapturedAt(turn);
                  onDone(captureFrame(scan.videoRef.current));
                }}
              >
                <Check className="size-6" />
                {step.confirm}
              </Button>
            </StepNag>
          )}
          {scan.canSkip && !held && (
            <Button
              variant="outline"
              className="h-13 rounded-2xl px-6 text-lg font-semibold"
              onClick={scan.scanNow}
            >
              <ScanFace className="size-6" />
              I&apos;m ready — scan now
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
