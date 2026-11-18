// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { Check, CircleAlert, CircleCheck, Copy, Info, TriangleAlert } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

import { cn } from '../lib/utils';
import { copyText } from '../lib/clipboard';
import { Button } from './button';
import { Dialog } from './dialog';

export type NoticeTone = 'error' | 'warning' | 'info' | 'success';

/** A message that must be seen: a failed action, a partial result, or a confirmation. */
export interface Notice {
  tone: NoticeTone;
  title: string;
  message: string;
  /** Itemised specifics, e.g. the files that were missing. Rendered as a scrollable list. */
  details?: readonly string[];
  /** Heading above `details`. */
  detailsLabel?: string;
  /** What the user can do next. */
  hint?: string;
}

export interface NoticeDialogProps {
  /** The notice to show; `null` keeps the dialog closed. */
  notice: Notice | null;
  onClose: () => void;
  /** Label of the dismiss button. Defaults to "OK". */
  actionLabel?: string;
  /** Extra actions rendered before the dismiss button. */
  actions?: ReactNode;
}

const TONES: Record<NoticeTone, { icon: typeof Info; text: string; border: string }> = {
  error: { icon: CircleAlert, text: 'text-danger', border: 'border-l-danger' },
  warning: { icon: TriangleAlert, text: 'text-warning', border: 'border-l-warning' },
  info: { icon: Info, text: 'text-info', border: 'border-l-info' },
  success: { icon: CircleCheck, text: 'text-success', border: 'border-l-success' },
};

/**
 * Modal notice for errors and warnings that must not be missed. Errors and warnings use
 * `role="alertdialog"`; the dialog's accessible name is the notice title.
 */
export function NoticeDialog({ notice, onClose, actionLabel = 'OK', actions }: NoticeDialogProps) {
  // Tracks which notice was copied so a new notice starts un-copied without an effect.
  const [copiedNotice, setCopiedNotice] = useState<Notice | null>(null);
  if (!notice) return null;
  const copied = copiedNotice === notice;

  const tone = TONES[notice.tone];
  const Icon = tone.icon;
  const details = notice.details ?? [];
  const copyDetails = async () => {
    const text = [notice.title, notice.message, ...details].join('\n');
    try {
      await copyText(text);
      setCopiedNotice(notice);
    } catch (error) {
      console.error('Could not copy notice details.', error);
      setCopiedNotice(null);
    }
  };

  return (
    <Dialog
      open
      title={notice.title}
      onClose={onClose}
      role={notice.tone === 'error' || notice.tone === 'warning' ? 'alertdialog' : 'dialog'}
      icon={<Icon className={cn('size-4', tone.text)} aria-hidden="true" />}
      className="max-w-lg"
    >
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-foreground">{notice.message}</p>
        {details.length > 0 && (
          <div className={cn('border border-border border-l-2 bg-surface-raised', tone.border)}>
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                {notice.detailsLabel ?? 'Details'} ({details.length})
              </span>
              <button
                type="button"
                className="flex items-center gap-1 text-[10px] text-muted outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
                onClick={() => void copyDetails()}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <ul
              aria-label={notice.detailsLabel ?? 'Details'}
              className="max-h-48 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
            >
              {details.map((detail) => (
                <li key={detail} className="break-all">
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        )}
        {notice.hint && <p className="text-xs leading-relaxed text-muted">{notice.hint}</p>}
        <div className="flex justify-end gap-2">
          {actions}
          <Button type="button" variant="primary" onClick={onClose} autoFocus>
            {actionLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const NoticeContext = createContext<((notice: Notice) => void) | null>(null);

/**
 * Hosts one NoticeDialog for a subtree. Notices raised while one is open are queued and shown in
 * order, so a panel never overwrites a message the user has not read yet.
 */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<readonly Notice[]>([]);
  const show = useCallback((notice: Notice) => setQueue((current) => [...current, notice]), []);
  return (
    <NoticeContext.Provider value={show}>
      {children}
      <NoticeDialog
        notice={queue[0] ?? null}
        onClose={() => setQueue((current) => current.slice(1))}
      />
    </NoticeContext.Provider>
  );
}

/** Returns a function that shows a notice in the nearest NoticeProvider. */
export function useNotice(): (notice: Notice) => void {
  const show = useContext(NoticeContext);
  if (!show) throw new Error('useNotice must be used inside a <NoticeProvider>');
  return show;
}
