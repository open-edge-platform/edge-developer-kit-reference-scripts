// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  Activity,
  GalleryHorizontalEnd,
  LayoutDashboard,
  type LucideIcon,
  Server,
  Settings,
} from 'lucide-react'

/** A top-level page of the studio. */
export interface AppPage {
  href: string
  /** Short name, for the sidebar. */
  label: string
  /** Full name, for the breadcrumb and the command palette. */
  title: string
  icon: LucideIcon
}

/** The top-level pages, in sidebar order. */
export const APP_PAGES: readonly AppPage[] = [
  { href: '/', label: 'Dashboard', title: 'Dashboard', icon: LayoutDashboard },
  { href: '/services', label: 'Services', title: 'Services', icon: Server },
  {
    href: '/samples',
    label: 'Samples',
    title: 'Samples',
    icon: GalleryHorizontalEnd,
  },
  {
    href: '/system-monitoring',
    label: 'System',
    title: 'System monitoring',
    icon: Activity,
  },
  { href: '/settings', label: 'Settings', title: 'Settings', icon: Settings },
]

/** The top-level page a path belongs to (`/services/x` → Services). */
export function appPageFor(pathname: string): AppPage {
  const section = `/${pathname.split('/').filter(Boolean)[0] ?? ''}`
  return APP_PAGES.find((page) => page.href === section) ?? APP_PAGES[0]
}
