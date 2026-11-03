// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CtaButton } from "./cta-button";

/** Right-aligned action row closing a step's card. */
export function StepFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("mt-8 flex justify-end", className)}>{children}</div>;
}

type Props = {
  /** False while the step's inputs are incomplete — shows `idleLabel` instead. */
  ready: boolean;
  onContinue: () => void;
  /**
   * Prompt naming what is still missing, e.g. "Select a purpose to continue".
   * Only needed when `ready` can actually be false.
   */
  idleLabel?: string;
  label?: string;
  className?: string;
};

/**
 * The standard "Continue →" footer. While the step is incomplete the button is
 * disabled and its label tells the visitor what to do rather than repeating
 * "Continue".
 */
export function StepActions({
  ready,
  onContinue,
  label = "Continue",
  idleLabel = label,
  className,
}: Props) {
  return (
    <StepFooter className={className}>
      <CtaButton disabled={!ready} onClick={onContinue}>
        {ready ? (
          <>
            {label}
            <ArrowRight />
          </>
        ) : (
          idleLabel
        )}
      </CtaButton>
    </StepFooter>
  );
}
