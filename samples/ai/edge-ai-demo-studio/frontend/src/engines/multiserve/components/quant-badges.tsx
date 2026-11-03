// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ShieldCheck } from 'lucide-react'
import { TONES } from '@/components/common/tones'
import { Badge } from '@/components/ui/badge'
import {
  isSelectableQuant,
  joinModelName,
  rowQuants,
} from '@/engines/multiserve/quant-selection'
import type { MultiserveModel } from '@/engines/multiserve/types'
import { cn } from '@/lib/utils'

const BADGE = 'h-4 px-1 py-0 text-[10px]'

/**
 * With `onPick` each nameable quant is a toggle choosing the quant the row runs as; without it,
 * plain labels. Verified quants carry a shield.
 */
export function QuantBadges({
  model,
  activeQuant,
  onPick,
  disabled = false,
}: {
  model: Pick<MultiserveModel, 'repo_id' | 'downloaded' | 'verified'>
  activeQuant?: string
  onPick?: (quant: string) => void
  disabled?: boolean
}) {
  const quants = rowQuants(model)
  if (quants.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1">
      {quants.map((q) => {
        const isQuantVerified = model.verified.includes(q)
        const tone = isQuantVerified ? TONES.info.pill : 'text-muted-foreground'
        const content = (
          <>
            {isQuantVerified && (
              <ShieldCheck aria-hidden="true" className="mr-0.5 h-2.5 w-2.5" />
            )}
            {q}
          </>
        )

        if (!onPick || !isSelectableQuant(q)) {
          return (
            <Badge
              key={q}
              variant="outline"
              className={cn(BADGE, tone)}
              title={isQuantVerified ? `${q} (verified)` : undefined}
            >
              {content}
            </Badge>
          )
        }

        const isActive = q === activeQuant
        return (
          <Badge
            key={q}
            asChild
            variant="outline"
            className={cn(
              BADGE,
              'hover:border-primary/60 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
              tone,
              isActive &&
                'border-primary text-foreground ring-primary/40 ring-1',
            )}
          >
            <button
              type="button"
              data-testid="model-quant-option"
              aria-pressed={isActive}
              aria-label={`Use ${joinModelName(model.repo_id, q)}${isQuantVerified ? ' (verified)' : ''}`}
              disabled={disabled}
              onClick={() => onPick(q)}
            >
              {content}
            </button>
          </Badge>
        )
      })}
    </div>
  )
}
