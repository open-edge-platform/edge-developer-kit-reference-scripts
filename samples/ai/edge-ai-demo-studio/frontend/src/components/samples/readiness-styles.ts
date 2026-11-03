// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Loader,
  type LucideIcon,
  ShieldQuestion,
  WifiOff,
  Wrench,
} from 'lucide-react'
import { type Tone, type ToneClasses, TONES } from '@/components/common/tones'
import type {
  DependencyStatus,
  SampleReadinessState,
} from '@/samples/common/readiness'

/** Readiness tones; always paired with words or an icon, so colour is never the only signal. */
export type ReadinessTone = Extract<
  Tone,
  'success' | 'warning' | 'destructive' | 'muted'
>

export interface ReadinessStyle extends ToneClasses {
  tone: ReadinessTone
  icon: LucideIcon
  spin?: boolean
}

const STATE_STYLE: Record<
  SampleReadinessState,
  { tone: ReadinessTone; icon: LucideIcon; spin?: boolean }
> = {
  ready: { tone: 'success', icon: CheckCircle2 },
  starting: { tone: 'warning', icon: Loader, spin: true },
  'needs-setup': { tone: 'warning', icon: Wrench },
  failed: { tone: 'destructive', icon: AlertTriangle },
  unsupported: { tone: 'muted', icon: Ban },
  checking: { tone: 'muted', icon: Loader, spin: true },
  unavailable: { tone: 'muted', icon: WifiOff },
  // Settled, not in progress: services are up but compatibility is unknown.
  unverified: { tone: 'warning', icon: ShieldQuestion },
}

export function readinessStyle(state: SampleReadinessState): ReadinessStyle {
  const { tone, icon, spin } = STATE_STYLE[state]
  return { tone, icon, spin, ...TONES[tone] }
}

const DEPENDENCY_STYLE: Record<
  DependencyStatus,
  { tone: ReadinessTone; icon: LucideIcon; spin?: boolean }
> = {
  online: { tone: 'success', icon: CheckCircle2 },
  starting: { tone: 'warning', icon: Loader, spin: true },
  error: { tone: 'destructive', icon: AlertTriangle },
  offline: { tone: 'muted', icon: CircleDashed },
  missing: { tone: 'warning', icon: Wrench },
}

export function dependencyStyle(status: DependencyStatus): ReadinessStyle {
  const { tone, icon, spin } = DEPENDENCY_STYLE[status]
  return { tone, icon, spin, ...TONES[tone] }
}
