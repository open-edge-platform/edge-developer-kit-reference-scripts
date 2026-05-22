// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { UIMessage } from 'ai'
import { BrainCircuit, Check, ChevronRight, Copy, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface SoapReportPanelProps {
  message: UIMessage | undefined
  isGenerating: boolean
  savedReport?: string | null
}

function ReasoningBlock({
  text,
  isStreaming,
}: {
  text: string
  isStreaming: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const showContent = isStreaming || expanded
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [text, isStreaming])

  if (!text.trim() && !isStreaming) return null

  return (
    <div className="border-border/50 bg-muted/30 overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => !isStreaming && setExpanded(!expanded)}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
          !isStreaming && 'hover:bg-muted/50 cursor-pointer',
        )}
      >
        <BrainCircuit className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        <span className="text-muted-foreground font-medium">
          {isStreaming ? 'Thinking…' : 'Reasoning'}
        </span>
        {isStreaming ? (
          <Loader2 className="text-muted-foreground ml-auto h-3 w-3 animate-spin" />
        ) : (
          <ChevronRight
            className={cn(
              'text-muted-foreground/60 ml-auto h-3 w-3 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        )}
      </button>
      {showContent && (
        <div
          ref={scrollRef}
          className="max-h-40 overflow-y-auto border-t px-3 py-2"
        >
          <p className="text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap">
            {text}
          </p>
        </div>
      )}
    </div>
  )
}

export function SoapReportPanel({
  message,
  isGenerating,
  savedReport,
}: SoapReportPanelProps) {
  const [copied, setCopied] = useState(false)

  const liveTextContent = message?.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')

  const copyText = liveTextContent || savedReport || ''

  const handleCopy = useCallback(async () => {
    if (!copyText) return
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available
    }
  }, [copyText])

  const hasContent = message && message.parts.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col border-l">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-semibold">Clinical Report</h3>
        {copyText && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1 p-4">
        {isGenerating && !hasContent && (
          <div className="flex flex-col items-center gap-2 py-8">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            <p className="text-muted-foreground text-sm">
              Generating SOAP note…
            </p>
          </div>
        )}
        {!isGenerating && !hasContent && savedReport && (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <Streamdown animated={false}>{savedReport}</Streamdown>
          </div>
        )}
        {!isGenerating && !hasContent && !savedReport && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            Process a recording and click &quot;Generate Report&quot; to create
            a SOAP note
          </p>
        )}
        {hasContent && (
          <div className="space-y-3">
            {message.parts.map((part, i) => {
              if (part.type === 'reasoning') {
                return (
                  <ReasoningBlock
                    key={`r-${i}`}
                    text={part.text}
                    isStreaming={isGenerating && part.state === 'streaming'}
                  />
                )
              }
              if (part.type === 'text' && part.text.trim()) {
                return (
                  <div
                    key={`t-${i}`}
                    className="prose prose-sm dark:prose-invert max-w-none"
                  >
                    <Streamdown animated isAnimating={isGenerating}>
                      {part.text}
                    </Streamdown>
                  </div>
                )
              }
              return null
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
