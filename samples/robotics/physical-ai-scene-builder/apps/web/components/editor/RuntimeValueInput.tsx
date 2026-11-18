// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { useState } from 'react';

interface RuntimeValueInputProps {
  'aria-label': string;
  value: number;
  /** Shown decimal places; the spinner steps by the same smallest unit. */
  decimals: number;
  disabled?: boolean;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}

/** Number field that keeps the typed text until Enter or blur, so live values don't overwrite it. */
export function RuntimeValueInput({
  value,
  decimals,
  min,
  max,
  onCommit,
  ...props
}: RuntimeValueInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // Rounded so the spinner's step grid (anchored at min) lands on displayed values.
  const round = (bound?: number) =>
    bound === undefined ? undefined : Number(bound.toFixed(decimals));

  const commit = (text: string | null) => {
    setDraft(null);
    if (text === null || !text.trim()) return;
    const next = Number(text);
    if (Number.isFinite(next)) onCommit(next);
  };

  return (
    <input
      {...props}
      type="number"
      min={round(min)}
      max={round(max)}
      step={10 ** -decimals}
      value={draft ?? value.toFixed(decimals)}
      onChange={(event) => {
        // Spinner buttons and arrow keys fire a plain Event; typing fires an InputEvent.
        if (event.nativeEvent instanceof InputEvent) setDraft(event.target.value);
        else commit(event.target.value);
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit(draft);
        if (event.key === 'Escape') setDraft(null);
      }}
      className="h-7 w-20 shrink-0 border border-border bg-surface-raised px-1.5 text-right font-mono text-[10px] text-foreground outline-none focus:border-accent"
    />
  );
}
