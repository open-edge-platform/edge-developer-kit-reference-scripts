// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type ReactNode, useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import type { DoctorProfile, Session, SessionUpdate } from '../lib/types'
import { NewSessionForm } from './new-session-form'
import { isSessionStarted, SessionEditRow, SessionRow } from './session-row'

interface SessionPanelProps {
  sessions: Session[]
  selectedSessionId: string | null
  onSelectSession: (id: string) => void
  onCreateSession: (
    name: string,
    doctorProfileId: string | null,
    language: string,
  ) => Session
  onDeleteSession: (id: string) => void
  onUpdateSession: (id: string, updates: SessionUpdate) => void
  doctorProfiles: DoctorProfile[]
  /** Beside the new session's doctor select (the doctor profiles button). */
  profileActions?: ReactNode
}

/** New-session form and session list; the selected session's actions live in the control bar. */
export function SessionPanel({
  sessions,
  selectedSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onUpdateSession,
  doctorProfiles,
  profileActions,
}: SessionPanelProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Session | null>(null)

  /** The doctor's current name (a renamed profile shows its new one). */
  const doctorName = (session: Session) =>
    session.doctorProfileId
      ? (doctorProfiles.find((p) => p.id === session.doctorProfileId)?.name ??
        session.doctorProfileName ??
        'Unknown')
      : null

  const handleSaveEdit = (
    id: string,
    edit: { name: string; doctorProfileId: string | null; language: string },
  ) => {
    setEditingSessionId(null)
    // Drop the edit if the session started after the editor was opened.
    const session = sessions.find((s) => s.id === id)
    if (!session || isSessionStarted(session)) return
    onUpdateSession(id, {
      ...edit,
      doctorProfileName:
        doctorProfiles.find((p) => p.id === edit.doctorProfileId)?.name ?? null,
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <NewSessionForm
        doctorProfiles={doctorProfiles}
        profileActions={profileActions}
        onCreate={(name, doctorProfileId, language) =>
          onSelectSession(onCreateSession(name, doctorProfileId, language).id)
        }
      />

      {/* Native scroller: ScrollArea's `display: table` content box would let long names push
          the row actions out of view instead of truncating. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="space-y-1 p-2" aria-label="Sessions">
          {sessions.map((session) => (
            <li key={session.id}>
              {editingSessionId === session.id ? (
                <SessionEditRow
                  session={session}
                  selected={session.id === selectedSessionId}
                  doctorProfiles={doctorProfiles}
                  onSave={(edit) => handleSaveEdit(session.id, edit)}
                  onCancel={() => setEditingSessionId(null)}
                />
              ) : (
                <SessionRow
                  session={session}
                  selected={session.id === selectedSessionId}
                  doctorName={doctorName(session)}
                  onSelect={() => onSelectSession(session.id)}
                  onEdit={() => setEditingSessionId(session.id)}
                  onDelete={() => setDeleting(session)}
                />
              )}
            </li>
          ))}
        </ul>
        {sessions.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-xs">
            Create a session to get started
          </p>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        variant="destructive"
        title={`Delete “${deleting?.name ?? ''}”?`}
        description="Its transcript and report are deleted with it, and processing that is still running stops. This cannot be undone."
        onConfirm={() => {
          if (deleting) onDeleteSession(deleting.id)
        }}
      />
    </div>
  )
}
