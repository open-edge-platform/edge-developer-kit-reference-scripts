// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, ChevronDown, Copy, Download, Undo2 } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { downloadBlob } from '@/lib/browser/download'
import type { OcrResult } from '../hooks'

/** Editable OCR text, so misreads can be corrected before copying or saving. */
export function OcrTextReview({
  result,
  sourceName,
}: {
  result: OcrResult
  /** The image's file name, to name the downloads after. */
  sourceName: string | undefined
}) {
  const id = useId()
  const [base, setBase] = useState(result)
  const [text, setText] = useState(result.full_text)
  // A new result replaces the text and whatever was corrected in it.
  if (base !== result) {
    setBase(result)
    setText(result.full_text)
  }
  const { copied, copy } = useCopyToClipboard()
  const edited = text !== result.full_text
  const fileBase = (sourceName ?? '').replace(/\.[^./\\]+$/, '') || 'ocr-text'

  const save = (format: 'txt' | 'json') => {
    const blob =
      format === 'txt'
        ? new Blob([`${text}\n`], { type: 'text/plain;charset=utf-8' })
        : new Blob(
            [
              JSON.stringify(
                {
                  model: result.model,
                  text,
                  edited,
                  original_text: result.full_text,
                  regions: result.regions,
                },
                null,
                2,
              ) + '\n',
            ],
            { type: 'application/json' },
          )
    downloadBlob(blob, `${fileBase}.${format}`)
  }

  return (
    <div className="space-y-2" data-testid="ocr-text-review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id} className="text-sm font-medium">
          Extracted text
        </Label>
        {edited && (
          <span
            className="text-muted-foreground text-xs"
            data-testid="ocr-text-edited"
          >
            Edited
          </span>
        )}
      </div>
      <p id={`${id}-hint`} className="text-muted-foreground text-xs">
        Review the text and correct anything the model misread, then copy or
        download it.
      </p>
      <Textarea
        id={id}
        aria-describedby={`${id}-hint`}
        data-testid="ocr-extracted-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        className="bg-muted/20 max-h-[320px] min-h-40 resize-y text-sm leading-relaxed"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void copy(text)}
          disabled={!text}
          data-testid="ocr-copy"
        >
          {copied ? (
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <Copy aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {copied ? 'Copied' : 'Copy text'}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={!text}
              data-testid="ocr-download"
            >
              <Download aria-hidden="true" className="h-3.5 w-3.5" />
              Download
              <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => save('txt')}>
              Text (.txt)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => save('json')}>
              Text and regions (.json)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {edited && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setText(result.full_text)}
            data-testid="ocr-revert"
          >
            <Undo2 aria-hidden="true" className="h-3.5 w-3.5" />
            Undo corrections
          </Button>
        )}
      </div>
      {edited && (
        <p className="text-muted-foreground text-xs">
          Running OCR again replaces this text and your corrections.
        </p>
      )}
    </div>
  )
}
