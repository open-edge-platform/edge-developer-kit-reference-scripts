// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ChevronRight, Image as ImageIcon, Layers, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { TONES } from '@/components/common/tones'
import { cn } from '@/lib/utils'
import { GenerationType } from '../lib/api'

interface GenTypeOption {
  value: GenerationType
  icon: LucideIcon
  label: string
  selectedClassName: string
}

const GEN_TYPE_OPTIONS: GenTypeOption[] = [
  {
    value: GenerationType.GOOD_DATASET,
    icon: Zap,
    label: 'Good Sample',
    selectedClassName: TONES.primary.pill,
  },
  {
    value: GenerationType.MISSING_COMPONENTS,
    icon: Layers,
    label: 'Missing Components',
    selectedClassName: TONES.warning.pill,
  },
  {
    value: GenerationType.CUSTOM,
    icon: ImageIcon,
    label: 'Custom Generation (Experimental)',
    selectedClassName: TONES.success.pill,
  },
]

interface GenerationTypeSelectorProps {
  value: GenerationType
  onChange: (type: GenerationType) => void
  /** Id of the visible label naming the group. */
  labelledBy: string
}

/** One of the three generation types, as a group of toggle buttons. */
export function GenerationTypeSelector({
  value,
  onChange,
  labelledBy,
}: GenerationTypeSelectorProps) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="grid grid-cols-1 gap-2"
    >
      {GEN_TYPE_OPTIONS.map((option) => {
        const Icon = option.icon
        const isSelected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all',
              isSelected
                ? option.selectedClassName
                : 'bg-background border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <span className="flex items-center gap-3">
              <Icon className="h-4 w-4" aria-hidden />
              <span className="text-sm font-medium">{option.label}</span>
            </span>
            {isSelected && <ChevronRight className="h-4 w-4" aria-hidden />}
          </button>
        )
      })}
    </div>
  )
}
