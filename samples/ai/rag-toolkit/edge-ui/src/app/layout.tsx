// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as React from 'react';
import type { Metadata, Viewport } from 'next';

import '@/styles/global.css';

import { LocalizationProvider } from '@/components/core/localization-provider';
import { ThemeProvider } from '@/components/core/theme-provider/theme-provider';
import Providers from '@/components/providers';

export const viewport = { width: 'device-width', initialScale: 1 } satisfies Viewport;

interface LayoutProps {
  children: React.ReactNode;
}

export const metadata: Metadata = {
  title: "LLM On Edge",
  description: "Running LLM on the Intel® Edge Platform",
};


export default function Layout({ children }: LayoutProps): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <LocalizationProvider>
          <Providers>
            <ThemeProvider>{children}</ThemeProvider>
          </Providers>
        </LocalizationProvider>
      </body>
    </html>
  );
}
