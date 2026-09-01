// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { StatusBlock } from "@/components/kiosk/status-block";
import { StepCard } from "@/components/kiosk/step-card";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  subtitle?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

/** Centered heading + content wrapper shared by every flow step. */
export function StepShell({ title, subtitle, className, children }: Props) {
  return (
    <div className={cn("w-full max-w-5xl animate-ks-fade", className)}>
      <div className="mb-9 text-center">
        <h1 className="font-heading text-4xl font-bold tracking-tight text-balance lg:text-5xl">
          {title}
        </h1>
        {subtitle && <div className="mt-4 text-xl text-pretty text-muted-foreground">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * A step that ends the flow with a message instead of inputs: an ineligible
 * applicant, an unavailable service. `heading`/`description` explain the
 * outcome and where to go instead.
 */
export function StatusStep({
  title,
  subtitle,
  icon,
  heading,
  description,
  className = "max-w-3xl",
}: {
  title: string;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  heading: string;
  description: React.ReactNode;
  className?: string;
}) {
  return (
    <StepShell title={title} subtitle={subtitle} className={className}>
      <StepCard>
        <StatusBlock icon={icon} title={heading} description={description} />
      </StepCard>
    </StepShell>
  );
}
