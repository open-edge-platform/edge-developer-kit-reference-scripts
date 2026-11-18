// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

import { PhysicsProvider } from '@mujoco-studio/mujoco';
import { Providers } from '@/components/providers';
import { TeleoperationRuntimeProvider } from '@/components/teleoperation/TeleoperationRuntimeProvider';

import '../globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Physical AI Scene Builder',
  description:
    'Open-source, hardware-independent scene authoring for MuJoCo, running entirely in the browser.',
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="h-full overflow-hidden">
        <Providers>
          <PhysicsProvider>
            <TeleoperationRuntimeProvider>{children}</TeleoperationRuntimeProvider>
          </PhysicsProvider>
        </Providers>
      </body>
    </html>
  );
}
