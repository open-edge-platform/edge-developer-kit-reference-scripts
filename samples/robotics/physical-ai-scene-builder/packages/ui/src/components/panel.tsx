// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/utils';

export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('flex min-h-0 flex-col bg-surface', className)} {...props} />;
}

export interface PanelHeaderProps extends ComponentProps<'header'> {
  title: string;
  actions?: ReactNode;
}

export function PanelHeader({ title, actions, className, ...props }: PanelHeaderProps) {
  return (
    <header
      className={cn(
        'flex h-9 shrink-0 items-center justify-between border-b border-border px-3',
        className,
      )}
      {...props}
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
        {title}
      </span>
      {actions}
    </header>
  );
}

export function PanelBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto', className)} {...props} />;
}
