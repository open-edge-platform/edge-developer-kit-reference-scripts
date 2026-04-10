// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  ChevronLeft,
  ChevronRight,
  GalleryHorizontalEnd,
  LayoutDashboard,
  Server,
  Settings,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { SidebarServicesList } from './sidebar-services-list'

const navItems = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Services', href: '/services', icon: Server },
  {
    label: 'Samples',
    href: '/samples',
    icon: GalleryHorizontalEnd,
  },
  { label: 'Settings', href: '/settings', icon: Settings },
]

export function SidebarNav({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const toggleCollapsed = () => {
    setCollapsed((prev) => !prev)
  }

  return (
    <aside
      className={cn(
        'border-sidebar-border bg-sidebar sticky top-0 flex h-screen flex-col border-r transition-all duration-300',
        collapsed ? 'w-[68px]' : 'w-[260px]',
      )}
    >
      <div className="sidebar-brand-stripe absolute top-0 bottom-0 left-0 w-[3px] opacity-60" />

      {/* Header */}
      <div className="border-sidebar-border flex h-16 items-center gap-3 border-b px-4">
        <Image
          src={'/logo-classicblue-white.svg'}
          alt="Intel"
          width={72}
          height={30}
          loading="eager"
          className="object-contain"
        />
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sidebar-foreground text-sm leading-tight font-semibold">
              Edge AI Demo Studio
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <div className={cn('mb-3 px-2', collapsed && 'text-center')}>
          {!collapsed && (
            <span className="text-sidebar-foreground/50 text-[11px] font-semibold tracking-wider uppercase">
              Navigation
            </span>
          )}
        </div>
        {navItems.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'gradient-border relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'active bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                collapsed && 'justify-center px-2',
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
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
        })}

        <SidebarServicesList
          pathname={pathname}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </nav>

      <button
        type="button"
        onClick={toggleCollapsed}
        className="border-sidebar-border text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/30 flex h-12 items-center justify-center border-t transition-colors"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </button>
    </aside>
  )
}
