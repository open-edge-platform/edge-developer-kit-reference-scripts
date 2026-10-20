// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import { Check, FileText, RotateCcw, ScanLine } from "lucide-react";
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
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { plural } from "@/lib/format";
import { IMAGE_SRC_CHARS, safeImageSrc } from "@/lib/validation";
import type { CapturePhase, DocumentCapture, DocumentSource } from "@/lib/api/kiosk";
import { cn } from "@/lib/utils";

/**
 * What the citizen sees while a document is being captured and checked, and
 * what they see of the document before either is committed.
 *
 * Both exist for the same reason. Capturing a document is two long waits
 * back to back — the scanner, then OCR and the model — and the kiosk used to
 * spend all of it on one spinner under one sentence, still asking for paper
 * the scanner had already swallowed. And the first look the citizen got at
 * their own document was the verdict on it, which is too late to notice they
 * fed it in upside down.
 */

/** The sentence for each phase the server reports, in the order they happen. */
const PHASE_LABEL: Record<CapturePhase, string> = {
  waiting: "Feed your document into the scanner",
  scanning: "Scanning your document",
  packing: "Preparing the pages",
  storing: "Saving your document",
  reading: "Reading the text",
  grouping: "Sorting the pages",
  checking: "Checking it against your identity",
};

/**
 * Roughly how far through the whole capture each phase is. Rough on purpose:
 * a real percentage would need the OCR and the model to know how long they
 * are going to take, and they do not. What the bar has to do is move, and
 * move in the right direction, so the wait reads as work rather than as a
 * machine that has stopped.
 */
const PHASE_PROGRESS: Record<CapturePhase, number> = {
  waiting: 6,
  scanning: 22,
  packing: 38,
  storing: 48,
  reading: 62,
  grouping: 80,
  checking: 90,
};

