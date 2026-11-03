// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { getPaperMode, watchPaper, type PaperMode } from "@/lib/api/kiosk";

/** This terminal's paper mode, and `onFed` when a page goes in; rounds after the first wait for the last page to come out. */
export function usePaperFeed({
  enabled,
  round,
  onFed,
}: {
  enabled: boolean;
  round: number;
  onFed: () => void;
}): PaperMode | null {
  const [mode, setMode] = useState<PaperMode | null>(null);
  const fire = useRef(onFed);
  useEffect(() => {
    fire.current = onFed;
  });

  useEffect(() => {
    let live = true;
    getPaperMode()
      .then((answer) => live && setMode(answer.mode))
      .catch(() => live && setMode("off"));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || (mode !== "sensor" && mode !== "simulated")) return;
    const control = new AbortController();
    let live = true;
    void (async () => {
      while (live) {
        try {
          const fed = await watchPaper(round > 0, control.signal);
          if (fed && live) return fire.current();
        } catch {
          // A feeder that stopped answering keeps the scan-on-request button.
          if (live) setMode((current) => (current === "sensor" ? "button" : current));
          return;
        }
      }
    })();
    return () => {
      live = false;
      control.abort();
    };
  }, [enabled, mode, round]);

  return mode;
}
