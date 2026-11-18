// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { cn } from '@mujoco-studio/ui';

interface ToggleSwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
  title?: string;
}

export function ToggleSwitch({ checked, disabled, label, onToggle, title }: ToggleSwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50',
        checked ? 'border-accent bg-accent' : 'border-border bg-surface',
      )}
      disabled={disabled}
      onClick={onToggle}
      role="switch"
      title={title}
      type="button"
    >
      <span
        className={cn(
          'absolute top-0.5 size-3.5 rounded-full bg-foreground transition-[left]',
          checked ? 'left-[18px] bg-background' : 'left-0.5',
        )}
      />
    </button>
  );
}
