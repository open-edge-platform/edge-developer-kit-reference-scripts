// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Check, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { BundledLanguage } from 'shiki/bundle/web'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCodeLang } from '@/context/code-lang'
import type { CodeSnippet } from '@/services/types'
import { Code } from './code'

export default function CodeBlock({
  title,
  data,
}: {
  title: string
  data: CodeSnippet[]
}) {
  const { language: selectedLanguage, setLanguage: setSelectedLanguage } =
    useCodeLang()

  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(code)
    setIsCopied(true)
    toast.success('Code copied to clipboard')
    setTimeout(() => {
      setIsCopied(false)
    }, 2000)
  }

  // Fall back to first snippet if the globally selected language isn't in this block
  const selectedCode = useMemo(() => {
    return (
      data.find((snippet) => snippet.languageCode === selectedLanguage) ??
      data[0]
    )
  }, [data, selectedLanguage])

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white">
        <div className="flex items-center justify-between rounded-t-lg border-b bg-slate-100 px-4 py-2">
          <span className="text-sm font-medium text-slate-700">{title}</span>
          <div className="flex items-center gap-2">
            <Select
              value={selectedCode?.languageCode ?? ''}
              onValueChange={(value) => {
                setSelectedLanguage(value as BundledLanguage)
              }}
            >
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.map((snippet) => (
                  <SelectItem
                    key={snippet.languageCode}
                    value={snippet.languageCode}
                  >
                    {snippet.language}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => handleCopy(selectedCode?.code ?? '')}
            >
              {isCopied ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
        <div className="mx-4 overflow-x-auto py-4">
          {selectedCode ? (
            <Code
              codeSnippet={selectedCode.code}
              lang={selectedCode.languageCode}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
