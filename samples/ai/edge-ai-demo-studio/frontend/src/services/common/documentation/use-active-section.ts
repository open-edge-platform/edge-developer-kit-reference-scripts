// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'
import type { NavItem } from './components/docs-navigation'

/**
 * The docs section the reader is at: the last whose top scrolled past, or the URL hash's on
 * arrival. A navigation click briefly wins over the scrolling it starts.
 */
export function useActiveSection(navItems: NavItem[]) {
  const [activeId, setActiveId] = useState(navItems[0]?.id ?? '')
  const clickCooldown = useRef(0)
  const onNavigate = (id: string) => {
    setActiveId(id)
    clickCooldown.current = Date.now() + 800
  }

  useEffect(() => {
    let frame = 0
    const updateActive = () => {
      if (Date.now() < clickCooldown.current) return
      let bestId = navItems[0]?.id ?? ''
      for (const item of navItems) {
        const element = document.getElementById(item.id)
        if (
          element &&
          element.getBoundingClientRect().top <=
            parseFloat(getComputedStyle(element).scrollMarginTop) + 16
        )
          bestId = item.id
      }
      setActiveId(bestId)
    }
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateActive)
    }
    const hash = window.location.hash.slice(1)
    if (navItems.some((item) => item.id === hash)) {
      frame = requestAnimationFrame(() => {
        document
          .getElementById(hash)
          ?.scrollIntoView({ block: 'start', behavior: 'instant' })
        setActiveId(hash)
      })
    } else frame = requestAnimationFrame(updateActive)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [navItems])

  return { activeId, onNavigate }
}
