// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** The white panel every flow step lays its content on. */
export function StepCard({ className, children, ...props }: React.ComponentProps<typeof Card>) {
  return (
    <Card className={cn("ks-rest gap-0 rounded-3xl p-5 sm:p-9", className)} {...props}>
      {children}
    </Card>
  );
}
