// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { useExternalStore } from '@/hooks/use-external-store'
import { createExternalStore } from '@/lib/browser/external-store'

/** What a page that should not be left silently says about leaving. */
export interface LeaveGuardOptions {
  /** The confirmation's title, e.g. "Leave with unsaved settings?". */
  title: string
  /** What leaving does to the user's work, e.g. "The translation is canceled." */
  description: string
  /** Defaults to "Leave page". */
  confirmLabel?: string
  /** Defaults to "Stay on page". */
  cancelLabel?: string
  /** Runs once the user confirms, before the navigation (e.g. cancel the job). */
  onLeave?: () => void
}

interface ActiveGuard extends LeaveGuardOptions {
  id: number
}

const guards = createExternalStore<readonly ActiveGuard[]>([])
/** The navigation waiting on the user's answer. */
const pending = createExternalStore<(() => void) | null>(null)
let nextGuardId = 1

function allocateGuardId(): number {
  return nextGuardId++
}

/**
 * Asks before leaving the page while `active`: in-app links, {@link navigateWithLeaveGuard} and
 * reload/close. Browser Back is not intercepted; a query or hash change isn't leaving. Needs
 * `LeaveGuardHost` (mounted once by the dashboard shell).
 */
export function useLeaveGuard(active: boolean, options: LeaveGuardOptions) {
  const { title, description, confirmLabel, cancelLabel, onLeave } = options
  useEffect(() => {
    if (!active) return
    const guard: ActiveGuard = {
      id: allocateGuardId(),
      title,
      description,
      confirmLabel,
      cancelLabel,
      onLeave,
    }
    guards.set((prev) => [...prev, guard])
    return () => guards.set((prev) => prev.filter((g) => g.id !== guard.id))
  }, [active, title, description, confirmLabel, cancelLabel, onLeave])
}

/** Non-link navigation: runs `navigate` now, or once the user confirms leaving a guarded page. */
export function navigateWithLeaveGuard(navigate: () => void) {
  if (guards.get().length === 0) navigate()
  else pending.set(() => navigate)
}

/** The link a click on `event` would follow to another page, if any. */
function leavingHref(event: MouseEvent, pathname: string): string | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null
  }
  const target = event.target
  if (!(target instanceof Element)) return null
  const anchor = target.closest('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return null
  if (anchor.hasAttribute('download')) return null
  if (anchor.target && anchor.target !== '_self') return null
  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin) return null
  if (url.pathname === pathname) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Enforces every active {@link useLeaveGuard}: catches link clicks before `<Link>` does, adds the
 * reload/close prompt, and shows one confirmation for all guards.
 */
export function LeaveGuardHost() {
  const router = useRouter()
  const pathname = usePathname()
  const active = useExternalStore(guards, [])
  const navigate = useExternalStore(pending, null)
  const guarded = active.length > 0

  useEffect(() => {
    if (!guarded) return
    const onClick = (event: MouseEvent) => {
      const href = leavingHref(event, pathname)
      if (!href) return
      // Capture phase on the document: runs before React's root listener,
      // so `<Link>` never sees the click.
      event.preventDefault()
      event.stopPropagation()
      pending.set(() => () => router.push(href))
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = ''
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [guarded, pathname, router])

  // A navigation still waiting when the last guard goes (the job finished
  // while the dialog was up) is dropped; the next guard would ask about it.
  useEffect(() => {
    if (!guarded) pending.set(null)
  }, [guarded])

  const [first] = active
  return (
    <ConfirmDialog
      open={navigate !== null && first !== undefined}
      onOpenChange={(open) => {
        if (!open) pending.set(null)
      }}
      title={first?.title ?? 'Leave this page?'}
      description={
        active.length > 1
          ? active.map((g) => g.description).join(' ')
          : first?.description
      }
      confirmLabel={first?.confirmLabel ?? 'Leave page'}
      cancelLabel={first?.cancelLabel ?? 'Stay on page'}
      variant="destructive"
      data-testid="leave-guard-dialog"
      confirmTestId="leave-guard-confirm"
      cancelTestId="leave-guard-cancel"
      onConfirm={() => {
        for (const guard of active) guard.onLeave?.()
        navigate?.()
        pending.set(null)
      }}
    />
  )
}
