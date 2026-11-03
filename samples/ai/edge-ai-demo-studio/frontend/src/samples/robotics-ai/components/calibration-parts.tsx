// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CheckCircle2, ImageIcon, Loader } from 'lucide-react'
import Image from 'next/image'
import { type ComponentProps, type ReactNode, useState } from 'react'
import { TONES } from '@/components/common/tones'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** What the last action answered, or its error in its place — never both. */
export function ActionResult({
  message,
  error,
}: {
  message: string | null
  error: string | null
}) {
  if (error) {
    return (
      <p role="alert" className="text-destructive text-xs">
        {error}
      </p>
    )
  }
  if (message) {
    return (
      <p role="status" className="text-success text-xs">
        {message}
      </p>
    )
  }
  return null
}

/** A numbered calibration step: its title and description, then its controls. */
export function CalibrationStepCard({
  step,
  title,
  description,
  children,
}: {
  step: number
  title: string
  description: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-label={`Step ${step}: ${title}`} className="flex gap-3">
      <div
        aria-hidden
        className="bg-warning/10 ring-warning/20 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1"
      >
        {step}
      </div>
      <div className="flex-1 space-y-3">
        <div>
          <h4 className="text-sm font-semibold">{title}</h4>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {description}
          </p>
        </div>
        {children}
      </div>
    </section>
  )
}

/** A small action button with a spinner while it runs, a check otherwise. */
export function StepActionButton({
  pending,
  pendingLabel,
  children,
  icon = true,
  disabled,
  ...props
}: ComponentProps<typeof Button> & {
  pending: boolean
  pendingLabel?: ReactNode
  /** Shows the check icon when idle. */
  icon?: boolean
}) {
  return (
    <Button
      size="sm"
      className="gap-1.5"
      disabled={pending || disabled}
      {...props}
    >
      {pending ? (
        <Loader className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        icon && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      )}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  )
}

export function DoneBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2',
        TONES.success.surface,
      )}
    >
      <CheckCircle2 className="text-success h-4 w-4" aria-hidden />
      <p className="text-success-strong text-xs font-medium">{children}</p>
    </div>
  )
}

/** A "Show example …" button opening a picture of how it should look. */
export function ExampleImageButton({
  label,
  title,
  src,
  alt,
}: {
  label: string
  title: string
  src: string
  alt: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <ImageIcon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Image
            src={src}
            alt={alt}
            width={800}
            height={600}
            className="w-full rounded-lg object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
