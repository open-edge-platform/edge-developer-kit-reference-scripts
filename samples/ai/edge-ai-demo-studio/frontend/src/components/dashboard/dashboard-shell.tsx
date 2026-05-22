// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Menu } from 'lucide-react'
import { useState } from 'react'
import { SidebarNav } from '@/components/sidebar/sidebar-nav'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'

export default function DashboardShell({
  children,
}: {
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="bg-background flex min-h-dvh flex-col lg:flex-row">
      <div className="hidden lg:flex">
        <SidebarNav />
      </div>

      <header className="border-sidebar-border bg-sidebar sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-4 lg:hidden">
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
            className="w-[280px] p-0"
            showCloseButton={false}
          >
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <div className="bg-sidebar-primary shadow-sidebar-primary/20 flex h-7 w-7 items-center justify-center rounded-md shadow-sm">
            <span className="text-sidebar-primary-foreground text-xs font-bold">
              AI
            </span>
          </div>
          <span className="text-sidebar-foreground text-sm font-semibold">
            Edge AI Demo Studio
          </span>
        </div>
      </header>

      <main className="min-w-0 flex-1">
        <div className="page-enter mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
