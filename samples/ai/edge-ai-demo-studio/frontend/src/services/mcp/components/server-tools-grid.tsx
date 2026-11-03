// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Wrench } from 'lucide-react'
import { SectionHeading } from '@/components/configure/config-section'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getFirstSentence } from '@/lib/text'
import type { McpTool } from '../hooks'

/** A server's tools: name and first sentence each, the full text on hover or focus. */
export function ServerToolsGrid({
  id,
  tools,
}: {
  /** Id of the grid, for the row's expand button (`aria-controls`). */
  id: string
  tools: McpTool[]
}) {
  return (
    <div id={id} className="space-y-2">
      <SectionHeading as="h4" className="font-semibold tracking-wider">
        Available Tools ({tools.length})
      </SectionHeading>
      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => {
          const summary = tool.description
            ? getFirstSentence(tool.description)
            : undefined
          const card = (
            <div className="bg-background hover:border-primary/30 min-w-0 overflow-hidden rounded-md border px-3 py-2 transition-colors">
              <div className="flex items-center gap-2">
                <div className="bg-primary/10 flex h-5 w-5 shrink-0 items-center justify-center rounded">
                  <Wrench aria-hidden="true" className="text-primary h-3 w-3" />
                </div>
                <span className="truncate text-sm font-medium">
                  {tool.name}
                </span>
              </div>
              {summary && (
                <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
                  {summary}
                </p>
              )}
            </div>
          )
          return (
            <li key={tool.name} className="min-w-0">
              {tool.description ? (
                <Tooltip>
                  {/* Focusable, so the full description reaches keyboard users too. */}
                  <TooltipTrigger asChild>
                    <div
                      tabIndex={0}
                      className="focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2"
                    >
                      {card}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-xs">
                    <p className="font-medium">{tool.name}</p>
                    <p className="text-muted-foreground mt-1 whitespace-pre-line">
                      {tool.description}
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                card
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
