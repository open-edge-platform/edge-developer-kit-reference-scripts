// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { parseScannedCode } from "@/hospital/patient-id";
import { cn } from "@/lib/utils";
import { CtaButton } from "./cta-button";
import { NumericKeypad } from "./numeric-keypad";
import { StepError } from "./status-block";

const MRN_DIGITS = 8;

/** The MRN on a keypad, shown as printed (MRN 1234567-4); the check digit catches a typo before anything is looked up. */
export function MrnPad({ busy, finding, onSubmit }: { busy: boolean; finding: boolean; onSubmit: (code: string) => void }) {
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const shown = digits.padEnd(MRN_DIGITS, "·");

  const submit = () => {
    const parsed = parseScannedCode(digits);
    if (parsed.kind === "mrn") return onSubmit(parsed.mrn);
    setError("That number doesn't add up — check each digit against your card or letter.");
  };

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-3">
      <div
        aria-label={digits ? `MRN digits entered: ${digits.split("").join(" ")}` : "No MRN digits entered"}
        className={cn(
          "flex w-full items-baseline justify-center gap-2 rounded-2xl border-2 bg-background px-3 py-2 font-heading text-3xl font-bold tracking-[0.12em] tabular-nums",
          digits ? "border-primary ring-4 ring-primary/15" : "border-border",
        )}
      >
        <span className="text-lg font-bold tracking-normal text-muted-foreground">MRN</span>
        <span className={digits ? "" : "text-muted-foreground/50"}>
          {shown.slice(0, MRN_DIGITS - 1)}
          <span className="text-muted-foreground/70">–</span>
          {shown.slice(MRN_DIGITS - 1)}
        </span>
      </div>
      {error ? (
        <StepError>{error}</StepError>
      ) : (
        <p className="text-sm text-muted-foreground">On your patient card and hospital letters.</p>
      )}
      <NumericKeypad
        compact
        className="w-full"
        disabled={busy}
        onDigit={(digit) => {
          setError(null);
          setDigits((current) => (current.length < MRN_DIGITS ? current + digit : current));
        }}
        onBack={() => setDigits((current) => current.slice(0, -1))}
        onClear={() => setDigits("")}
      />
      <CtaButton className="h-13 w-full text-lg" onClick={submit} disabled={digits.length !== MRN_DIGITS || busy}>
        <Search />
        {finding ? "Finding…" : "Find my record"}
      </CtaButton>
    </div>
  );
}
