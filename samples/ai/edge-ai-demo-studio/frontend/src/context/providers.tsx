// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { Theme } from '@/lib/settings/app-settings'
import { CodeLangProvider } from './code-lang'
import { QueryProvider } from './query-provider'
import { ServiceStatusProvider } from './service-status-context'
import { SystemInfoProvider } from './system-info-context'
import { ThemeProvider } from './theme-provider'

/** Every app-wide provider; `initialTheme` is the saved theme the server read. */
export function Providers({
  initialTheme,
  children,
}: {
  initialTheme: Theme
  children: ReactNode
}) {
  return (
    <QueryProvider>
      <ThemeProvider initialTheme={initialTheme}>
        <SystemInfoProvider>
          <ServiceStatusProvider>
            <TooltipProvider>
              <CodeLangProvider>{children}</CodeLangProvider>
            </TooltipProvider>
          </ServiceStatusProvider>
        </SystemInfoProvider>
      </ThemeProvider>
    </QueryProvider>
  )
}
