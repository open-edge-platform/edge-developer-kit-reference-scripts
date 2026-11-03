// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Brain, ChevronRight, Loader } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

/** The model's reasoning, collapsed even while streaming so it doesn't push the answer around. */
export function ReasoningBlock({
  text,
  isStreaming,
}: {
  text: string
  isStreaming: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Opened while streaming: follow the newest reasoning.
  useEffect(() => {
    if (expanded && isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [text, isStreaming, expanded])

  if (!text.trim()) return null

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      data-testid="reasoning-block"
      className="border-border/50 bg-primary/5 border-l-primary/60 max-w-full overflow-hidden rounded-xl border-l-2"
    >
      <CollapsibleTrigger className="hover:bg-primary/10 flex w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs transition-colors">
        <div className="bg-primary/15 flex h-5 w-5 items-center justify-center rounded-full">
          <Brain aria-hidden className="text-primary h-3 w-3 shrink-0" />
        </div>
        <span className="text-primary dark:text-primary-dark font-medium">
          {isStreaming ? 'Reasoning…' : 'Reasoning'}
        </span>
        {isStreaming && (
          <Loader
            aria-hidden
            className="text-primary h-3 w-3 motion-safe:animate-spin"
          />
        )}
        <ChevronRight
          aria-hidden
          className={cn(
            'text-muted-foreground/60 ml-auto h-3 w-3 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="text-muted-foreground border-primary/20 border-t px-3 pt-2 pb-3 text-xs leading-relaxed italic">
        <div ref={scrollRef} className="max-h-60 min-w-0 overflow-auto">
          <span
            className="break-words whitespace-pre-wrap"
            data-testid="reasoning-text"
          >
            {text}
          </span>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
