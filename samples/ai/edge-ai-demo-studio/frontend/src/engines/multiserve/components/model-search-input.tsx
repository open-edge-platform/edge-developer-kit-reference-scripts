// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

export function ModelSearchInput({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="text-muted-foreground absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2"
      />
      <Input
        data-testid="model-search-input"
        aria-label="Search models"
        placeholder="Search models..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 pr-7 pl-7 text-xs"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear model search"
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
          onClick={() => onChange('')}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
