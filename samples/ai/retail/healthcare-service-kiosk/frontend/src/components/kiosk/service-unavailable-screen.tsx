// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { CloudOff } from "lucide-react";
import { useClock } from "@/hooks/use-clock";
import { formatDate, formatTime } from "@/lib/format";
import { Spinner } from "@/components/ui/spinner";
import { KioskBrand } from "./kiosk-brand";

/**
 * Full-screen out-of-service takeover shown while an AI service the kiosk
 * depends on is unreachable. Sits above every other layer (dialogs use z-50)
 * and offers no way through — the kiosk resumes on its own once the health
 * poll recovers.
 */
export function ServiceUnavailableScreen() {
  const now = useClock();

  return (
    <div className="ks-aurora fixed inset-0 z-[100] flex flex-col overflow-y-auto text-foreground">
      <header className="flex items-center justify-between gap-5 px-[6%] py-6">
        <KioskBrand />
        <div className="hidden shrink-0 text-right sm:block">
          <div className="text-3xl font-semibold">{formatTime(now)}</div>
          <div className="text-base text-muted-foreground">{formatDate(now)}</div>
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-8 text-center sm:px-[8%]">
        <div className="flex size-24 items-center justify-center rounded-full border border-border bg-card">
          <CloudOff className="size-12 text-warning" strokeWidth={1.6} />
        </div>
        <div className="text-sm font-semibold tracking-[0.16em] text-primary uppercase">
          Out of Service
        </div>
        <div className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance lg:text-6xl">
          Service temporarily
          <br />
          unavailable
        </div>
        <div className="max-w-2xl text-xl text-pretty text-muted-foreground">
          This kiosk cannot process requests right now. We apologise for the
          inconvenience — please try again later or visit the reception team
          for assistance.
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-full border border-border bg-card px-5 py-4 text-base font-semibold text-primary">
          <Spinner className="size-5" />
          Reconnecting automatically…
        </div>
      </div>

      <footer className="flex items-center justify-center px-[6%] pb-6 text-center text-sm text-muted-foreground">
        The kiosk will resume on its own as soon as the connection is restored.
      </footer>
    </div>
  );
}
