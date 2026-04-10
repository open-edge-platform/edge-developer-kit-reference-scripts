// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Input } from '@/components/ui/input'

export function ExtraParamsSection({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="space-y-2 px-2">
      <button
        type="button"
        className="flex w-full items-center justify-between"
        onClick={() => setIsOpen(!isOpen)}
      >
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Extra Parameters
        </p>
        <ChevronDown
          className={`text-muted-foreground h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen && (
        <div className="space-y-2">
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g., --ratio 0.8 --group-size 128"
            className="text-xs"
          />
          <p className="text-muted-foreground text-[11px]">
            Additional CLI parameters for model conversion (optional).
          </p>
        </div>
      )}
    </div>
  )
}
