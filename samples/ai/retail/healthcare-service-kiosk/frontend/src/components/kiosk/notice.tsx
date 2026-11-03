// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_SURFACE, type Tone } from "./tone";

type Props = {
  tone?: Tone;
  /** Defaults to the info glyph; pass a specific one to sharpen the meaning. */
  icon?: LucideIcon;
  className?: string;
  children: React.ReactNode;
};

/** Icon-led callout panel used to explain rules or flag registry findings. */
export function Notice({ tone = "info", icon: Icon = Info, className, children }: Props) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl p-4 text-base",
        TONE_SURFACE[tone],
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", tone === "info" && "text-primary")} />
      <div>{children}</div>
    </div>
  );
}
