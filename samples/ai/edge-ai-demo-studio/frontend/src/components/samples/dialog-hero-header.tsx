// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Header of the samples' task dialogs. Put it first in a `DialogContent` with `p-0 gap-0`. */
export function DialogHeroHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: ReactNode
  description: ReactNode
}) {
  return (
    <div className="from-primary/10 via-secondary/5 relative bg-gradient-to-br to-transparent px-6 pt-6 pb-5">
      <div
        className="sidebar-brand-stripe absolute inset-x-0 top-0 h-0.5"
        aria-hidden
      />
      <DialogHeader className="space-y-2">
        <DialogTitle className="flex items-center gap-2.5 text-base">
          <span className="bg-primary/10 ring-primary/15 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1">
            <Icon className="text-primary h-5 w-5" aria-hidden />
          </span>
          <span className="truncate">{title}</span>
        </DialogTitle>
        <DialogDescription className="leading-relaxed">
          {description}
        </DialogDescription>
      </DialogHeader>
    </div>
  )
}
