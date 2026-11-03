// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import { InfoTip } from '@/components/common/info-tip'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const SECTION_HEADING_CLASS =
  'text-muted-foreground text-xs font-medium tracking-wide uppercase'

/** A settings section's heading. Pass `as="p"` where a heading element would be out of place. */
export function SectionHeading({
  children,
  as: Tag = 'h3',
  id,
  className,
}: {
  children: ReactNode
  as?: 'h2' | 'h3' | 'h4' | 'p' | 'span'
  id?: string
  className?: string
}) {
  return (
    <Tag id={id} className={cn(SECTION_HEADING_CLASS, className)}>
      {children}
    </Tag>
  )
}

/** One section of a Configure sheet or settings card; `data-*` attributes go on the section. */
export function ConfigSection({
  title,
  aside,
  children,
  className,
  ...data
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
} & { [attribute: `data-${string}`]: string | undefined }) {
  return (
    <section className={cn('space-y-3 px-2', className)} {...data}>
      {aside ? (
        <div className="flex items-center justify-between gap-2">
          <SectionHeading>{title}</SectionHeading>
          {aside}
        </div>
      ) : (
        <SectionHeading>{title}</SectionHeading>
      )}
      {children}
    </section>
  )
}

/** A field label with an info tip. */
export function LabelWithTooltip({
  label,
  tooltip,
  htmlFor,
}: {
  label: string
  tooltip: string
  htmlFor?: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <InfoTip
        tooltip={tooltip}
        ariaLabel={`About ${label}`}
        size="sm"
        contentClassName="max-w-xs text-xs"
      />
    </div>
  )
}
