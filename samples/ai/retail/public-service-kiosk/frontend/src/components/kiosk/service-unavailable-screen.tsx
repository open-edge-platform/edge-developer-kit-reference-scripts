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
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[linear-gradient(145deg,#1a2233_0%,#2b3648_55%,#3a3350_100%)] text-white">
      <header className="flex items-center justify-between px-[6%] pt-[4%]">
        <KioskBrand onDark />
        <div className="text-right">
          <div className="text-3xl font-semibold">{formatTime(now)}</div>
          <div className="text-base text-white/70">{formatDate(now)}</div>
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-7 px-[8%] text-center">
        <div className="flex size-32 items-center justify-center rounded-full border border-white/20 bg-white/10">
          <CloudOff className="size-16 text-amber-300" strokeWidth={1.6} />
        </div>
        <div className="text-lg font-semibold tracking-[0.22em] text-white/70 uppercase">
          Out of Service
        </div>
        <div className="text-5xl leading-[1.1] font-bold tracking-tight text-balance lg:text-6xl">
          Service temporarily
          <br />
          unavailable
        </div>
        <div className="max-w-2xl text-xl text-pretty text-white/75">
          This kiosk cannot process requests right now. We apologise for the
          inconvenience — please try again later or visit the service counter
          for assistance.
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-full border border-white/20 bg-white/10 px-8 py-4 text-lg font-semibold text-white/85">
          <Spinner className="size-5" />
          Reconnecting automatically…
        </div>
      </div>

      <footer className="flex items-center justify-center px-[6%] pb-[4%] text-base text-white/50">
        The kiosk will resume on its own as soon as the connection is restored.
      </footer>
    </div>
  );
}
