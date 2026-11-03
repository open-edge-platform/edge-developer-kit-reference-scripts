// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef } from "react";

/** A keyboard-wedge scanner types far faster than a person: ~30 ms a key is the usual cut-off. */
const MAX_KEY_GAP_MS = 50;
const MIN_LENGTH = 6;

/**
 * Hears a keyboard-wedge barcode scanner anywhere on the page.
 *
 * The scanner "types" its payload and presses Enter (or Tab). Keystrokes are
 * collected while they arrive faster than a person can type; Enter after at
 * least six of them is a scan. Typing into a focused field is left alone, so
 * the on-screen keyboard and text inputs keep working.
 */
export function useBarcodeInput(onScan: (code: string) => void, enabled = true) {
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  });

  useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let last = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const now = event.timeStamp || performance.now();
      if (now - last > MAX_KEY_GAP_MS) buffer = "";
      last = now;
      if (event.key === "Enter" || event.key === "Tab") {
        if (buffer.length >= MIN_LENGTH) {
          event.preventDefault();
          handler.current(buffer);
        }
        buffer = "";
        return;
      }
      if (event.key.length === 1) buffer += event.key;
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}
