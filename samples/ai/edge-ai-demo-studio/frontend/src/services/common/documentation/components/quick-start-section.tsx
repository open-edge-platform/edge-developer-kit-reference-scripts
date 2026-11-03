// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { hasExecutionMode } from '@/services/execution'
import type { DocsQuickStart, Service } from '@/services/types'
import CodeBlock from './codeblock'
import { DocsText } from './docs-text'

interface Step {
  text: string
  /** Already true of the selected instance: drawn as checked. */
  done?: boolean
}

/**
 * `text` shown as written in Markdown: every ASCII punctuation mark (all of
 * which CommonMark lets a backslash escape) loses its formatting meaning.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[!-/:-@[-`{-~]/g, '\\$&')
}

/** The step that gets the selected instance answering; none for a service running inside the studio. */
function readinessStep(service: Service): Step | null {
  if (hasExecutionMode(service.execution, 'none')) return null
  if (!service.instanceKey) {
    return {
      text: 'Add the service on the **Overview** tab. Its instance then answers at the base URL above, in place of `<instance-id>`.',
    }
  }
  // A free-form label: `*`, `_`, `[` or `<` in it are not formatting.
  const name = escapeMarkdown(service.label ?? service.name)
  switch (service.status) {
    case 'online':
      return {
        text: `**${name}** is running and answers at the base URL above.`,
        done: true,
      }
    case 'starting':
      return {
        text: `**${name}** is starting. Send requests once it shows Running.`,
      }
    case 'error':
      return {
        text: `**${name}** failed to start. Retry it at the top of the page; the **Logs** tab shows why it failed.`,
      }
    default:
      return {
        text: `Start **${name}** with **Start service** at the top of the page, and wait until it shows Running.`,
      }
  }
}

/** The docs' first section: get the instance running, the service's steps, and one working request. */
export function QuickStartSection({
  quickStart,
  service,
}: {
  quickStart: DocsQuickStart
  service: Service
}) {
  const readiness = readinessStep(service)
  const steps: Step[] = [
    ...(readiness ? [readiness] : []),
    ...quickStart.steps.map((text) => ({ text })),
  ]
  return (
    <section
      id="quick-start"
      tabIndex={-1}
      className="docs-section space-y-4"
      aria-labelledby="quick-start-heading"
      data-testid="docs-quick-start"
    >
      <h2 id="quick-start-heading" className="text-lg font-semibold">
        Quick start
      </h2>
      <ol className="space-y-2">
        {steps.map((step, index) => (
          <li
            key={step.text}
            className="flex items-start gap-3"
            data-testid="docs-quick-start-step"
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-1 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                step.done
                  ? 'bg-success/15 text-success'
                  : 'bg-primary/10 text-primary',
              )}
            >
              {step.done ? <Check className="size-3.5" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              {step.done && <span className="sr-only">Done: </span>}
              <DocsText>{step.text}</DocsText>
            </div>
          </li>
        ))}
      </ol>
      <CodeBlock title="First request" data={[quickStart.request]} />
    </section>
  )
}
