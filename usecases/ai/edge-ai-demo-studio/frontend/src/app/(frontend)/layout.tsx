// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type React from 'react'
import type { Metadata } from 'next'
import './globals.css'
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
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
