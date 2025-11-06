// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  QueryClient,
  QueryClientProvider,
  isServer,
} from '@tanstack/react-query'
import { CodeLangProvider } from './code-lang'
import { ThemeProvider } from '@/components/theme-provider'
import { SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined = undefined

function getQueryClient() {
  if (isServer) {
    return makeQueryClient()
  } else {
    if (!browserQueryClient) browserQueryClient = makeQueryClient()
    return browserQueryClient
  }
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient()

  return (
    <>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem
        disableTransitionOnChange
      >
        <QueryClientProvider client={queryClient}>
          <SidebarProvider>
            <CodeLangProvider>{children}</CodeLangProvider>
          </SidebarProvider>
          <ReactQueryDevtools />
        </QueryClientProvider>
      </ThemeProvider>
      <Toaster />
    </>
  )
}
