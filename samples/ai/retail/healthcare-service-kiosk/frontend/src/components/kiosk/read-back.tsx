// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Check, PencilLine, TriangleAlert, UserRound, type LucideIcon } from "lucide-react";
import type { CheckStatus } from "@/lib/document-fields";
import { cn } from "@/lib/utils";
import { TONE_SURFACE, type Tone } from "./tone";

const STATUS: Record<CheckStatus, { tone: Tone; icon: LucideIcon; label: string }> = {
  ok: { tone: "success", icon: Check, label: "Looks right" },
  warning: { tone: "warning", icon: TriangleAlert, label: "Please check" },
  staff: { tone: "danger", icon: UserRound, label: "Staff will review" },
  ask: { tone: "info", icon: PencilLine, label: "Needs your answer" },
};

export function CheckBadge({ status }: { status: CheckStatus }) {
  const { tone, icon: Icon, label } = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold",
        TONE_SURFACE[tone],
      )}
    >
      <Icon className="size-4" strokeWidth={2.4} />
      {label}
    </span>
  );
}

/** One value read off a document, how its check went, and — when the patient can fix it — the control to do so. */
export function ReadBackRow({
  label,
  value,
  status,
  note,
  onChange,
  children,
}: {
  label: string;
  value: string | null | undefined;
  status: CheckStatus;
  note?: string;
  /** Offers "Change" on a value the patient may correct even though it passed. */
  onChange?: () => void;
  /** The correction control, shown under the row while it is open. */
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b py-4 last:border-b-0">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-base text-muted-foreground">{label}</div>
          <div className="mt-0.5 text-xl font-semibold break-words">
            {value || <span className="font-medium text-muted-foreground">Not found</span>}
          </div>
          {note && <div className="mt-1 text-base text-muted-foreground">{note}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <CheckBadge status={status} />
          {onChange && !children && (
            <button
              type="button"
              onClick={onChange}
              className="min-h-12 cursor-pointer rounded-xl px-4 text-lg font-semibold text-primary hover:bg-accent"
            >
              Change
            </button>
          )}
        </div>
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
