// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Settings2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'
import { ParamRenderer } from '@/samples/common/components/param-renderer'
import type { DemoParam } from '@/types/demo-params'

interface DemoParameterSidebarProps {
  params?: DemoParam[]
  children?: ReactNode
}

export function DemoParameterSidebar({
  params = [],
  children,
}: DemoParameterSidebarProps) {
  if (params.length === 0 && !children) return null

  return (
    <div className="border-border bg-muted/10 space-y-5 rounded-xl border p-4">
      <div className="text-foreground flex items-center gap-2 text-sm font-medium">
        <div className="bg-primary/10 flex h-6 w-6 items-center justify-center rounded-md">
          <Settings2 className="text-primary h-3.5 w-3.5" />
        </div>
        Parameters
      </div>

      <Separator />

      {/* Dynamic Parameters */}
      {params.map((param) => (
        <ParamRenderer key={param.id} param={param} />
      ))}

      {children}
    </div>
  )
}
