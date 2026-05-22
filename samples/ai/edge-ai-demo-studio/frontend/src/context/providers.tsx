'use client'

import { TooltipProvider } from '@/components/ui/tooltip'
import { QueryProvider } from './query-provider'
import { ServiceStatusProvider } from './service-status-context'
import { SettingsProvider } from './settings-context'
import { SystemInfoProvider } from './system-info-context'
import { ThemeProvider } from './theme-provider'
import { CodeLangProvider } from './code-lang'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <SettingsProvider>
        <SystemInfoProvider>
          <ServiceStatusProvider>
            <ThemeProvider>
              <TooltipProvider>
                <CodeLangProvider>{children}</CodeLangProvider>
              </TooltipProvider>
            </ThemeProvider>
          </ServiceStatusProvider>
        </SystemInfoProvider>
      </SettingsProvider>
    </QueryProvider>
  )
}
