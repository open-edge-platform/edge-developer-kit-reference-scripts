// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { readCard } from "@/lib/api/enrollment";

/** Detection window that holds where it is while the kiosk talks and resumes from there. */
export function useDetectionWindow({
  ms,
  paused,
  arm,
  onDetected,
}: {
  /** Undefined for a step the hardware does not detect by itself. */
  ms: number | undefined;
  paused: boolean;
  /** Only a bump here refills the window — deliberately NOT the turn counter. */
  arm: number;
  onDetected: () => void;
}) {
  const remaining = useRef(ms ?? 0);
  const armed = useRef(arm);
  const fire = useRef(onDetected);
  useEffect(() => {
    fire.current = onDetected;
  });
  useEffect(() => {
    // Refilled before the paused check: the previous run's cleanup already banked the remainder.
    if (armed.current !== arm) {
      armed.current = arm;
      remaining.current = ms ?? 0;
    }
    if (!ms || paused) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => fire.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [ms, paused, arm]);
}

/** Long-poll window the server waits at the reader; short enough that pausing is honoured promptly. */
const CARD_POLL_MS = 5_000;

const CARD_REMOVAL_POLL_MS = 700;

/** `/identity/card` distinguishes "no card yet" (404) from "no working reader" (503);
 *  only the latter lets the timer stand in for the hardware. */
export function useCardWatch({
  enabled,
  paused,
  arm,
  onDetected,
}: {
  enabled: boolean;
  paused: boolean;
  arm: number;
  onDetected: () => void;
}): { unavailable: boolean } {
  const [unavailable, setUnavailable] = useState(false);
  const fire = useRef(onDetected);
  useEffect(() => {
    fire.current = onDetected;
  });

  useEffect(() => {
    if (!enabled || paused) return;
    const control = new AbortController();
    let live = true;

    void (async () => {
      try {
        // A refused card is usually still in the slot, so a retry waits for it to be removed.
        while (live && arm > 0 && (await cardOnReader(control.signal))) {
          await new Promise<void>((r) => setTimeout(() => r(), CARD_REMOVAL_POLL_MS));
        }
        while (live) {
          try {
            await readCard(CARD_POLL_MS, control.signal, { handoff: true });
            if (live) fire.current();
            return;
          } catch (error) {
            // 404 means nothing was presented in that window — keep waiting.
            if (!(error instanceof ApiError) || error.status !== 404) throw error;
          }
        }
      } catch {
        // No reader, no PC/SC daemon, or simulating: fall back to the timer.
        if (live) setUnavailable(true);
      }
    })();

    return () => {
      live = false;
      control.abort();
    };
  }, [enabled, paused, arm]);

  return { unavailable };
}

/** Is a card sitting on the reader right now? `timeout=0` asks without waiting. */
async function cardOnReader(signal: AbortSignal): Promise<boolean> {
  try {
    await readCard(0, signal);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false;
    throw error;
  }
}
