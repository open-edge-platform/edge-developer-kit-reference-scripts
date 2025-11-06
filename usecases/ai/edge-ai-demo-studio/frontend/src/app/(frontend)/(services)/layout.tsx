// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type React from 'react'
import type { Metadata } from 'next'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { AppSidebar } from '@/components/sidebar'

export const metadata: Metadata = {
  title: 'Edge AI Demo Studio - AI at the Edge, Everywhere',
  description:
    'Deploy powerful AI models directly in browsers and edge devices. Text generation, speech processing, and image generation with edge-first design.',
}

export default function ServicesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      <AppSidebar />

      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex items-center gap-2">
            <span className="font-semibold">Edge AI Demo Studio</span>
          </div>
        </header>
        <main className="flex flex-1 justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
          <div className="flex w-full max-w-[1200px]">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
