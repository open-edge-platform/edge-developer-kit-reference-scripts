// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { UIMessage } from 'ai'
import { Check, Copy, Loader, Edit } from 'lucide-react'
import { useState } from 'react'
import { Streamdown } from 'streamdown'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { ReasoningBlock } from '@/services/text-generation/components/reasoning-block'
import { extractTextContent } from '@/services/text-generation/lib/chat-helpers'
import { stripMarkdownFence } from '../lib/soap'
import { formatTimestamp } from '../lib/timestamps'

interface SoapReportPanelProps {
  message: UIMessage | undefined
  isGenerating: boolean
  savedReport?: string | null
  onUpdateReport: (report: string) => void
  reportCreatedAt: string
  /** Why the last report for this session failed, if it did. */
  error?: string | null
}

export function SoapReportPanel({
  message,
  isGenerating,
  savedReport,
  onUpdateReport,
  reportCreatedAt,
  error,
}: SoapReportPanelProps) {
  const { copied, copy } = useCopyToClipboard()
  const [editing, setEditing] = useState(false)
  const [editedReport, setEditedReport] = useState<string | null>(null)

  const liveTextContent = message ? extractTextContent(message) : undefined

  // The live stream while generating, then savedReport, so edits show even if a stale chat
  // message lingers.
  const copyText = stripMarkdownFence(
    (isGenerating ? liveTextContent : savedReport) ||
      savedReport ||
      liveTextContent ||
      '',
  )

  const handleCopy = () => {
    if (copyText) copy(copyText)
  }

  const handleEdit = () => {
    setEditing(true)
    setEditedReport(copyText)
  }

  const handleCancelEdit = () => {
    setEditing(false)
    setEditedReport(null)
  }

  const hasContent = message && message.parts.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-semibold">Clinical report</h3>
        <span className="flex items-center gap-2">
          {copyText && !isGenerating && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={handleEdit}
              disabled={editing}
              aria-label="Edit report"
              title="Edit report"
            >
              <Edit className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
          {copyText && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={handleCopy}
              disabled={editing}
              aria-label={copied ? 'Report copied' : 'Copy report'}
              title="Copy report"
            >
              {copied ? (
                <Check className="text-success h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          )}
        </span>
      </div>

      {editing ? (
        <Textarea
          aria-label="Clinical report"
          className="min-h-0 flex-1 resize-none rounded-none border-0 p-4 shadow-none focus-visible:ring-0"
          value={editedReport ?? copyText}
          onChange={(e) => setEditedReport(e.target.value)}
        />
      ) : (
        // A native scroller, so a wide table in the note scrolls sideways
        // within the pane rather than being cut off.
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error && !isGenerating && (
            <InlineNotice tone="destructive" size="sm" className="mb-4">
              Report failed: {error}
            </InlineNotice>
          )}
          {isGenerating && !hasContent && (
            <div className="flex flex-col items-center gap-2 py-8">
              <Loader
                className="text-muted-foreground h-6 w-6 animate-spin"
                aria-hidden
              />
              <p className="text-muted-foreground text-sm">
                Generating clinical report…
              </p>
            </div>
          )}
          {hasContent && (isGenerating || !savedReport) && !editing && (
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
                        {stripMarkdownFence(part.text)}
                      </Streamdown>
                    </div>
                  )
                }
                return null
              })}
            </div>
          )}

          {!isGenerating && savedReport && (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <Streamdown key={reportCreatedAt} animated={false}>
                {stripMarkdownFence(savedReport)}
              </Streamdown>
            </div>
          )}

          {!isGenerating && !hasContent && !savedReport && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Once a recording is transcribed, choose Generate report to write a
              SOAP note
            </p>
          )}
        </div>
      )}

      {reportCreatedAt && !editing && (
        <div className="text-muted-foreground border-t p-4 text-xs">
          Updated {formatTimestamp(reportCreatedAt)}
        </div>
      )}
      {editing && (
        <div className="flex items-center gap-2 border-t p-3">
          <Button
            size="sm"
            onClick={() => {
              onUpdateReport(editedReport ?? copyText)
              setEditing(false)
              setEditedReport(null)
            }}
          >
            <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
            Save report
          </Button>
          <Button size="sm" variant="outline" onClick={handleCancelEdit}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
