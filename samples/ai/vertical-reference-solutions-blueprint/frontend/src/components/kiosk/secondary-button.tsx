// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Kiosk-sized outline button — the touch-target counterpart to `CtaButton`. */
export function SecondaryButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      className={cn(
        "h-14 rounded-2xl bg-secondary px-7 text-lg font-semibold text-ink backdrop-blur-md hover:bg-card [&_svg:not([class*='size-'])]:size-5",
        className,
      )}
      {...props}
    />
  );
}
