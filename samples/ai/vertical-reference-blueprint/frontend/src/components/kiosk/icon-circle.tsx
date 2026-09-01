// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/lib/utils";
import type { Tone } from "./tone";

/** Tinted disc backgrounds — `info` is the neutral resting state. */
const CIRCLE_TONES: Record<Tone, string> = {
  info: "bg-accent",
  warning: "bg-warning/10",
  danger: "bg-destructive/10",
  success: "bg-success/10",
};

/** Round tinted backdrop for a status glyph on cards and result panels. */
export function IconCircle({
  tone = "info",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex size-22 items-center justify-center rounded-full",
        CIRCLE_TONES[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
