// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type React from 'react'
import type { Metadata } from 'next'
import './globals.css'
import { SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { AppSidebar } from '@/components/sidebar'
import { Geist, Geist_Mono } from 'next/font/google'
import Providers from '@/context/providers'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Edge AI Demo Studio - AI at the Edge, Everywhere',
  description:
    'Deploy powerful AI models directly in browsers and edge devices. Text generation, speech processing, and image generation with edge-first design.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
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
        </Providers>
      </body>
    </html>
  )
}
