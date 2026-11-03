// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'
import type { ServiceStatus } from '@/services/types'

/**
 * The app's one tone vocabulary, built on the semantic tokens in `app/(dashboard)/globals.css`, so
 * a state reads the same on every surface and in both themes.
 */
export type Tone =
  'success' | 'warning' | 'info' | 'destructive' | 'muted' | 'primary'

export interface ToneClasses {
  /** Coloured text or icon on the page background: status words, icons. */
  text: string
  /** Text that stays readable on the tone's tinted surface (`pill`, `surface`). */
  strongText: string
  /** Solid fill of a small status dot. */
  dot: string
  /** Tinted pill or badge: border, background and readable text. */
  pill: string
  /** Tinted circle behind an icon, icon colour included. */
  iconBg: string
  /** The tone's border colour alone. */
  border: string
  /** Tinted panel: border and faint background (notices, callouts). */
  surface: string
}

export const TONES: Record<Tone, ToneClasses> = {
  success: {
    text: 'text-success',
    strongText: 'text-success-strong',
    dot: 'bg-success',
    pill: 'border-success/25 bg-success/10 text-success-strong',
    iconBg: 'bg-success/15 text-success',
    border: 'border-success/30',
    surface: 'border-success/30 bg-success/10',
  },
  warning: {
    text: 'text-warning',
    strongText: 'text-warning-strong',
    dot: 'bg-warning',
    pill: 'border-warning/25 bg-warning/10 text-warning-strong',
    iconBg: 'bg-warning/15 text-warning',
    border: 'border-warning/30',
    surface: 'border-warning/30 bg-warning/10',
  },
  info: {
    text: 'text-info',
    strongText: 'text-info-strong',
    dot: 'bg-info',
    pill: 'border-info/25 bg-info/10 text-info-strong',
    iconBg: 'bg-info/15 text-info',
    border: 'border-info/30',
    surface: 'border-info/30 bg-info/10',
  },
  destructive: {
    text: 'text-destructive',
    strongText: 'text-destructive-strong',
    dot: 'bg-destructive',
    pill: 'border-destructive/25 bg-destructive/10 text-destructive-strong',
    iconBg: 'bg-destructive/15 text-destructive',
    border: 'border-destructive/30',
    surface: 'border-destructive/30 bg-destructive/10',
  },
  muted: {
    text: 'text-muted-foreground',
    strongText: 'text-foreground',
    dot: 'bg-muted-foreground/50',
    pill: 'border-border bg-muted/70 text-muted-foreground',
    iconBg: 'bg-muted text-muted-foreground',
    border: 'border-border',
    surface: 'border-border bg-muted/40',
  },
  primary: {
    text: 'text-primary',
    strongText: 'text-primary',
    dot: 'bg-primary',
    pill: 'border-primary/20 bg-primary/10 text-primary',
    iconBg: 'bg-primary/10 text-primary',
    border: 'border-primary/30',
    surface: 'border-primary/30 bg-primary/5',
  },
}

/** The tone each instance state is drawn in, on every surface. */
export const STATUS_TONE: Record<ServiceStatus, Tone> = {
  online: 'success',
  starting: 'warning',
  error: 'destructive',
  offline: 'muted',
}

/**
 * Colour of a small status dot (pulsing while starting); callers set size and radius. Colour alone,
 * so prefer {@link shapedStatusDotClass} or a `STATE_LABEL` beside it where the dot is the only cue.
 */
export function statusDotClass(status: ServiceStatus): string {
  const tone = TONES[STATUS_TONE[status]]
  return cn(tone.dot, status === 'starting' && 'animate-pulse')
}

/**
 * Status dot whose shape carries the state too, so it survives greyscale and colour blindness.
 * `offlineClass` sets the hollow ring's colour for the surface it sits on.
 */
export function shapedStatusDotClass(
  status: ServiceStatus,
  offlineClass = 'border-muted-foreground/70',
): string {
  switch (status) {
    case 'online':
      return 'bg-success rounded-full'
    case 'error':
      // A rounded square — the one state that must never be mistaken for
      // another at a glance.
      return 'bg-destructive rounded-[2px]'
    case 'starting':
      return 'bg-warning ring-warning/40 rounded-full ring-2'
    default:
      return cn('rounded-full border bg-transparent', offlineClass)
  }
}
