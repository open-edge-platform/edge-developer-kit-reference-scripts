// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'
import { createContext, useContext, useState } from 'react'
import type { CodeSnippet } from '@/services/types'

/**
 * The snippet last picked in any code block. Matched by label (`language`) too, since two snippets
 * can share a `languageCode` (Python and the OpenAI SDK for Python).
 */
type CodeLang = Pick<CodeSnippet, 'language' | 'languageCode'>

const DEFAULT_LANG: CodeLang = { language: 'Python', languageCode: 'python' }

const CodeLangContext = createContext<{
  language: CodeLang
  setLanguage: (lang: CodeLang) => void
}>({ language: DEFAULT_LANG, setLanguage: () => {} })

export const CodeLangProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [language, setLanguage] = useState<CodeLang>(DEFAULT_LANG)
  return (
    <CodeLangContext.Provider value={{ language, setLanguage }}>
      {children}
    </CodeLangContext.Provider>
  )
}

export const useCodeLang = () => useContext(CodeLangContext)
