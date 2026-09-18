// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";

/**
 * Live clock that only starts after mount (avoids SSR hydration mismatch).
 * Returns `null` until the first client tick.
 */
export function useClock(): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Intentional: seed the clock on mount (client only) to avoid SSR mismatch,
    // then keep it in sync with the system clock via an interval.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return now;
}
