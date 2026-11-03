// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Barcode, ChevronRight, CreditCard, HeartHandshake, IdCard, Smartphone, Ticket, TriangleAlert } from "lucide-react";
import { useBarcodeInput } from "@/hooks/use-barcode-input";
import { useClock } from "@/hooks/use-clock";
import { usePaperFeed } from "@/hooks/use-paper-feed";
import { useServiceHealth } from "@/hooks/use-kiosk-api";
import { submitScan, watchScannedCode, type ScanIntake } from "@/lib/api/kiosk";
import { formatDate, formatTime } from "@/lib/format";
import { AccessibilityMenu } from "./accessibility-menu";
import { BarcodeScannerVisual } from "./device-visual";
import { EmergencyBanner } from "./emergency-banner";
import { KioskBrand } from "./kiosk-brand";
import { ModeToggle } from "./mode-toggle";
import { SecondaryButton } from "./secondary-button";
import { ThemeToggle } from "./theme-toggle";

const ACCEPTED = [
  { icon: Ticket, label: "Appointment slip" },
  { icon: CreditCard, label: "Patient card" },
  { icon: Smartphone, label: "Slip on your phone" },
];

/** `onSignIn` opens identification (the assistant kiosk just begins); a code scanned here is already waiting for it at the server. */
export function WelcomeScreen({
  onBegin,
  onSignIn = onBegin,
}: {
  onBegin: () => void;
  /** Told what was scanned, when it was a scan. */
  onSignIn?: (scanned?: ScanIntake["kind"]) => void;
}) {
  const now = useClock();
  const health = useServiceHealth();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handedOver = useRef(false);
  const onSignInRef = useRef(onSignIn);
  useEffect(() => {
    onSignInRef.current = onSignIn;
  });

  const scan = (input: { code: string } | { simulate: "card" | "slip" }) => {
    setError(null);
    setReading(true);
    handedOver.current = true;
    submitScan(input)
      .then((intake) => onSignIn(intake.kind))
      .catch((failure: Error) => {
        handedOver.current = false;
        setReading(false);
        setError(failure.message);
      });
  };
  useBarcodeInput((code) => scan({ code }));

  // A scanner the server reads itself never types into this page; sign-in finds its code waiting.
  useEffect(() => {
    const control = new AbortController();
    let live = true;
    void (async () => {
      while (live) {
        try {
          if (await watchScannedCode(control.signal)) {
            if (live && !handedOver.current) onSignInRef.current();
            return;
          }
        } catch {
          return;
        }
      }
    })();
    return () => {
      live = false;
      control.abort();
    };
  }, []);

  // A page already in the document scanner is read by the sign-in screen it opens.
  usePaperFeed({ enabled: !reading, round: 0, onFed: () => onSignIn() });

  return (
    <div className="ks-aurora fixed inset-0 overflow-y-auto text-foreground">
      <div className="mx-auto flex min-h-full max-w-[1600px] flex-col px-6 sm:px-10 lg:px-16">
        <header className="flex items-center justify-between gap-6 border-b py-6 lg:py-8">
          <KioskBrand />
          <div className="hidden shrink-0 text-right sm:block">
            <div className="text-2xl font-semibold tracking-tight tabular-nums">{formatTime(now)}</div>
            <div className="mt-1 text-sm text-muted-foreground">{formatDate(now)}</div>
          </div>
        </header>

        <main className="hc-welcome-content grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-14">
          <section className="hc-welcome-intro animate-ks-rise">
            <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-primary/15 bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground">
              <span className="size-2 rounded-full bg-primary" aria-hidden />
              Welcome to patient self-service
            </div>
            <h1 className="font-heading text-5xl leading-[1.08] font-semibold tracking-tight sm:text-6xl xl:text-7xl">
              Your care.<br />
              <span className="text-primary">A simpler start.</span>
            </h1>
            <p className="mt-6 max-w-lg text-xl leading-relaxed text-muted-foreground">
              We’re here to help you get started. Manage your visit, find your way and take the next step in your care.
            </p>
            <button
              type="button"
              onClick={onBegin}
              className="ks-gradient ks-glow mt-9 inline-flex min-h-18 w-full cursor-pointer items-center justify-between gap-10 rounded-2xl px-7 py-5 text-xl font-semibold text-on-accent transition hover:brightness-105 active:scale-[0.98] sm:w-auto"
            >
              Touch to Begin <ArrowRight className="size-6" aria-hidden />
            </button>
            <p className="mt-4 text-base text-muted-foreground">Find your way, book a visit, see results or pay a bill.</p>
          </section>

          <aside className="hc-welcome-guide ks-rest flex flex-col overflow-hidden rounded-[2rem] border bg-card">
            <div className="hc-welcome-guide-heading px-7 pt-7 sm:px-9">
              <p className="text-sm font-bold tracking-[0.18em] text-primary uppercase">Have an appointment today?</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Scan to check in</h2>
              <p className="mt-2 text-lg leading-relaxed text-muted-foreground">
                Hold your slip or patient card — on paper or on your phone — under the scanner. We&apos;ll take you straight to check-in.
              </p>
            </div>
            <div className="mx-7 mt-5 flex flex-col items-center gap-3.5 rounded-3xl bg-accent/60 px-6 pt-6 pb-4 sm:mx-9">
              <BarcodeScannerVisual state={reading ? "done" : "waiting"} />
              <p className="inline-flex items-center gap-2 text-base font-semibold text-primary">
                <ArrowDown className="size-5 animate-ks-nudge" aria-hidden />
                Scanner is just below the screen
              </p>
              {health.services?.barcode === "off" && (
                <div className="flex flex-wrap justify-center gap-2.5">
                  <SecondaryButton className="h-11 rounded-xl bg-card px-4 text-sm" onClick={() => scan({ simulate: "slip" })}>
                    <Barcode className="size-4" />
                    Demo slip
                  </SecondaryButton>
                  <SecondaryButton className="h-11 rounded-xl bg-card px-4 text-sm" onClick={() => scan({ simulate: "card" })}>
                    <CreditCard className="size-4" />
                    Demo card
                  </SecondaryButton>
                </div>
              )}
            </div>
            <ul className="mx-7 mt-3 grid grid-cols-3 gap-3 sm:mx-9">
              {ACCEPTED.map(({ icon: Icon, label }) => (
                <li key={label} className="flex flex-col items-center gap-2.5 rounded-2xl border px-3 py-3.5 text-center text-base leading-snug font-semibold">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
            {error && (
              <p className="mx-7 mt-4 flex items-start gap-2.5 text-base font-medium text-destructive sm:mx-9">
                <TriangleAlert className="mt-0.5 size-5 shrink-0" />
                {error}
              </p>
            )}
            <div className="mt-6 border-t bg-secondary/50 px-7 py-5 sm:px-9">
              <p className="mb-2.5 text-base text-muted-foreground">No slip or card with you?</p>
              <SecondaryButton className="h-14 w-full justify-between bg-card px-5 text-base" onClick={() => onSignIn()}>
                <span className="flex items-center gap-3">
                  <IdCard className="size-5 text-primary" />
                  Use MyKad, a document or my MRN
                </span>
                <ChevronRight className="size-5 text-muted-foreground" />
              </SecondaryButton>
            </div>
          </aside>
        </main>

        <EmergencyBanner className="mb-6" />

        <footer className="flex flex-wrap items-center justify-between gap-5 border-t py-5">
          <div className="flex items-center gap-3 text-base text-muted-foreground">
            <HeartHandshake className="size-5 shrink-0 text-primary" aria-hidden />
            <span>Need a hand? Our reception team can help.</span>
          </div>
          <div className="flex items-center gap-3">
            <AccessibilityMenu showLabel className="flex min-h-12 items-center gap-2.5 rounded-xl border bg-card px-4 text-sm font-semibold transition-colors hover:bg-secondary" />
            <ModeToggle showLabel className="flex min-h-12 items-center gap-2.5 rounded-xl border bg-card px-4 text-sm font-semibold transition-colors hover:bg-secondary" />
            <ThemeToggle showLabel className="flex min-h-12 items-center gap-2.5 rounded-xl border bg-card px-4 text-sm font-semibold transition-colors hover:bg-secondary" />
          </div>
        </footer>
      </div>
    </div>
  );
}
