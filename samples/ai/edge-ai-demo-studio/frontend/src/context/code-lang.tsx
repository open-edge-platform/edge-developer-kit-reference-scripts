// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'
import { createContext, useContext, useMemo, useState } from 'react'
import type { BundledLanguage } from 'shiki/bundle/web'

const CodeLangContext = createContext<{
  language: BundledLanguage
  setLanguage: (lang: BundledLanguage) => void
}>({ language: 'python', setLanguage: () => {} })

export const CodeLangProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [language, setLanguage] = useState<BundledLanguage>('python')
  const value = useMemo(() => ({ language, setLanguage }), [language])
  return (
    <CodeLangContext.Provider value={value}>
      {children}
    </CodeLangContext.Provider>
  )
}

export const useCodeLang = () => useContext(CodeLangContext)
