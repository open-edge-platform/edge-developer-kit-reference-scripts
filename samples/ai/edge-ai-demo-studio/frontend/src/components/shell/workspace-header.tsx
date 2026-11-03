// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronRight, Search, Settings } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useSyncExternalStore } from 'react'
import { useGalleryReturnHref } from '@/components/samples/gallery-state'
import { useServicesReturnHref } from '@/components/services/services-list-return'
import { openCommandPalette } from '@/components/sidebar/command-palette'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { noteWorkVisit } from '@/hooks/use-service-shortcuts'
import { safeHref, HREF_CHARS } from '@/lib/validation'
import { getSampleById } from '@/samples/registry'
import { getServiceById } from '@/services/registry'
import { appPageFor } from './app-pages'

// Show this platform's shortcut key. useSyncExternalStore (not an effect) so
// the server and first client render agree.
const subscribeNever = () => () => {}
const getIsMac = () => /Mac|iPhone|iPad|iPod/.test(window.navigator.userAgent)
const getIsMacOnServer = () => false

export function WorkspaceHeader() {
  const pathname = usePathname()
  const isMac = useSyncExternalStore(subscribeNever, getIsMac, getIsMacOnServer)
  const segments = pathname.split('/').filter(Boolean)
  const section = appPageFor(pathname).title
  // A service's or a sample's name: static metadata, the same before and
  // after the services list loads.
  const detail =
    segments[1] &&
    (segments[0] === 'services'
      ? getServiceById(segments[1])?.name
      : segments[0] === 'samples'
        ? getSampleById(segments[1])?.title
        : undefined)
  const isSamplesSection = segments[0] === 'samples'
  const isDemoRoute = isSamplesSection && segments[2] === 'demo'
  // The "Samples" and "Services" crumbs return to the list view the user left.
  const gallerySectionHref = useGalleryReturnHref()
  const servicesSectionHref = useServicesReturnHref()
  const sectionHref =
    segments.length > 1 && isSamplesSection
      ? gallerySectionHref
      : segments.length > 1 && segments[0] === 'services'
        ? servicesSectionHref
        : `/${segments[0]}`
  let safeSectionHref = ''
  for (const ch of safeHref(sectionHref)) {
    let ok = ''
    for (const allowed of HREF_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      safeSectionHref = '/'
      break
    }
    safeSectionHref += ok
  }

  return (
    <header className="border-border/70 bg-background/90 sticky top-14 z-30 flex h-16 items-center justify-between gap-3 border-b px-4 backdrop-blur-xl sm:px-6 lg:top-0 lg:px-8 [@media(max-height:560px)]:static">
      {/* The instance shown is in the query string, which is only known in
          the browser: its own boundary keeps the header prerenderable. */}
      <Suspense fallback={null}>
        <VisitRecorder />
      </Suspense>
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-2 text-xs sm:text-sm"
      >
        {segments.length > 1 ? (
          <Link
            href={safeSectionHref}
            className="text-muted-foreground hover:text-primary shrink-0"
          >
            {section}
          </Link>
        ) : (
          <span aria-current="page" className="font-medium">
            {section}
          </span>
        )}
        {detail && (
          <>
            <ChevronRight
              aria-hidden="true"
              className="text-muted-foreground/50 size-3 shrink-0"
            />
            {isDemoRoute ? (
              <Link
                href={`/samples/${segments[1]}`}
                className="text-muted-foreground hover:text-primary truncate font-medium"
              >
                {detail}
              </Link>
            ) : (
              <span aria-current="page" className="truncate font-medium">
                {detail}
              </span>
            )}
          </>
        )}
        {isDemoRoute && (
          <>
            <ChevronRight
              aria-hidden="true"
              className="text-muted-foreground/50 size-3 shrink-0"
            />
            <span aria-current="page" className="truncate font-medium">
              Demo
            </span>
          </>
        )}
      </nav>
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={openCommandPalette}
              aria-label="Search workspace"
            >
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search ({isMac ? '⌘' : 'Ctrl'} K)</TooltipContent>
        </Tooltip>
        <Link
          href="/settings"
          aria-label="Open workspace settings"
          className="border-border bg-card text-primary hover:bg-accent flex size-9 items-center justify-center rounded-xl border transition-colors"
        >
          <Settings className="size-4" />
        </Link>
      </div>
    </header>
  )
}

/**
 * Notes every service, instance and sample page opened as recent work. Lives in the shared header,
 * so every way of arriving counts.
 */
function VisitRecorder() {
  const pathname = usePathname()
  const instanceId = useSearchParams().get('instance') ?? undefined
  useEffect(() => {
    const [section, id, sub] = pathname.split('/').filter(Boolean)
    if (!id) return
    if (section === 'services' && getServiceById(id)) {
      noteWorkVisit({ kind: 'service', id, instanceId })
    } else if (section === 'samples' && getSampleById(id)) {
      noteWorkVisit({ kind: 'sample', id, demo: sub === 'demo' })
    }
  }, [pathname, instanceId])
  return null
}
