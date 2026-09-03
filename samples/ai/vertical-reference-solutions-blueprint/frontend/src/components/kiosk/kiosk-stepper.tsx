// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Progress } from "@/components/ui/progress";
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
  return (
    <div className="mt-5">
      <div className="mb-4 flex flex-wrap gap-2.5">
        {steps.map((step, i) => (
          <div
            key={step}
            className={cn(
              "rounded-full px-5 py-2.5 text-base font-semibold whitespace-nowrap transition-all duration-300",
              i === currentIndex
                ? "ks-gradient ks-glow text-on-accent"
                : i < currentIndex
                  ? "bg-accent text-accent-foreground"
                  : "border bg-secondary text-muted-foreground/70",
            )}
          >
            {labelFor(step, service)}
          </div>
        ))}
      </div>
      <Progress
        value={((currentIndex + 1) / steps.length) * 100}
        className="h-2 [&_[data-slot=progress-indicator]]:ks-gradient [&_[data-slot=progress-indicator]]:animate-ks-flow [&_[data-slot=progress-indicator]]:bg-[length:220%_100%]"
      />
    </div>
  );
}
