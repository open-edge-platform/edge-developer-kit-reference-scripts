// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { LucideIcon } from 'lucide-react'
import { type ReactNode, useId } from 'react'

/** One demo step, shown while `active`; with `keepMounted` it stays mounted (hidden) to keep live work. */
export function ExamSection({
  active,
  keepMounted = false,
  title,
  description,
  icon: Icon,
  children,
}: {
  active: boolean
  keepMounted?: boolean
  title: string
  description: string
  icon?: LucideIcon
  children: ReactNode
}) {
  const headingId = useId()
  if (!active && !keepMounted) return null
  return (
    <section
      hidden={!active}
      aria-labelledby={headingId}
      className="h-full space-y-6 overflow-y-auto p-8"
    >
      <div>
        <h2
          id={headingId}
          className="text-foreground flex items-center gap-2 font-bold"
        >
          {Icon && <Icon className="h-5 w-5" aria-hidden />}
          {title}
        </h2>
        <p className="text-muted-foreground mt-2 text-xs">{description}</p>
      </div>
      {children}
    </section>
  )
}
