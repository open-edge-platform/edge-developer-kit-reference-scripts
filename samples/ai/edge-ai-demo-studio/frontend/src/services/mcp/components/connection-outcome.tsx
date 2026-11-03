// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { CheckCircle2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { McpProbeResult } from '../hooks'

/** Tool names shown before "and N more". */
const SHOWN_TOOLS = 6

/** The server's own name and version, when it gave them. */
export function describeServerInfo(result: McpProbeResult): string | null {
  const name = result.serverInfo?.name
  if (!name) return null
  const version = result.serverInfo?.version
  return version ? `${name} ${version}` : name
}

/** Connected with its tools, or why not, in words and an icon, never by colour alone. */
export function ConnectionOutcome({
  result,
  className,
  'data-testid': testId,
}: {
  result: McpProbeResult
  className?: string
  'data-testid'?: string
}) {
  const info = describeServerInfo(result)
  const tools = result.tools
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn('flex items-start gap-2 text-xs', className)}
    >
      {result.online ? (
        <CheckCircle2
          aria-hidden="true"
          className="text-success mt-0.5 h-4 w-4 shrink-0"
        />
      ) : (
        <XCircle
          aria-hidden="true"
          className="text-destructive mt-0.5 h-4 w-4 shrink-0"
        />
      )}
      <div className="min-w-0 space-y-1.5">
        {result.online ? (
          <p className="text-foreground">
            <span className="font-medium">Connected</span>
            {info ? ` to ${info}` : ''}.{' '}
            {tools.length === 0
              ? 'It offers no tools.'
              : `Found ${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}.`}
          </p>
        ) : (
          <p className="text-foreground break-words">
            <span className="font-medium">Could not connect:</span>{' '}
            {result.error ?? 'the server did not answer'}
          </p>
        )}
        {result.online && tools.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Tools found">
            {tools.slice(0, SHOWN_TOOLS).map((tool) => (
              <li key={tool.name} className="max-w-full min-w-0">
                <Badge variant="outline" className="max-w-full text-xs">
                  <span className="truncate">{tool.name}</span>
                </Badge>
              </li>
            ))}
            {tools.length > SHOWN_TOOLS && (
              <li className="text-muted-foreground self-center">
                and {tools.length - SHOWN_TOOLS} more
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
