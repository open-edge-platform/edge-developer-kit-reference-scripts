// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, Sparkles } from "lucide-react";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { formatMoney, kioskCurrency } from "@/lib/format";
import { OptionCards, TextField } from "@/services/shared/fields";
import { resultData } from "@/services/shared/result";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";
import { LAB_TESTS } from "@/hospital/data";
import { apiGet } from "@/lib/api/client";
import { labPriceResult, searchTests } from "../lab-price";

export default function TestStep({ state, actions }: StepProps) {
  const [query, setQuery] = useState(state.data.query ?? "");
  const [testId, setTestId] = useState(state.data.testId ?? "");
  const currency = kioskCurrency();
  const typed = query.trim();
  const local = typed ? searchTests(typed) : LAB_TESTS;
  // Words the catalog doesn't know go to the model, once the patient pauses typing.
  const settled = useSettled(typed, 600);
  const asked = useQuery({
    queryKey: ["lab-tests", settled],
    queryFn: () => apiGet<{ testIds: string[]; aiAssisted: boolean }>(`/lab-tests?q=${encodeURIComponent(settled)}`),
    enabled: Boolean(settled) && local.length === 0,
    staleTime: Infinity,
    retry: false,
  });
  const fromModel = local.length === 0 && settled === typed ? (asked.data?.testIds ?? []) : [];
  const matches = local.length > 0 ? local : LAB_TESTS.filter((t) => fromModel.includes(t.id));
  const chosen = LAB_TESTS.find((t) => t.id === testId);

  return (
    <StepShell title="Which test would you like priced?" subtitle="Search or pick a test below." className="max-w-5xl">
      <StepCard>
        <TextField
          id="query"
          label="Search"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setTestId("");
          }}
          placeholder="e.g. cholesterol, blood sugar"
          className="mb-6"
        />
        {typed && local.length === 0 && (
          <p className="mb-4 flex items-center gap-2 text-lg text-muted-foreground" role="status">
            <Sparkles className="size-5 text-primary" />
            {asked.isFetching || settled !== typed
              ? "Looking that up…"
              : matches.length > 0
                ? `Best match for "${typed}":`
                : `No test matches "${typed}" — pick one from the list below.`}
          </p>
        )}
        <OptionCards
          options={(matches.length > 0 || !typed || asked.isFetching ? matches : LAB_TESTS).map((t) => ({
            id: t.id,
            label: t.name,
            hint: formatMoney(t.price, currency),
            icon: FlaskConical,
          }))}
          value={testId}
          onSelect={setTestId}
          columns={3}
        />
        <StepActions
          ready={Boolean(chosen)}
          idleLabel="Select a test"
          label="Show pricing"
          onContinue={() =>
            actions.stepCompleted("application", {
              testId,
              ...resultData(labPriceResult(chosen!, (amount) => formatMoney(amount, currency))),
            })
          }
        />
      </StepCard>
    </StepShell>
  );
}

function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
