// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'
import type { LogLevel } from '@/types/common'
import { formatLogMessage, parseAccessLog } from '../log-message'

export function LogMessage({
  message,
  level,
  wrap,
}: {
  message: string
  level: LogLevel
  wrap: boolean
}) {
  return (
    <div className="min-w-0">
      {formatLogMessage(message, level)
        .split('\n')
        .map((line, index) => {
          const access = parseAccessLog(line)
          if (!access)
            return (
              <div key={index} className="min-h-5">
                {line}
              </div>
            )
          return (
            <details key={index}>
              <summary
                className={cn(
                  'focus-visible:ring-ring cursor-pointer rounded outline-none focus-visible:ring-2',
                  wrap ? 'whitespace-normal' : 'whitespace-nowrap',
                )}
              >
                <span className="text-primary ml-1 font-semibold">
                  {access.method}
                </span>{' '}
                <span>{access.path}</span>{' '}
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs font-semibold',
                    access.status >= 400
                      ? 'bg-destructive/10 text-destructive'
                      : access.status >= 300
                        ? 'bg-warning/10 text-warning'
                        : 'bg-success/10 text-success',
                  )}
                >
                  {access.status} {access.statusText}
                </span>
                <span className="text-muted-foreground ml-2 text-xs">
                  Details
                </span>
              </summary>
              <div className="border-border text-muted-foreground mt-2 mb-1 space-y-2 border-l-2 pl-3 [overflow-wrap:anywhere] whitespace-pre-wrap">
                <p>
                  Client {access.client} · {access.protocol}
                </p>
                {access.query.length > 0 && (
                  <dl className="space-y-1" aria-label="Query parameters">
                    {access.query.map(([key, value], i) => (
                      <div key={i} className="flex flex-wrap gap-x-2">
                        <dt>{key}</dt>
                        <dd className="text-foreground">
                          {value || '(empty)'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <details>
                  <summary className="cursor-pointer">Original line</summary>
                  <pre className="mt-1 font-mono [overflow-wrap:anywhere] whitespace-pre-wrap">
                    {message.split('\n')[index]}
                  </pre>
                </details>
              </div>
            </details>
          )
        })}
    </div>
  )
}
