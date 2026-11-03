// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Check } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { isFree } from "@/services/shared/flow";
import type { KioskStepId, ServiceDefinition } from "@/services/types";
import { cn } from "@/lib/utils";

const DEFAULT_LABELS: Record<string, string> = {
  service: "Service",
  consent: "Consent",
  identity: "Verify",
  application: "Application",
  documents: "Documents",
  payment: "Payment",
  receipt: "Receipt",
};

function labelFor(step: KioskStepId, service: ServiceDefinition | null): string {
  return (
    service?.stepLabels?.[step] ??
    DEFAULT_LABELS[step] ??
    step.charAt(0).toUpperCase() + step.slice(1)
  );
}

type Props = {
  steps: KioskStepId[];
  currentIndex: number;
  service: ServiceDefinition | null;
};

export function KioskStepper({ steps, currentIndex, service }: Props) {
  if (!service || currentIndex === 0) return null;

  const free = isFree(service);
  const listed = steps.flatMap((step, i) => (free && step === "payment" ? [] : [{ step, i }]));
  // On the unlisted payment step, the receipt it is about to show is current.
  const current = listed.findIndex(({ i }) => i >= currentIndex);
  const shown = listed.map(({ step }) => step);

  return (
    <nav aria-label="Visit progress" className="mt-5">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <span className="font-heading text-lg font-semibold">{service.label}</span>
        <span className="shrink-0 text-base font-semibold text-muted-foreground tabular-nums">
          Step {current + 1} of {shown.length}
        </span>
      </div>
      <div className="mb-4 flex flex-wrap gap-2.5">
        {shown.map((step, i) => (
          <div
            key={step}
            aria-current={i === current ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 text-base font-semibold whitespace-nowrap transition-all duration-300",
              i === current
                ? "ks-gradient text-on-accent"
                : i < current
                  ? "bg-accent text-accent-foreground"
                  : "border bg-secondary text-muted-foreground",
            )}
          >
            {i < current ? <Check className="size-4" aria-label="Completed" /> : <span className="opacity-75">{i + 1}.</span>}
            {labelFor(step, service)}
          </div>
        ))}
      </div>
      <Progress
        value={((current + 1) / shown.length) * 100}
        aria-label="Visit progress"
        className="h-2 [&_[data-slot=progress-indicator]]:ks-gradient"
      />
    </nav>
  );
}
