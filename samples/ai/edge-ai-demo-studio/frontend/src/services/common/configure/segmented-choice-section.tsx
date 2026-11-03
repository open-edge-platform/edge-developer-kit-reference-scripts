// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { InfoTip } from '@/components/common/info-tip'
import { ConfigSection } from '@/components/configure/config-section'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface SegmentedChoiceOption<V extends string> {
  value: V
  label: string
  /** Explains the option: under the options while selected, or in its button's tooltip. */
  description?: string
}

/**
 * A Configure section choosing one of a few options that shape the rest of the draft, as radio
 * buttons. Choosing only changes the draft; it is saved or discarded with the rest.
 */
export function SegmentedChoiceSection<V extends string>({
  title,
  ariaLabel,
  options,
  value,
  onChange,
  disabled = false,
  hint,
  tooltips = false,
  testId,
  optionTestId,
}: {
  title: string
  ariaLabel: string
  options: readonly SegmentedChoiceOption<V>[]
  value: V
  onChange: (value: V) => void
  disabled?: boolean
  /** What choosing does, under the options. */
  hint?: string
  /** Explain in tooltips instead: descriptions on the buttons, the hint by the title. */
  tooltips?: boolean
  testId?: string
  optionTestId?: (value: V) => string
}) {
  const current = options.find((o) => o.value === value)

  return (
    <ConfigSection
      title={
        tooltips ? (
          <>
            {title}
            <InfoTip
              tooltip={hint}
              ariaLabel={`About ${title}`}
              size="sm"
              className="ml-1 inline-flex align-middle"
              contentClassName="max-w-xs text-xs"
            />
          </>
        ) : (
          title
        )
      }
    >
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        data-testid={testId}
        className="grid grid-cols-2 gap-2"
      >
        {options.map((option) => {
          const isSelected = option.value === value
          const button = (
            <Button
              key={option.value}
              role="radio"
              aria-checked={isSelected}
              data-state={isSelected ? 'active' : 'inactive'}
              data-testid={optionTestId?.(option.value)}
              type="button"
              size="sm"
              variant={isSelected ? 'default' : 'outline'}
              className="h-auto min-h-8 py-1.5 whitespace-normal"
              disabled={disabled}
              onClick={() => {
                if (!isSelected) onChange(option.value)
              }}
            >
              {option.label}
            </Button>
          )
          return tooltips && option.description ? (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              {/* Below, so it never covers the title's info tip. */}
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                {option.description}
              </TooltipContent>
            </Tooltip>
          ) : (
            button
          )
        })}
      </div>
      {!tooltips && current?.description && (
        <p className="text-muted-foreground mt-1 text-xs">
          {current.description}
        </p>
      )}
      {!tooltips && hint && (
        <p className="text-muted-foreground text-xs">{hint}</p>
      )}
    </ConfigSection>
  )
}
