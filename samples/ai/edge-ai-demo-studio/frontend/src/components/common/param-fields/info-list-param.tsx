// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Wrench } from 'lucide-react'
import { Fragment, useId } from 'react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getFirstSentence } from '@/lib/text'
import type { ParamInfoList } from '@/types/demo-params'

/**
 * A read-only list (e.g. the tools an MCP server offers). A row with a
 * description can take focus, so its tooltip opens from the keyboard too.
 */
export function InfoListParam({ param }: { param: ParamInfoList }) {
  const labelId = useId()
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label id={labelId} className="text-muted-foreground text-xs">
          {param.label}
        </Label>
        {param.items.length > 0 && (
          <Badge
            variant="secondary"
            className="h-4 px-1.5 text-[10px] font-normal tabular-nums"
          >
            {param.items.length}
          </Badge>
        )}
      </div>
      {param.items.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">
          {param.emptyText ?? 'None available'}
        </p>
      ) : (
        <ul aria-labelledby={labelId} className="space-y-0.5">
          {param.items.map((item) => {
            const summary = item.description
              ? getFirstSentence(item.description)
              : undefined
            const row = (
              <li
                tabIndex={item.description ? 0 : undefined}
                className="hover:bg-muted focus-visible:bg-muted group flex items-center gap-1.5 rounded-md px-2 py-1 outline-none"
              >
                <Wrench
                  aria-hidden="true"
                  className="text-muted-foreground h-3 w-3 shrink-0"
                />
                <span className="text-foreground truncate text-xs leading-none font-medium">
                  {item.name}
                </span>
                {summary && (
                  <span className="text-muted-foreground ml-auto hidden truncate text-xs leading-none group-hover:inline group-focus-visible:inline">
                    {summary}
                  </span>
                )}
              </li>
            )
            if (!item.description)
              return <Fragment key={item.name}>{row}</Fragment>
            return (
              <Tooltip key={item.name}>
                <TooltipTrigger asChild>{row}</TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs text-xs">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-muted-foreground mt-1 whitespace-pre-line">
                    {item.description}
                  </p>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </ul>
      )}
    </div>
  )
}
