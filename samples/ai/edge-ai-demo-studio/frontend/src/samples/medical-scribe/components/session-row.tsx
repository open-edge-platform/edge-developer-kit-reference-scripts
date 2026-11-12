// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  resolveSttLanguage,
  type SttLanguageOption,
} from '@/services/speech-to-text/config'
import { formatTimestamp } from '../lib/timestamps'
import type { DoctorProfile, Session, SessionStatus } from '../lib/types'
import { doctorOptions, SessionSelectField } from './session-select-field'

/** Each session state's dot and the words that go with it (never the colour alone). */
export const SESSION_STATUS: Record<
  SessionStatus,
  { dot: string; label: string }
> = {
  idle: { dot: 'bg-muted-foreground/40', label: 'Not recorded' },
  recording: { dot: 'bg-destructive animate-pulse', label: 'Recording' },
  processing: { dot: 'bg-warning animate-pulse', label: 'Processing' },
  completed: { dot: 'bg-success', label: 'Processed' },
  error: { dot: 'bg-destructive', label: 'Failed' },
}

/** A session has started once it records or has a transcript: its details are fixed then. */
export function isSessionStarted(session: Session): boolean {
  return session.status !== 'idle' || session.transcripts.length > 0
}

/** One session in the list: select it, rename it while not started, delete it. */
export function SessionRow({
  session,
  selected,
  doctorName,
  onSelect,
  onEdit,
  onDelete,
}: {
  session: Session
  selected: boolean
  /** The session's doctor, by the profile's current name; `null` for none. */
  doctorName: string | null
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const status = SESSION_STATUS[session.status]
  return (
    <div
      className={cn(
        'flex w-full items-center gap-1 rounded-md pr-2 text-sm transition-colors',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        // The name is cut to one line; hovering shows all of it (the
        // button's accessible name already carries it whole).
        title={session.name}
        className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', status.dot)}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{session.name}</span>
          <small className="text-muted-foreground block truncate text-xs">
            <span className="sr-only">{status.label} · </span>
            {doctorName === null ? 'No Doctor' : `Dr. ${doctorName}`} ·{' '}
            {formatTimestamp(session.sessionCreatedAt)}
          </small>
        </span>
      </button>
      {!isSessionStarted(session) && (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0"
          onClick={onEdit}
          aria-label={`Rename ${session.name}`}
          title="Rename session"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 shrink-0"
        onClick={onDelete}
        aria-label={`Delete ${session.name}`}
        title="Delete session"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  )
}

/** Inline editor of a session not started yet: name, doctor, language. */
export function SessionEditRow({
  session,
  selected,
  doctorProfiles,
  languageOptions,
  onSave,
  onCancel,
}: {
  session: Session
  selected: boolean
  doctorProfiles: DoctorProfile[]
  languageOptions: SttLanguageOption[]
  onSave: (edit: {
    name: string
    doctorProfileId: string | null
    language: string
  }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(session.name)
  const [doctorId, setDoctorId] = useState(session.doctorProfileId ?? '')
  const [pickedLanguage, setLanguage] = useState(session.language)
  const language = resolveSttLanguage(pickedLanguage, languageOptions)

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave({ name: trimmed, doctorProfileId: doctorId || null, language })
  }

  return (
    <div
      className={cn(
        'rounded-md px-2 py-2 text-sm',
        selected ? 'bg-accent text-accent-foreground' : 'bg-muted',
      )}
    >
      <div className="space-y-1.5">
        <Input
          autoFocus
          aria-label="Session name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') onCancel()
          }}
          className="h-8 text-sm"
          placeholder="Session name"
        />
        <SessionSelectField
          label="Doctor"
          placeholder="Select doctor"
          value={doctorId}
          onChange={setDoctorId}
          options={doctorOptions(doctorProfiles)}
          emptyMessage="No profiles — create one first"
          className="h-8 text-sm"
        />
        <SessionSelectField
          label="Language"
          value={language}
          onChange={setLanguage}
          options={languageOptions}
          className="h-8 text-sm"
        />
        <div className="flex justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label="Cancel edit"
            onClick={onCancel}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <Button
            size="icon"
            className="h-8 w-8"
            aria-label="Save edit"
            disabled={!name.trim()}
            onClick={save}
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  )
}
