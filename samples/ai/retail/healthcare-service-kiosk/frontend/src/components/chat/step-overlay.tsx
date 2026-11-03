// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Volume2 } from "lucide-react";
import type { Ask } from "@/app/api/_lib/flows/types";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { AskRow } from "./ask-row";
import type { CaptureStatus, Refusal } from "./device-steps";
import { FaceAsk } from "./face-ask";
import { TurnFailed } from "./turn-failed";

const CAMERA_ASK_IDS = new Set(["biometric", "portrait"]);

/** Covers the transcript while a physical step waits; nothing dismisses it but the step finishing. */
export function StepOverlay({
  asks,
  busy,
  processing,
  speaking,
  narrated,
  manualAskIds,
  spoke,
  turn,
  captureStatus,
  refusal,
  failed,
  onRetry,
  onConfirm,
  onOption,
  onUpload,
}: {
  asks: Ask[];
  busy: boolean;
  /** Busy with something the citizen sent, not just finishing the reply that asked for these steps. */
  processing: boolean;
  speaking: boolean;
  narrated: boolean;
  failed: boolean;
  onRetry: () => void;
  /** Documents the kiosk has stopped capturing by itself — see MAX_AUTO_CAPTURES. */
  manualAskIds: string[];
  spoke: boolean;
  /** Bumps every turn. A step asked again did not succeed, so it must re-arm. */
  turn: number;
  captureStatus: CaptureStatus | null;
  refusal: Refusal | null;
  /** `extra` rides along with the confirmation — values that answer no ask. */
  onConfirm: (ask: Ask, extra?: Record<string, string>) => void;
  onOption: (ask: Ask, value: string) => void;
  onUpload: (askId: string) => void;
}) {
  // Detection is armed only once the kiosk has finished narrating the step — bar the card
  // step, which takes a card at once (see AskRow).
  const held = busy || speaking;

  return (
    <div
      // A region, not a `dialog`: the composer underneath stays usable, so this is not modal.
      role="region"
      aria-label="Action needed at the kiosk"
      className={cn(
        "absolute inset-0 z-30 flex animate-ks-fade items-center justify-center p-4 sm:p-8",
        "bg-[color:var(--overlay)] supports-backdrop-filter:backdrop-blur-md",
        "portrait:rounded-3xl",
      )}
    >
      <div
        className={cn(
          "ks-attention-ring flex max-h-full w-full max-w-4xl animate-ks-pop flex-col gap-7",
          "overflow-y-auto rounded-[2rem] border-2 border-primary/40 bg-popover p-6",
          "shadow-[var(--shadow-lift)] sm:p-9",
        )}
      >
        <div>
          <div className="flex items-center gap-3 text-xl font-bold tracking-tight lg:text-2xl">
            <span className="size-3 animate-ks-blink rounded-full bg-teal shadow-[0_0_14px_var(--color-teal)]" />
            Your turn at the kiosk
          </div>
          <p className="mt-1.5 text-lg text-pretty text-muted-foreground">
            Do {asks.length > 1 ? "these" : "this"} on the machine in front of you — the kiosk
            picks up where you left off automatically.
          </p>
          {narrated && (
            <p className="mt-2.5 flex items-center gap-2.5 text-base text-pretty text-muted-foreground">
              <Volume2 className="size-5 shrink-0 text-primary" />
              I&apos;m reading this step aloud — ask me below if you&apos;re stuck.
            </p>
          )}
        </div>
        {asks.map((ask, index) => (
          <div
            key={ask.id}
            className={cn(index > 0 && "border-t pt-7")}
          >
            {CAMERA_ASK_IDS.has(ask.id) ? (
              <FaceAsk
                ask={ask}
                held={held}
                spoke={spoke}
                turn={turn}
                onDone={(frame) => onConfirm(ask, frame ? { faceFrame: frame } : undefined)}
              />
            ) : (
              <AskRow
                ask={ask}
                busy={busy}
                processing={processing}
                held={held}
                manual={manualAskIds.includes(ask.id)}
                spoke={spoke}
                captureStatus={captureStatus?.askId === ask.id ? captureStatus : null}
                refusal={refusal?.askId === ask.id ? refusal : null}
                turn={turn}
                onConfirm={onConfirm}
                onOption={onOption}
                onUpload={onUpload}
              />
            )}
          </div>
        ))}
        {processing && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Spinner className="size-6" />
            <span className="text-lg">Processing…</span>
          </div>
        )}
        {failed && !busy && <TurnFailed onRetry={onRetry} />}
      </div>
    </div>
  );
}
