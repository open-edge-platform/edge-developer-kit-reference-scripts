// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { ClosingActions } from "@/components/kiosk/closing-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { SuccessBadge } from "@/components/kiosk/success-badge";
import { useAutoRestart } from "@/hooks/use-auto-restart";
import { readResult } from "../result";
import type { StepProps } from "../step-props";

export default function ResultStep(props: StepProps) {
  return <Result {...props} />;
}

/** The result screen; a service's own `steps/result.tsx` passes `extra` (another way to take the result away). */
export function Result({ service, state, actions, extra }: StepProps & { extra?: ReactNode }) {
  const result = readResult(state.data);
  const restart = useAutoRestart({ when: true, onRestart: actions.reset });

  return (
    <div className="grid w-full max-w-5xl animate-ks-fade items-center gap-9 md:landscape:grid-cols-2 portrait:max-w-3xl">
      <div className="flex flex-col items-center gap-4 text-center">
        <SuccessBadge />
        <h1 className="text-4xl font-bold tracking-tight">{result.title || service!.label}</h1>
        {result.intro && (
          <p className="text-xl text-pretty text-muted-foreground">{result.intro}</p>
        )}
        <ClosingActions
          restart={restart}
          signedIn={Boolean(state.identity)}
          onFinish={actions.reset}
          onAnother={actions.anotherService}
        />
        {extra}
      </div>

      <StepCard className="p-8" data-print>
        {result.rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-4 border-b py-4">
            <span className="shrink-0 text-lg text-muted-foreground">{row.label}</span>
            <span className="text-right text-lg font-semibold">{row.value}</span>
          </div>
        ))}
        {result.note && (
          <div className="flex items-start gap-2.5 pt-4 text-base text-muted-foreground">
            <Info className="mt-0.5 size-5 shrink-0 text-warning" />
            {result.note}
          </div>
        )}
      </StepCard>
    </div>
  );
}
