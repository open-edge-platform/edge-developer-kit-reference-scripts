// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import DashboardShell from '@/components/dashboard/dashboard-shell'
import { Toaster } from '@/components/ui/sonner'
import Providers from '@/context/providers'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Edge AI Demo Studio',
  icons: {
    icon: '/logo.svg',
  },
  description:
    'Explore and manage Intel AI microservices and interactive samples powered by OpenVINO and Intel hardware.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          <DashboardShell>{children}</DashboardShell>
          <Toaster richColors closeButton />
        </Providers>
      </body>
    </html>
  )
}
