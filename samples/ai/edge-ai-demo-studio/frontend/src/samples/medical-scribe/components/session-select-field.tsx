// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface SessionSelectFieldProps {
  /** The field's accessible name. */
  label: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  emptyMessage?: string
  className?: string
}

/** The doctor or language `<Select>` of a session form. */
export function SessionSelectField({
  label,
  placeholder,
  value,
  onChange,
  options,
  emptyMessage,
  className,
}: SessionSelectFieldProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.length === 0 && emptyMessage && (
          <SelectItem value="_empty" disabled>
            {emptyMessage}
          </SelectItem>
        )}
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A doctor profile as a select option: its name, flagged when it has no voice sample. */
export function doctorOptions(
  profiles: { id: string; name: string; embedding: number[] | null }[],
) {
  return profiles.map((p) => ({
    value: p.id,
    label: `${p.name}${p.embedding ? '' : ' (no voice)'}`,
  }))
}
