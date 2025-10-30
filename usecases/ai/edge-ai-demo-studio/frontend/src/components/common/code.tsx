// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'
import { JSX, useEffect, useState } from 'react'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

import { createHighlighter } from 'shiki'

export function JSCode({ codeSnippet }: { codeSnippet: string }) {
  const [nodes, setNodes] = useState<JSX.Element | null>(null)
  useEffect(() => {
    async function doHighlight() {
      const highlighter = await createHighlighter({
        themes: ['github-light'],
        langs: ['javascript'],
      })
      const html = highlighter.codeToHast(codeSnippet, {
        lang: 'js',
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
  }, [codeSnippet])

  return nodes ?? <p>Loading...</p>
}

export function PYCode({ codeSnippet }: { codeSnippet: string }) {
  const [nodes, setNodes] = useState<JSX.Element | null>(null)
  useEffect(() => {
    async function doHighlight() {
      const highlighter = await createHighlighter({
        themes: ['github-light'],
        langs: ['python'],
      })
      const html = highlighter.codeToHast(codeSnippet, {
        lang: 'py',
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
  }, [codeSnippet])

  return nodes ?? <p>Loading...</p>
}