/** Seconds since this note appeared, so a long wait visibly keeps counting. */
function useElapsed(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

export type CaptureProgress = {
  phase: CapturePhase | null;
  /** Page being read, on the OCR pass through a multi-sheet document. */
  page?: number;
  pageCount?: number;
};

/**
 * The live phase, a bar that tracks it, and the seconds spent so far.
 *
 * `fallback` covers the gap before the first phase is reported — the request
 * is in flight but the server has not said anything yet, and a blank line
 * there reads worse than the wrong one.
 */
export function CaptureProgressNote({
  progress,
  fallback,
  className,
}: {
  progress: CaptureProgress;
  fallback: string;
  className?: string;
}) {
  const elapsed = useElapsed();
  const { phase, page, pageCount } = progress;
  const label = phase ? PHASE_LABEL[phase] : fallback;
  const pageNote =
    phase === "reading" && page && pageCount && pageCount > 1
      ? ` — page ${page} of ${pageCount}`
      : "";

  return (
    <div className={cn("flex w-full flex-col items-center gap-2.5", className)}>
      <div className="text-base text-muted-foreground">
        {label}
        {pageNote}…
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={phase ? PHASE_PROGRESS[phase] : undefined}
        aria-label={label}
        className="h-1.5 w-full max-w-64 overflow-hidden rounded-full bg-muted"
      >
        {phase ? (
          <div
            className="ks-gradient h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${PHASE_PROGRESS[phase]}%` }}
          />
        ) : (
          // Nothing reported yet: an indeterminate sweep rather than a bar
          // parked at zero, which reads as a wait that never started.
          <div className="ks-gradient h-full w-1/3 animate-ks-flow bg-[length:220%_100%]" />
        )}
      </div>
      {/* Kept off screen readers: an announcement every second is noise. */}
      <div aria-hidden className="text-sm tabular-nums text-muted-foreground/70">
        {elapsed >= 3 ? `${elapsed}s` : "\u00a0"}
      </div>
    </div>
  );
}

/**
 * The captured pages, before anything is filed. Confirming runs the check;
 * discarding forgets the capture and lets the citizen feed the paper in
 * again. The check itself runs inside this dialog rather than behind it, so
 * the pages stay on screen while the kiosk is reading them.
 */
export function DocumentPreviewDialog({
  capture,
  requirementLabel,
  source,
  busy,
  progress,
  error,
  onConfirm,
  onDiscard,
}: {
  capture: DocumentCapture | null;
  requirementLabel: string;
  source: DocumentSource;
  /** The confirmed capture is being stored and checked right now. */
  busy: boolean;
  progress: CaptureProgress;
  error?: string;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const again =
    source === "scanner" ? "Scan again" : source === "mock" ? "Try again" : "Pick another file";
  const hidden = capture ? Math.max(capture.pages - capture.previews.length, 0) : 0;

  return (
    <Dialog
      open={Boolean(capture)}
      // Closing by tapping outside or pressing Escape means the same thing as
      // tapping the discard button, and must free the capture the same way.
      onOpenChange={(open) => !open && !busy && onDiscard()}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[90vh] gap-6 overflow-y-auto p-8 sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle className="text-2xl leading-tight">
            Is this your {requirementLabel.toLowerCase()}?
          </DialogTitle>
          <DialogDescription className="text-base">
            {capture?.simulated
              ? "No scanner answered, so the kiosk stood a document in. Check it before continuing."
              : "Check every page is the right way up and readable before it is checked."}
          </DialogDescription>
        </DialogHeader>

        {capture && (
          <>
            <div className="flex flex-wrap items-center justify-center gap-4">
              {capture.previews.length > 0 ? (
                capture.previews.map((page, index) => {
                  // Rebuilt inline, character by character off the allowlist:
                  // the security scan only trusts sanitization done in the
                  // same function as the sink. Empty src on a foreign char.
                  let src = "";
                  for (const ch of safeImageSrc(page)) {
                    let ok = "";
                    for (const allowed of IMAGE_SRC_CHARS) {
                      if (allowed === ch) {
                        ok = allowed;
                        break;
                      }
                    }
                    if (!ok) {
                      src = "";
                      break;
                    }
                    src += ok;
                  }
                  return (
                    <figure key={index} className="flex flex-col items-center gap-2">
                      {/* Data URLs off our own rasterizer — next/image would
                          only proxy them back through the optimizer. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={`Page ${index + 1} of the captured ${requirementLabel.toLowerCase()}`}
                        className="max-h-[46vh] rounded-xl border-2 border-border bg-white object-contain shadow-sm"
                      />
                      <figcaption className="text-sm text-muted-foreground">
                        Page {index + 1}
                      </figcaption>
                    </figure>
                  );
                })
              ) : (
                // Poppler missing, or a PDF it could not draw. The capture is
                // still good, so it is offered rather than thrown away.
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <FileText className="size-12 text-muted-foreground" strokeWidth={1.6} />
                  <div className="text-base text-muted-foreground">
                    This kiosk cannot show a picture of the pages — check the details below.
                  </div>
                </div>
              )}
            </div>

            <div className="text-center text-sm text-muted-foreground">
              {capture.fileName} · {capture.pages} {plural(capture.pages, "page")} ·{" "}
              {capture.sizeKb} KB
              {hidden > 0 && ` · ${hidden} more ${plural(hidden, "page")} not shown`}
            </div>
          </>
        )}

        {error && (
          <div className="rounded-2xl border-2 border-destructive/40 bg-destructive/5 p-4 text-center text-base font-medium text-destructive">
            {error}
          </div>
        )}

        {busy ? (
          <div className="flex flex-col items-center gap-4 border-t pt-6">
            <Spinner className="size-8 text-primary" />
            <CaptureProgressNote progress={progress} fallback="Checking your document" />
          </div>
        ) : (
          <DialogFooter className="gap-3">
            <SecondaryButton className="px-6" onClick={onDiscard}>
              {source === "scanner" ? (
                <ScanLine className="size-5" />
              ) : (
                <RotateCcw className="size-5" />
              )}
              {again}
            </SecondaryButton>
            <Button
              className="h-14 rounded-2xl px-8 text-lg font-semibold"
              onClick={onConfirm}
            >
              <Check className="size-5" />
              Yes, use this document
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
