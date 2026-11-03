// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertTriangle, CheckCircle2, Download, RefreshCw } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ParamSelect } from '@/types/demo-params'
import { ParamLabel } from './param-label'

// Longer lists (a model's languages) open below the field at a fixed height
// and scroll, instead of filling the screen.
const LONG_LIST = 12

/**
 * A pick-one param as a labelled select: options may show whether their
 * model is downloaded, the list may be refreshed, and a hint warns below.
 */
export function SelectParam({ param }: { param: ParamSelect }) {
  const id = useId()
  return (
    <div className="space-y-2" data-testid={`param-${param.id}`}>
      <div className="flex items-center gap-2">
        <ParamLabel label={param.label} tooltip={param.tooltip} htmlFor={id} />
        {param.onRefresh && (
          <Button
            type="button"
            onClick={param.onRefresh}
            disabled={param.isRefreshing}
            variant="ghost"
            aria-label={`Refresh ${param.label} options`}
            // A 32px target that keeps the label row's height.
            className="hover:bg-muted/50 -my-1.5 ml-auto flex h-8 w-8 items-center justify-center rounded"
          >
            <RefreshCw
              aria-hidden="true"
              className={cn(
                'text-muted-foreground h-3 w-3',
                param.isRefreshing && 'animate-spin',
              )}
            />
          </Button>
        )}
      </div>
      <Select
        value={param.value}
        onValueChange={param.onChange}
        disabled={param.disabled}
      >
        <SelectTrigger id={id} className="w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          {...(param.options.length > LONG_LIST && {
            position: 'popper',
            className: 'max-h-72',
          })}
        >
          {param.options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              <span className="flex items-center gap-1.5">
                {o.downloaded != null &&
                  (o.downloaded ? (
                    <CheckCircle2
                      aria-label="Downloaded"
                      className="text-success h-3 w-3 shrink-0"
                    />
                  ) : (
                    <Download
                      aria-label="Not downloaded"
                      className="text-muted-foreground h-3 w-3 shrink-0"
                    />
                  ))}
                {o.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {param.hint && (
        <p className="text-warning flex items-center gap-1 text-xs">
          <AlertTriangle aria-hidden="true" className="h-3 w-3 shrink-0" />
          {param.hint}
        </p>
      )}
    </div>
  )
}
