// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment, type JSX, useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { createHighlighter, type Highlighter } from 'shiki'
import type { BundledLanguage } from 'shiki/bundle/web'

let highlighterPromise: Promise<Highlighter> | null = null

async function getHighlighter(lang: BundledLanguage): Promise<Highlighter> {
  if (!highlighterPromise) {
    const pending = createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [lang],
    })
    highlighterPromise = pending
    pending.catch(() => {
      if (highlighterPromise === pending) highlighterPromise = null
    })
  }
  const highlighter = await highlighterPromise
  if (!highlighter.getLoadedLanguages().includes(lang))
    await highlighter.loadLanguage(lang)
  return highlighter
}

export function Code({
  codeSnippet,
  lang,
}: {
  codeSnippet: string
  lang: string
}) {
  const [highlighted, setHighlighted] = useState<{
    source: string
    lang: string
    nodes: JSX.Element
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function highlight() {
      try {
        const highlighter = await getHighlighter(lang as BundledLanguage)
        if (cancelled) return
        const tree = highlighter.codeToHast(codeSnippet, {
          lang: lang as BundledLanguage,
          themes: { light: 'github-light', dark: 'github-dark' },
        })
        const nodes = toJsxRuntime(tree, { Fragment, jsx, jsxs }) as JSX.Element
        if (!cancelled) setHighlighted({ source: codeSnippet, lang, nodes })
      } catch {
        // Plain text remains readable if a language or highlighter fails to load.
      }
    }
    highlight()
    return () => {
      cancelled = true
    }
  }, [codeSnippet, lang])

  // Never display a previous language or instance while new highlighting loads.
  if (
    highlighted !== null &&
    highlighted.source === codeSnippet &&
    highlighted.lang === lang
  ) {
    return highlighted.nodes
  }
  return (
    <pre>
      <code>{codeSnippet}</code>
    </pre>
  )
}
