// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment, type JSX, useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { createHighlighter } from 'shiki'
import type { BundledLanguage } from 'shiki/bundle/web'

export function Code({
  codeSnippet,
  lang,
}: {
  codeSnippet: string
  lang: string
}) {
  const [nodes, setNodes] = useState<JSX.Element | null>(null)
  useEffect(() => {
    async function doHighlight() {
      const highlighter = await createHighlighter({
        themes: ['github-light'],
        langs: [lang as BundledLanguage],
      })
      const html = highlighter.codeToHast(codeSnippet, {
        lang: lang as BundledLanguage,
        theme: 'github-light',
      })
      const jsxElement = toJsxRuntime(html, {
        Fragment,
        jsx,
        jsxs,
      }) as JSX.Element
      setNodes(jsxElement)
    }
    if (codeSnippet) doHighlight()
  }, [codeSnippet, lang])

  return nodes ?? <p>Loading...</p>
}
