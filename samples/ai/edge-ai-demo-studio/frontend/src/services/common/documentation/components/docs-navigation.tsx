// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { List } from 'lucide-react'
import type { MouseEvent } from 'react'
import { cn } from '@/lib/utils'

export type NavItem = { id: string; title: string }

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
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const target = document.getElementById(id)
    if (!target) return
    onNavigate?.(id)
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    target.scrollIntoView({
      behavior: reduced ? 'instant' : 'smooth',
      block: 'start',
    })
    target.focus({ preventScroll: true })
    window.history.replaceState(window.history.state, '', `#${id}`)
  }

  // Sticks just below the service page's sticky region, which the page
  // measures as `--service-sticky-offset` (it grows as the bar wraps).
  return (
    <nav
      aria-label="On this page"
      className="border-border bg-card rounded-xl border p-3 xl:sticky xl:top-[calc(var(--service-sticky-offset,12rem)+1rem)] xl:py-4"
    >
      <p className="text-muted-foreground mb-2 flex items-center gap-2 px-2 text-xs font-semibold">
        <List aria-hidden="true" className="size-3.5" />
        On this page
      </p>
      <div className="flex gap-1 overflow-x-auto xl:flex-col">
        {navItems.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={activeId === item.id ? 'location' : undefined}
            onClick={(event) => handleNavClick(event, item.id)}
            className={cn(
              'shrink-0 rounded-lg px-3 py-2 text-xs transition-colors',
              activeId === item.id
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {item.title}
          </a>
        ))}
      </div>
    </nav>
  )
}
