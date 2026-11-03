// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

/**
 * A folded group of Configure settings. `keepMounted` hides folded fields instead of unmounting
 * them, so settings that Save sends keep their drafts and validation.
 */
export function CollapsibleSection({
  title,
  note,
  open,
  onOpenChange,
  keepMounted = false,
  testId,
  children,
}: {
  title: string
  /** At the trigger's end: what the group is (e.g. "Optional"). */
  note?: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  keepMounted?: boolean
  /** `<testId>-toggle` on the trigger, `<testId>` on the content. */
  testId: string
  children: ReactNode
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="border-border rounded-lg border"
    >
      <CollapsibleTrigger
        className="hover:bg-muted/40 focus-visible:ring-ring/50 flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-[3px]"
        data-testid={`${testId}-toggle`}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <span className="text-foreground text-sm font-medium">{title}</span>
        {note && (
          <span className="text-muted-foreground ml-auto text-right text-xs">
            {note}
          </span>
        )}
      </CollapsibleTrigger>
      {/* Without keepMounted, pass no `hidden` at all (not even undefined):
          it would override the one Radix sets on the folded content box. */}
      <CollapsibleContent
        forceMount={keepMounted || undefined}
        {...(keepMounted && { hidden: !open })}
        className="border-border space-y-5 border-t px-1 py-4"
        data-testid={testId}
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
