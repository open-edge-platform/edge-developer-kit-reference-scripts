// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Globe, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useClock } from "@/hooks/use-clock";
import { formatTime } from "@/lib/format";
import { activePack } from "@/packs";
import { AccessibilityMenu } from "./accessibility-menu";
import { KioskBrand } from "./kiosk-brand";
import { ModeToggle } from "./mode-toggle";
import { ThemeToggle } from "./theme-toggle";

/** `patient`: the visitor signed in this session, shown first name and initial only — the screen faces a public hall. */
export function KioskHeader({ patient, onSignOut }: { patient?: string | null; onSignOut?: () => void }) {
  const now = useClock();

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <KioskBrand />
      <div className="flex items-center gap-2 sm:gap-3">
        {patient && (
          <div className="flex items-center gap-1 rounded-full border border-primary/20 bg-accent py-1 pr-1 pl-4 text-sm font-semibold text-accent-foreground">
            <UserRound className="size-4 text-primary" aria-hidden />
            <span className="ml-1.5">{shortName(patient)}</span>
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="ml-2 flex cursor-pointer items-center gap-1.5 rounded-full bg-card px-3.5 py-2 text-sm font-semibold text-ink transition-colors hover:bg-secondary"
              >
                <LogOut className="size-4" aria-hidden />
                Sign out
              </button>
            )}
          </div>
        )}
        <Badge
          variant="secondary"
          className="hidden gap-2 rounded-full border bg-secondary px-4 py-2.5 text-sm font-medium text-ink sm:inline-flex"
        >
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          Secure
        </Badge>
        <span className="hidden items-center gap-2 px-2 text-sm font-medium text-muted-foreground sm:inline-flex">
          <Globe className="size-5 text-primary" aria-hidden />
          {languageName()}
        </span>
        <AccessibilityMenu className="flex size-12 items-center justify-center rounded-xl border bg-secondary transition-colors hover:bg-card" />
        <ModeToggle className="flex size-12 items-center justify-center rounded-xl border bg-secondary transition-colors hover:bg-card" />
        <ThemeToggle className="flex size-12 items-center justify-center rounded-xl border bg-secondary transition-colors hover:bg-card" />
        <div className="hidden font-heading text-base font-semibold tabular-nums md:block">{formatTime(now)}</div>
      </div>
    </div>
  );
}

/** The pack's one language, by name — informational, not a switcher (one locale per terminal). */
function languageName(): string {
  const code = activePack().locale.language;
  return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code.toUpperCase();
}

function shortName(name: string): string {
  const [first, ...rest] = name.split(/\s+/).filter(Boolean);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]}.` : (first ?? "");
}
