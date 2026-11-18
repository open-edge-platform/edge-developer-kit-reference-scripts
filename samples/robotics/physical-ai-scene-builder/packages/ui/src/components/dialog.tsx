// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useId, type ReactNode } from 'react';

import { cn } from '../lib/utils';

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Optional leading icon shown beside the title (for example a status icon). */
  icon?: ReactNode;
  /** Use `alertdialog` for messages that interrupt the user and need acknowledgement. */
  role?: 'dialog' | 'alertdialog';
}

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  className,
  icon,
  role = 'dialog',
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'w-full max-w-md border border-border-strong bg-surface shadow-2xl',
          className,
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <div className="mt-px shrink-0">{icon}</div>}
            <div className="min-w-0">
              <h2 id={titleId} className="text-sm font-semibold text-foreground">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-muted">
                  {description}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center text-muted outline-none transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
