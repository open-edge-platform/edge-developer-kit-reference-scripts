// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, Copy, Terminal, WrapText } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCodeLang } from '@/context/code-lang'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'
import type { CodeSnippet } from '@/services/types'
import { Code } from './code'

export default function CodeBlock({
  title,
  data,
}: {
  title: string
  data: CodeSnippet[]
}) {
  const { language, setLanguage } = useCodeLang()
  const { copied, copy } = useCopyToClipboard(2000)
  const [wrap, setWrap] = useState(false)
  // The snippet picked last, in this block or another: the same one by label,
  // else one in the same language. Labels are unique within a block.
  const selectedCode =
    data.find((snippet) => snippet.language === language.language) ??
    data.find((snippet) => snippet.languageCode === language.languageCode) ??
    data[0]

  if (!selectedCode) return null

  return (
    <div
      className="border-border bg-card min-w-0 overflow-hidden rounded-xl border"
      role="group"
      aria-label={title}
    >
      <div className="border-border bg-muted/45 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Terminal
            aria-hidden="true"
            className="text-primary size-4 shrink-0"
          />
          <h3 className="text-foreground text-xs font-semibold">{title}</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {data.length > 1 ? (
            <Select
              value={selectedCode.language}
              onValueChange={(value) => {
                const snippet = data.find((s) => s.language === value)
                if (snippet) setLanguage(snippet)
              }}
            >
              <SelectTrigger
                aria-label={`Language for ${title}`}
                className="bg-card h-8 w-28 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.map((snippet) => (
                  <SelectItem key={snippet.language} value={snippet.language}>
                    {snippet.language}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-muted-foreground mr-2 font-mono text-xs">
              {selectedCode.language}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Wrap lines in ${title}`}
            aria-pressed={wrap}
            className={cn(wrap && 'bg-primary/10 text-primary')}
            onClick={() => setWrap((value) => !value)}
          >
            <WrapText />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Copy ${title}`}
            onClick={() => void copy(selectedCode.code)}
          >
            {copied ? <Check className="text-success" /> : <Copy />}
          </Button>
          <span className="sr-only" role="status">
            {copied ? 'Copied to clipboard' : ''}
          </span>
        </div>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label={`${title} code`}
        className={cn(
          'service-code max-h-[32rem] overflow-auto p-4 text-xs leading-6',
          wrap && 'service-code-wrap',
        )}
      >
        <Code
          codeSnippet={selectedCode.code}
          lang={selectedCode.languageCode}
        />
      </div>
    </div>
  )
}
