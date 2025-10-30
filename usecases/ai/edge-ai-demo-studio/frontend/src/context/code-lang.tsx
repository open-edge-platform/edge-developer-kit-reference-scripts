// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'
import { createContext, useContext, useState } from 'react'
import { BundledLanguage } from 'shiki/bundle/web'

const CodeLangContext = createContext<{
  language: BundledLanguage
  setLanguage: (lang: BundledLanguage) => void
}>({ language: 'js', setLanguage: () => {} })

export const CodeLangProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [language, setLanguage] = useState<BundledLanguage>('js')
  return (
    <CodeLangContext.Provider value={{ language, setLanguage }}>
      {children}
    </CodeLangContext.Provider>
  )
}

export const useCodeLang = () => useContext(CodeLangContext)
