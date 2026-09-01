// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { CloudOff, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CtaButton } from "./cta-button";

type Props = {
  icon?: LucideIcon;
  /** Tailwind colour class for the glyph; defaults to a muted grey. */
  iconClassName?: string;
  title: string;
  description: React.ReactNode;
  /** Optional call to action, e.g. a retry button. */
  action?: React.ReactNode;
  className?: string;
};

/**
 * Centered "nothing to do here" panel: no matching records, an ineligible
 * applicant, or a failed lookup. Sits inside a `StepCard`.
 */
export function StatusBlock({
  icon: Icon,
  iconClassName,
  title,
  description,
  action,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "flex animate-ks-fade flex-col items-center gap-6 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <Icon
          className={cn("size-12 text-muted-foreground", iconClassName)}
          strokeWidth={1.5}
        />
      )}
      <div className="text-2xl font-bold tracking-tight">{title}</div>
      <div className="max-w-lg text-lg text-pretty text-muted-foreground">{description}</div>
      {action}
    </div>
  );
}

/** Inline failure message shown under a step's controls. */
export function StepError({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 text-center text-lg font-medium text-destructive">{children}</p>;
}

/**
 * A read that failed, with a retry. `message` states what could not be
 * loaded, e.g. "Could not load the service catalog" — no trailing period.
 */
export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <StatusBlock
      icon={CloudOff}
      title={message}
      description="Please try again in a moment."
      action={<CtaButton onClick={onRetry}>Try Again</CtaButton>}
    />
  );
}
