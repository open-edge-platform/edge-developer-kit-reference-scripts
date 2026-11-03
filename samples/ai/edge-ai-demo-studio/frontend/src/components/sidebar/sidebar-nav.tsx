// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactElement, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SheetClose } from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { APP_PAGES } from '@/components/shell/app-pages'
import { cn } from '@/lib/utils'
import { SidebarServicesList } from './sidebar-services-list'

export function SidebarNav({
  onNavigate,
  variant = 'desktop',
}: { onNavigate?: () => void; variant?: 'desktop' | 'mobile' } = {}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  // The mobile sidebar lives inside a fixed-width sheet, so collapsing it would
  // only leave a gap next to it.
  const isMobile = variant === 'mobile'

  const toggleCollapsed = () => {
    setCollapsed((prev) => !prev)
  }

  // Collapsed, every control is an icon: its name moves into a tooltip.
  const withTooltip = (label: string, control: ReactElement) =>
    collapsed ? (
      <Tooltip>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    ) : (
      control
    )

  return (
    // Its own provider for a short delay: collapsed, every name is a tooltip
    // and the pointer sweeps across many of them.
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          'studio-sidebar border-sidebar-border bg-sidebar relative flex flex-col transition-[width] duration-300',
          isMobile
            ? 'h-full w-full'
            : cn(
                'sticky top-0 h-screen border-r',
                collapsed ? 'w-[68px]' : 'w-[260px]',
              ),
        )}
      >
        <div className="sidebar-brand-stripe absolute top-0 bottom-0 left-0 w-[3px] opacity-60" />

        {/* Collapsed, the header is the logo alone, at a size that still reads. */}
        <div
          className={cn(
            'border-sidebar-border flex h-16 shrink-0 items-center border-b',
            collapsed ? 'justify-center px-2' : 'gap-3 px-4',
          )}
        >
          <Image
            src={'/logo-classicblue-white.svg'}
            alt="Intel"
            width={72}
            height={30}
            loading="eager"
            className={cn(
              'h-auto shrink-0 object-contain',
              collapsed ? 'w-10' : 'w-[72px]',
            )}
          />
          {!collapsed && (
            <span className="text-sidebar-foreground min-w-0 truncate text-[13px] font-semibold whitespace-nowrap">
              Edge AI Demo Studio
            </span>
          )}
          {/* The phone menu is a sheet: a visible way out besides Escape
              and tapping beside it. */}
          {isMobile && (
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close navigation menu"
                className="text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground ml-auto shrink-0"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </SheetClose>
          )}
        </div>

        {/* Only the services list below scrolls, so these entries stay on screen. */}
        <nav className="shrink-0 space-y-1 px-3 pt-4">
          {!collapsed && (
            <div className="mb-3 px-2">
              <span className="text-sidebar-foreground/60 text-xs font-semibold tracking-wider uppercase">
                Workspace
              </span>
            </div>
          )}
          {APP_PAGES.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href)
            const link = (
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'gradient-border relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'active bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-white/10'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                  // Hidden labels keep their flex gap; drop it or the icon
                  // sits left of centre.
                  collapsed && 'justify-center gap-0 px-2',
                )}
              >
                <item.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span
                  className={cn(
                    'sidebar-label flex-1',
                    collapsed && 'sidebar-label-hidden',
                  )}
                >
                  {item.label}
                </span>
              </Link>
            )
            return <div key={item.href}>{withTooltip(item.label, link)}</div>
          })}
        </nav>

        <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
          <SidebarServicesList
            pathname={pathname}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        </div>

        {!isMobile && (
          <button
            type="button"
            onClick={toggleCollapsed}
            className="border-sidebar-border text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/30 flex h-12 shrink-0 items-center justify-center border-t transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        )}
      </aside>
    </TooltipProvider>
  )
}
