// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { ArrowRight, Contrast, Globe } from "lucide-react";
import { useClock } from "@/hooks/use-clock";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KioskBrand } from "./kiosk-brand";
import { ModeToggle } from "./mode-toggle";
import { ThemeToggle } from "./theme-toggle";

function InfoPill({
  icon: Icon,
  label,
  iconClassName,
}: {
  icon: typeof Globe;
  label: string;
  iconClassName?: string;
}) {
  return (
    <span className="flex items-center gap-2.5 rounded-full border bg-secondary px-6 py-3 text-base font-semibold text-secondary-foreground backdrop-blur-md">
      <Icon className={cn("size-5", iconClassName)} strokeWidth={1.8} />
      {label}
    </span>
  );
}

export function WelcomeScreen({ onBegin }: { onBegin: () => void }) {
  const now = useClock();

  return (
    <div className="ks-aurora fixed inset-0 text-foreground">
      <button
        type="button"
        onClick={onBegin}
        className="absolute inset-0 flex cursor-pointer flex-col overflow-hidden text-left outline-none"
      >
        <div className="pointer-events-none absolute inset-0 bg-[image:var(--welcome-veil)]" />
        <div className="ks-grid pointer-events-none absolute inset-0 opacity-16" />
        <div className="pointer-events-none absolute -top-[14%] -right-[10%] size-[46vw] animate-ks-drift-a rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--cyan)_28%,transparent),transparent_70%)] blur-lg" />
        <div className="pointer-events-none absolute -bottom-[16%] -left-[12%] size-[42vw] animate-ks-drift-b rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--violet)_30%,transparent),transparent_70%)] blur-lg" />

        <header className="relative z-10 flex items-start justify-between px-[6%] pt-[4%]">
          <KioskBrand bobLogo />
          <div className="text-right">
            <div className="font-heading text-3xl font-semibold tracking-tight tabular-nums">
              {formatTime(now)}
            </div>
            <div className="text-base text-muted-foreground">{formatDate(now)}</div>
          </div>
        </header>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-7 px-[8%] text-center">
          <div
            className="flex animate-ks-rise items-center gap-3 rounded-full border bg-secondary px-6 py-3 text-base font-semibold tracking-[0.18em] text-secondary-foreground uppercase backdrop-blur-md"
            style={{ animationDelay: "50ms" }}
          >
            <span className="size-2.5 animate-ks-blink rounded-full bg-success shadow-[0_0_12px_var(--color-success)]" />
            Terminal Ready
          </div>
          <div
            className="animate-ks-rise font-heading text-6xl leading-[1.05] font-bold tracking-tight text-balance lg:text-7xl"
            style={{ animationDelay: "120ms" }}
          >
            How can we help
            <br />
            <span className="ks-hero-text">you today?</span>
          </div>
          <div
            className="max-w-2xl animate-ks-rise text-xl text-pretty text-muted-foreground"
            style={{ animationDelay: "200ms" }}
          >
            Licenses, registrations, certificates and payments — securely, in just a few taps.
          </div>
          <div className="relative mt-5 animate-ks-rise" style={{ animationDelay: "280ms" }}>
            <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--cyan)_40%,transparent),transparent_70%)] blur-xl" />
            <div className="ks-gradient ks-sheen relative inline-flex animate-ks-pulse items-center gap-4 rounded-full px-14 py-6 font-heading text-2xl font-bold text-on-accent">
              Touch to Begin
              <ArrowRight className="size-7" strokeWidth={2.2} />
            </div>
          </div>
        </div>

        <div aria-hidden className="h-[4%] min-h-16" />
      </button>
      <footer
        className="absolute bottom-[4%] left-1/2 z-20 flex -translate-x-1/2 animate-ks-fade items-center gap-4"
        style={{ animationDelay: "400ms" }}
      >
        <InfoPill icon={Globe} label="EN" iconClassName="text-cyan" />
        <ModeToggle
          showLabel
          className="flex items-center gap-2.5 rounded-full border bg-secondary px-6 py-3 text-base font-semibold text-secondary-foreground backdrop-blur-md transition-colors hover:bg-card"
        />
        <ThemeToggle
          showLabel
          className="flex items-center gap-2.5 rounded-full border bg-secondary px-6 py-3 text-base font-semibold text-secondary-foreground backdrop-blur-md transition-colors hover:bg-card"
        />
        <InfoPill icon={Contrast} label="High Contrast" iconClassName="text-pink" />
      </footer>
    </div>
  );
}
