// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Home, Settings, LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ReactNode } from 'react'

interface SampleHeaderProps {
  icon: LucideIcon
  title: string
  description: string
  onOpenSettings: () => void
  disabled: boolean
  badge?: ReactNode
  children?: ReactNode
}

export function SampleHeader({
  icon: Icon,
  title,
  description,
  onOpenSettings,
  disabled,
  badge,
  children,
}: SampleHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-6 py-4 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/80">
      <div className="flex items-center gap-3">
        <div className="bg-primary text-primary-foreground flex h-10 w-10 items-center justify-center rounded-lg">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {title}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {description}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {badge}
        <Link href="/">
          <Button variant="outline" size="icon" className="size-8">
            <Home className="h-4 w-4" />
          </Button>
        </Link>
        {children}
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenSettings}
          disabled={disabled}
          className="gap-2"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Button>
      </div>
    </div>
  )
}
