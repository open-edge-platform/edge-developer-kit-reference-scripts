// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Primary gradient call-to-action shared by every step's continue button. */
export function CtaButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(
        "ks-gradient ks-glow ks-sheen h-16 rounded-2xl px-10 font-heading text-xl font-semibold text-on-accent hover:opacity-90",
        "disabled:bg-muted disabled:bg-none disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none",
        "[&_svg:not([class*='size-'])]:size-6",
        className,
      )}
      {...props}
    />
  );
}
