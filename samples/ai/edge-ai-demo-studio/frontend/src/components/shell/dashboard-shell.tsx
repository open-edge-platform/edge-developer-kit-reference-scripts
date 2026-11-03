// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Menu } from 'lucide-react'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { LeaveGuardHost } from '@/components/common/leave-guard'
import { CommandPalette } from '@/components/sidebar/command-palette'
import { SidebarNav } from '@/components/sidebar/sidebar-nav'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { WorkspaceHeader } from './workspace-header'
import { ConnectionNotice } from './connection-notice'

/** The app frame: sidebar (a sheet on small screens), header and main region. */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  // Close the phone menu on navigation, including when the leave guard held
  // the click (so `onNavigate` never ran) and the user then left.
  const pathname = usePathname()
  const [shownPath, setShownPath] = useState(pathname)
  if (shownPath !== pathname) {
    setShownPath(pathname)
    setMobileOpen(false)
  }

  return (
    <div className="bg-background flex min-h-dvh flex-col lg:flex-row">
      <a
        href="#main-content"
        className="bg-primary text-primary-foreground fixed top-3 left-3 z-[100] -translate-y-24 rounded-lg px-4 py-3 text-sm font-medium focus:translate-y-0"
      >
        Skip to content
      </a>
      <div className="hidden lg:flex">
        <SidebarNav />
      </div>

      <header className="border-sidebar-border bg-sidebar sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-4 lg:hidden [@media(max-height:560px)]:static">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground hover:bg-sidebar-accent/50 size-10"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="bg-sidebar border-sidebar-border w-[300px] max-w-[85vw] gap-0 p-0"
            showCloseButton={false}
          >
            <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
            <SheetDescription className="sr-only">
              Navigate services, samples, system monitoring, and settings.
            </SheetDescription>
            <SidebarNav
              variant="mobile"
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <Image
            src={'/logo-classicblue-white.svg'}
            alt="Intel"
            width={60}
            height={25}
            loading="eager"
            className="object-contain"
          />
          <span className="text-sidebar-foreground text-sm font-semibold">
            Edge AI Demo Studio
          </span>
        </div>
      </header>

      {/* Mounted once, outside both sidebars: two palettes would bind ⌘K twice. */}
      <CommandPalette />
      <LeaveGuardHost />

      <div className="min-w-0 flex-1">
        <WorkspaceHeader />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] scroll-mt-24 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
        >
          <ConnectionNotice />
          {children}
        </main>
      </div>
    </div>
  )
}
