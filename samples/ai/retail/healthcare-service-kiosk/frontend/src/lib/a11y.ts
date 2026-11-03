// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useSyncExternalStore } from "react";

export type TextSize = "standard" | "large" | "extra";

export type A11ySettings = { textSize: TextSize; highContrast: boolean };

const DEFAULTS: A11ySettings = { textSize: "standard", highContrast: false };

let settings = DEFAULTS;
const listeners = new Set<() => void>();

/** Mirrored onto <html> so the root font size and contrast tokens follow (globals.css). */
function apply(next: A11ySettings) {
  settings = next;
  const root = document.documentElement;
  if (next.textSize === "standard") delete root.dataset.textSize;
  else root.dataset.textSize = next.textSize;
  if (next.highContrast) root.dataset.contrast = "high";
  else delete root.dataset.contrast;
  for (const listener of listeners) listener();
}

export function setA11y(patch: Partial<A11ySettings>) {
  apply({ ...settings, ...patch });
}

/** Per visitor: the next person at the kiosk starts from the defaults. */
export function resetA11y() {
  if (settings !== DEFAULTS) apply(DEFAULTS);
}

export function useA11y(): A11ySettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => settings,
    () => DEFAULTS,
  );
}
