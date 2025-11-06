// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ReactNode } from 'react'

interface SampleLayoutProps {
  children: ReactNode
}

export default function SampleLayout({ children }: SampleLayoutProps) {
  return (
    <div className="flex h-screen w-screen flex-col bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      {children}
    </div>
  )
}
