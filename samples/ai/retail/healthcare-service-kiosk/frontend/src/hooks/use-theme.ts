// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useCallback, useSyncExternalStore } from "react";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE } from "@/lib/theme";

/* The theme lives on <html> as a `.dark` class (put there by the root layout
 * from the cookie, before the first byte reaches the browser), so it is
 * external state: subscribe via a MutationObserver rather than mirroring it
 * into React state. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

const getSnapshot = () => document.documentElement.classList.contains("dark");
const getServerSnapshot = () => false;

/** Reads and flips the dark-mode preference. See src/lib/theme.ts. */
export function useTheme() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    // Plain document.cookie, not a Server Action: the class is already on
    // <html>, and all the cookie has to do is survive until the next load.
    document.cookie = `${THEME_COOKIE}=${next ? "dark" : "light"}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
  }, []);

  return { dark, toggle };
}
