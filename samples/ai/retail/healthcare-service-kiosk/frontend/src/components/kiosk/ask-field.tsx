// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Search, Siren } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { EMERGENCY_NOTICE } from "@/hospital/data";
import { redFlag } from "@/hospital/safety";
import { TextField } from "@/services/shared/fields";
import { CtaButton } from "./cta-button";
import { Notice } from "./notice";

/** Free-text question with its own Ask button; warns as soon as the words describe an emergency. */
export function AskField({
  label,
  placeholder,
  value,
  onChange,
  onAsk,
  pending,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onAsk: () => void;
  pending: boolean;
}) {
  return (
    <>
      <div className="flex items-end gap-3">
        <TextField id="question" label={label} value={value} onChange={onChange} placeholder={placeholder} className="flex-1" />
        <CtaButton className="h-15 min-h-15 px-8 py-0 text-lg" disabled={!value.trim() || pending} onClick={onAsk}>
          {pending ? <Spinner className="size-5" /> : <Search className="size-5" />}
          Ask
        </CtaButton>
      </div>
      {redFlag(value) && (
        <Notice tone="danger" icon={Siren} className="mt-4 text-lg">
          {EMERGENCY_NOTICE}
        </Notice>
      )}
    </>
  );
}
