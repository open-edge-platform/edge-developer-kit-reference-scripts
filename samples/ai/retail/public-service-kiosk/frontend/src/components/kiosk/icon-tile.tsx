// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  icon: LucideIcon;
  className?: string;
  iconClassName?: string;
};

/** Soft gradient tile that frames an icon on category, auth and payment cards. */
export function IconTile({ icon: Icon, className, iconClassName }: Props) {
  return (
    <div
      className={cn(
        "flex size-20 shrink-0 items-center justify-center rounded-2xl border border-cyan/20 bg-gradient-to-br from-cyan/15 to-violet/10",
        className,
      )}
    >
      <Icon className={cn("size-10 text-primary", iconClassName)} strokeWidth={1.6} />
    </div>
  );
}
