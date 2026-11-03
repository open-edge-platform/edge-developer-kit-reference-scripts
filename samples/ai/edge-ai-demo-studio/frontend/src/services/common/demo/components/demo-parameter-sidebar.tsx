// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronRight, RotateCcw, Settings2 } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ParamRenderer } from '@/components/common/param-renderer'
import { cn } from '@/lib/utils'
import type { DemoParam } from '@/types/demo-params'
import { useParameterPlacement } from './parameter-placement'

interface DemoParameterSidebarProps {
  params?: DemoParam[]
  children?: ReactNode
  /** Renders a "Reset parameters" action below the parameters. */
  onReset?: () => void
  /** Disables the reset action, e.g. while nothing is customized. */
  resetDisabled?: boolean
  /** Controls at the end of the title row, e.g. a close button. */
  headerActions?: ReactNode
  /** `plain` drops the card frame and title; the default in `DemoLayout`'s sheet, else `card`. */
  variant?: 'card' | 'plain'
  className?: string
}

export function DemoParameterSidebar({
  params = [],
  children,
  onReset,
  resetDisabled,
  headerActions,
  variant: variantProp,
  className,
}: DemoParameterSidebarProps) {
  const placement = useParameterPlacement()
  const variant = variantProp ?? (placement === 'sheet' ? 'plain' : 'card')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const advancedId = useId()

  if (params.length === 0 && !children) return null

  const basic = params.filter((param) => !param.advanced)
  const advanced = params.filter((param) => param.advanced)

  return (
    <div
      className={cn(
        'space-y-5',
        variant === 'card' && 'border-border bg-muted/10 rounded-xl border p-4',
        className,
      )}
    >
      {variant === 'card' && (
        <>
          <div className="text-foreground flex items-center gap-2 text-sm font-medium">
            <div className="bg-primary/10 flex h-6 w-6 items-center justify-center rounded-md">
              <Settings2 className="text-primary h-3.5 w-3.5" />
            </div>
            Parameters
            {headerActions && (
              <div className="ml-auto flex items-center gap-1">
                {headerActions}
              </div>
            )}
          </div>

          <Separator />
        </>
      )}

      {basic.map((param) => (
        <ParamRenderer key={param.id} param={param} />
      ))}

      {advanced.length > 0 && (
        <div className="space-y-4">
          <button
            type="button"
            aria-expanded={showAdvanced}
            aria-controls={advancedId}
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-foreground hover:bg-muted/50 -mx-2 flex min-h-9 w-[calc(100%+1rem)] items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium transition-colors"
          >
            <ChevronRight
              aria-hidden
              className={cn(
                'text-muted-foreground h-3.5 w-3.5 transition-transform duration-150',
                showAdvanced && 'rotate-90',
              )}
            />
            Advanced
          </button>
          {showAdvanced && (
            <div id={advancedId} className="space-y-5">
              {advanced.map((param) => (
                <ParamRenderer key={param.id} param={param} />
              ))}
            </div>
          )}
        </div>
      )}

      {children}

      {onReset && (
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5 text-xs"
          onClick={onReset}
          disabled={resetDisabled}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset parameters
        </Button>
      )}
    </div>
  )
}
