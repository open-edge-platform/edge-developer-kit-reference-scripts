// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type DynamicToolUIPart, getToolName, type ToolUIPart } from 'ai'
import { Check, ChevronRight, Loader, Wrench, XCircle } from 'lucide-react'
import { useState } from 'react'
import { TONES, type Tone } from '@/components/common/tones'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

/** A tool call in a message: the AI SDK's static or dynamic tool part. */
export type ToolPart = ToolUIPart | DynamicToolUIPart

type ToolCallPhase = 'running' | 'done' | 'failed' | 'other'

function toolCallPhase(state: ToolPart['state']): ToolCallPhase {
  switch (state) {
    case 'input-streaming':
    case 'input-available':
      return 'running'
    case 'output-available':
      return 'done'
    case 'output-error':
      return 'failed'
    default:
      return 'other'
  }
}

const PHASE_TONE: Record<ToolCallPhase, Tone> = {
  running: 'info',
  done: 'success',
  failed: 'destructive',
  other: 'muted',
}

const PHASE_ICON = {
  running: Loader,
  done: Check,
  failed: XCircle,
  other: Wrench,
}

/** `get_weather` → `Get Weather`. */
function formatToolName(name: string): string {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatPayload(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function PayloadSection({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground mb-1 text-[10px] font-medium uppercase">
        {label}
      </p>
      <pre className="bg-muted/40 max-h-64 overflow-auto rounded-md p-2 text-[11px] break-words whitespace-pre-wrap">
        {formatPayload(value)}
      </pre>
    </div>
  )
}

/** One tool call as a disclosure: name and state, then its input and output. */
export function ToolCallBlock({ part }: { part: ToolPart }) {
  const [expanded, setExpanded] = useState(false)
  const phase = toolCallPhase(part.state)
  const tone = TONES[PHASE_TONE[phase]]
  const Icon = PHASE_ICON[phase]

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className={cn(
        'border-border/50 bg-muted/20 max-w-full overflow-hidden rounded-xl border-l-2',
        phase === 'other' ? 'border-l-muted-foreground/30' : tone.border,
      )}
    >
      <CollapsibleTrigger className="hover:bg-muted/30 flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs transition-colors">
        <div
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full',
            tone.iconBg,
          )}
        >
          <Icon
            aria-hidden
            className={cn('h-3 w-3', phase === 'running' && 'animate-spin')}
          />
        </div>
        <span className="text-foreground min-w-0 truncate font-medium">
          {formatToolName(getToolName(part))}
        </span>
        {phase === 'running' && (
          <Badge tone="info" className="text-[10px]">
            running
          </Badge>
        )}
        {phase === 'done' && (
          <Badge tone="success" className="text-[10px]">
            completed
          </Badge>
        )}
        {phase === 'failed' && (
          <Badge
            tone="destructive"
            className="max-w-[10rem] truncate text-[10px]"
          >
            {part.errorText ?? 'failed'}
          </Badge>
        )}
        <ChevronRight
          aria-hidden
          className={cn(
            'text-muted-foreground/60 ml-auto h-3 w-3 shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-border/50 min-w-0 space-y-2 border-t px-3 pt-2 pb-3">
        {part.input != null && (
          <PayloadSection label="Input" value={part.input} />
        )}
        {part.state === 'output-available' && part.output != null && (
          <PayloadSection label="Output" value={part.output} />
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
