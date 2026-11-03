// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, FlaskConical, Sparkles, Stethoscope, type LucideIcon } from "lucide-react";
import { Notice } from "@/components/kiosk/notice";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import {
  DOCTOR_LINE,
  LAB_GLOSSARY,
  LAB_STATUS_LABEL,
  labCounts,
  readLab,
  templateExplanation,
  type LabReading,
} from "@/hospital/labs";
import { patientRecord, type LabResult } from "@/hospital/records";
import { explainLabResults } from "@/lib/api/labs";
import { countOf, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { resultData } from "@/services/shared/result";
import type { StepProps } from "@/services/shared/step-props";
import { StatusStep, StepShell } from "@/services/shared/step-shell";
import { labResultsResult } from "../lab-results";

const TONE: Record<LabResult["flag"], { chip: string; marker: string; icon: LucideIcon }> = {
  normal: { chip: "bg-success/10 text-success", marker: "bg-success", icon: Check },
  high: { chip: "bg-warning/10 text-warning", marker: "bg-warning", icon: ArrowUp },
  low: { chip: "bg-warning/10 text-warning", marker: "bg-warning", icon: ArrowDown },
};

export default function ResultsStep({ state, actions }: StepProps) {
  const documentNumber = state.identity!.documentNumber;
  const labs = patientRecord(documentNumber).labResults;
  const explained = useQuery({
    queryKey: ["lab-explanation", documentNumber],
    queryFn: () => explainLabResults(documentNumber),
    enabled: Boolean(labs),
    staleTime: Infinity,
    retry: false,
  });

  if (!labs) {
    return (
      <StatusStep
        title="Lab Results"
        icon={FlaskConical}
        heading="No results yet"
        description="There are no lab results on your record yet."
      />
    );
  }

  const { date, results } = labs;
  const explanation = explained.isPending ? undefined : (explained.data ?? templateExplanation(results));
  const { total, inRange, outside } = labCounts(results);

  return (
    <StepShell
      title="Your lab results"
      subtitle={
        <div className="flex flex-wrap items-center justify-center gap-3">
          <span className="mr-1">From {formatShortDate(date)}</span>
          <CountChip className="bg-secondary text-ink">{countOf(total, "test")}</CountChip>
          <CountChip className="bg-success/10 text-success">{inRange} in range</CountChip>
          {outside > 0 && <CountChip className="bg-warning/10 text-warning">{outside} outside the usual range</CountChip>}
        </div>
      }
      className="max-w-7xl"
    >
      <div className="grid gap-5 md:landscape:grid-cols-3">
        {results.map((result) => (
          <ResultCard
            key={result.test}
            result={result}
            text={explanation?.items.find((item) => item.test === result.test)?.text}
            aiAssisted={explanation?.aiAssisted ?? false}
            loading={!explanation}
          />
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center">
        <Notice icon={Stethoscope} className="flex-1 text-lg">
          {explanation?.aiAssisted && <AiBadge className="mr-2" />}
          {explanation?.closing ?? DOCTOR_LINE}
        </Notice>
        <StepActions
          ready
          label="Continue"
          className="mt-0"
          onContinue={() => actions.stepCompleted("application", resultData(labResultsResult(date, results, explanation)))}
        />
      </div>
    </StepShell>
  );
}

function CountChip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("rounded-full px-4 py-1.5 text-lg font-semibold", className)}>{children}</span>;
}

function AiBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-0.5 align-middle text-sm font-semibold text-primary",
        className,
      )}
    >
      <Sparkles className="size-4" />
      AI-assisted
    </span>
  );
}

function ResultCard({
  result,
  text,
  aiAssisted,
  loading,
}: {
  result: LabResult;
  text?: string;
  aiAssisted: boolean;
  loading: boolean;
}) {
  const reading = readLab(result);
  const tone = TONE[result.flag];
  const StatusIcon = tone.icon;
  const measures = LAB_GLOSSARY[result.test]?.measures;
  return (
    <StepCard className="flex flex-col gap-4 p-6 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{result.test}</h2>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-base font-semibold", tone.chip)}>
          <StatusIcon className="size-4" strokeWidth={3} />
          {LAB_STATUS_LABEL[result.flag]}
        </span>
      </div>
      {measures && <p className="-mt-2 text-base text-pretty text-muted-foreground">Measures {measures}.</p>}

      <div className="flex items-baseline gap-2">
        <span className="font-heading text-4xl font-bold tabular-nums">{result.value.match(/^[\d.]+/)?.[0]}</span>
        <span className="text-xl text-muted-foreground">{reading.unit}</span>
      </div>

      <RangeBar result={result} reading={reading} marker={tone.marker} />

      <div className="mt-auto border-t pt-4">
        {loading ? (
          <div className="flex flex-col gap-2.5" aria-label="Preparing a plain-language explanation">
            <div className="h-4 w-full animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-11/12 animate-pulse rounded-full bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded-full bg-muted" />
          </div>
        ) : (
          <>
            {aiAssisted && <AiBadge className="mb-2" />}
            <p className="text-lg leading-relaxed text-pretty">{text}</p>
          </>
        )}
      </div>
    </StepCard>
  );
}

/** Where the value sits against its usual range; a one-sided range ("< 5.2") is shaded from the left edge. */
function RangeBar({ result, reading, marker }: { result: LabResult; reading: LabReading; marker: string }) {
  const { amount, low, high } = reading;
  const bandLow = low ?? high / 2;
  const pad = (high - bandLow) / 2;
  const min = Math.max(0, Math.min(low === undefined ? bandLow : bandLow - pad, amount - pad / 3));
  const max = Math.max(high + pad, amount + pad / 3);
  const at = (value: number) => ((value - min) / (max - min)) * 100;
  const start = low === undefined ? 0 : at(low);
  const end = at(high);
  const [lowLabel, highLabel] = result.range.match(/[\d.]+/g) ?? [];

  return (
    <div role="img" aria-label={`${result.value}, usual range ${result.range}`}>
      <div className="relative h-3.5 rounded-full bg-muted">
        <div
          className="absolute inset-y-0 rounded-full bg-success/30"
          style={{ left: `${start}%`, right: `${100 - end}%` }}
        />
        <div
          className={cn(
            "absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-card shadow-md",
            marker,
          )}
          style={{ left: `${at(amount)}%` }}
        />
      </div>
      <div className="relative mt-2 h-5 text-sm font-medium text-muted-foreground tabular-nums">
        {low !== undefined && (
          <span className="absolute -translate-x-1/2" style={{ left: `${start}%` }}>
            {lowLabel}
          </span>
        )}
        <span className="absolute -translate-x-1/2" style={{ left: `${end}%` }}>
          {low === undefined ? lowLabel : highLabel}
        </span>
      </div>
      <p className="mt-1 text-base text-muted-foreground">Usual range {result.range}</p>
    </div>
  );
}
