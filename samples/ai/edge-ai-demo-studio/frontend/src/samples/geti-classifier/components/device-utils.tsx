// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Cpu, Monitor, Zap } from 'lucide-react'

export function DeviceIcon({
  type,
  className,
}: {
  type: string
  className?: string
}) {
  if (type === 'GPU') return <Monitor className={className} />
  if (type === 'NPU') return <Zap className={className} />
  return <Cpu className={className} />
}

export function deviceDescription(type: string): string {
  if (type === 'GPU') return 'Intel integrated / discrete GPU'
  if (type === 'NPU') return 'Neural Processing Unit (Intel Core Ultra)'
  return 'Always available — universal fallback'
}

export function getDeviceColor(type: string): string {
  if (type === 'GPU')
    return 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400'
  if (type === 'NPU')
    return 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400'
  return 'text-sky-600 bg-sky-50 border-sky-200 dark:bg-sky-950/30 dark:border-sky-800 dark:text-sky-400'
}
