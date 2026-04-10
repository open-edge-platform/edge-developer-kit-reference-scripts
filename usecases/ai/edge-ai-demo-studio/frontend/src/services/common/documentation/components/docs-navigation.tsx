// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { MouseEvent } from 'react'
import { cn } from '@/lib/utils'

export type NavItem = {
  id: string
  title: string
  description: string
}

export function DocsNavigation({
  navItems,
  activeId,
  onNavigate,
}: {
  navItems: NavItem[]
  activeId: string
  onNavigate?: (id: string) => void
}) {
  const handleNavClick = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault()
    const target = document.getElementById(id)
    if (!target) return

    onNavigate?.(id)

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const top = target.getBoundingClientRect().top + window.scrollY - 96

    window.scrollTo({
      top,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    })
    window.history.replaceState(null, '', `#${id}`)
  }

  return (
    <aside className="sticky top-8 pr-2">
      <nav className="relative pl-4">
        <div
          className="bg-border absolute top-1 bottom-1 left-0 w-px"
          aria-hidden
        />
        <div className="space-y-1">
          {navItems.map((item) => {
            const isActive = item.id === activeId
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(event) => handleNavClick(event, item.id)}
                className={cn(
                  'group relative block rounded-md px-3 py-2 transition-colors',
                  isActive
                    ? 'text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0 bottom-0 left-[-10px] w-[2px] rounded-full transition-colors',
                    isActive
                      ? 'bg-foreground'
                      : 'group-hover:bg-border bg-transparent',
                  )}
                  aria-hidden
                />
                <p className="text-sm leading-snug">{item.title}</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {item.description}
                </p>
              </a>
            )
          })}
        </div>
      </nav>
    </aside>
  )
}
