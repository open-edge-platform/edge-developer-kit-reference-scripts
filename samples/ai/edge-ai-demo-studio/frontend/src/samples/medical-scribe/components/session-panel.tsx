// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, Mic, Plus, Square, Trash2, Upload } from 'lucide-react'
import { type ReactNode, useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { DoctorProfile, Session } from '../types'
import { STT_LANGUAGE_OPTIONS } from '@/services/speech-to-text/hooks'

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
  doctorProfiles: DoctorProfile[]
  isRecording: boolean
  onStartRecording: () => void
  onStopRecording: () => void
  onUploadAudio: (file: File) => void
  onGenerateReport: () => void
  isProcessing: boolean
  isGeneratingReport: boolean
  profileActions?: ReactNode
}

function statusColor(status: Session['status']) {
  switch (status) {
    case 'idle':
      return 'bg-muted-foreground/40'
    case 'recording':
      return 'bg-red-500 animate-pulse'
    case 'processing':
      return 'bg-yellow-500 animate-pulse'
    case 'completed':
      return 'bg-green-500'
    case 'error':
      return 'bg-destructive'
  }
}

export function SessionPanel({
  sessions,
  selectedSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  doctorProfiles,
  isRecording,
  onStartRecording,
  onStopRecording,
  onUploadAudio,
  onGenerateReport,
  isProcessing,
  isGeneratingReport,
  profileActions,
}: SessionPanelProps) {
  const [sessionName, setSessionName] = useState('')
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('')
  const [selectedLanguage, setSelectedLanguage] = useState('en')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selectedSession = sessions.find((s) => s.id === selectedSessionId)

  const handleCreate = useCallback(() => {
    const trimmed = sessionName.trim()
    if (!trimmed) return
    const session = onCreateSession(
      trimmed,
      selectedDoctorId || null,
      selectedLanguage,
    )
    onSelectSession(session.id)
    setSessionName('')
  }, [
    sessionName,
    selectedDoctorId,

    selectedLanguage,
    onCreateSession,
    onSelectSession,
  ])

  return (
    <div className="flex h-full min-h-0 flex-col border-r">
      <div className="border-b p-3">
        <h3 className="mb-3 text-sm font-semibold">New Session</h3>
        <div className="space-y-2">
          <Input
            placeholder="Session name"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="h-8 text-sm"
          />
          <div className="flex gap-2">
            <Select
              value={selectedDoctorId}
              onValueChange={(id) => {
                setSelectedDoctorId(id)
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select doctor" />
              </SelectTrigger>
              <SelectContent>
                {doctorProfiles.length === 0 && (
                  <SelectItem value="_empty" disabled>
                    No profiles — create one first
                  </SelectItem>
                )}
                {doctorProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.embedding ? '' : ' (no voice)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {profileActions}
          </div>
          <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STT_LANGUAGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="w-full"
            onClick={handleCreate}
            disabled={!sessionName.trim()}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Create Session
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              role="button"
              tabIndex={0}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                session.id === selectedSessionId
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted',
              )}
              onClick={() => onSelectSession(session.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectSession(session.id)
                }
              }}
            >
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  statusColor(session.status),
                )}
              />
              <div className="flex-1">
                <span className="block truncate">{session.name}</span>
                <small className="text-muted-foreground block truncate text-[10px]">
                  {session.doctorProfileId
                    ? `Dr. ${session.doctorProfileName ?? 'Unknown'}`
                    : 'No Doctor'}{' '}
                  · {session.sessionCreatedAt}
                </small>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteSession(session.id)
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="text-muted-foreground py-8 text-center text-xs">
              Create a session to get started
            </p>
          )}
        </div>
      </ScrollArea>

      {selectedSession && (
        <div className="border-t p-3">
          <div className="flex flex-wrap gap-2">
            {isRecording ? (
              <Button size="sm" variant="destructive" onClick={onStopRecording}>
                <Square className="mr-1 h-3.5 w-3.5" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={onStartRecording}
                disabled={
                  isProcessing || selectedSession.status === 'processing'
                }
              >
                <Mic className="mr-1 h-3.5 w-3.5" />
                Record
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRecording || isProcessing}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              Upload
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onGenerateReport}
              disabled={
                selectedSession.transcripts.length === 0 ||
                isProcessing ||
                isGeneratingReport
              }
            >
              {isGeneratingReport && (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              )}
              Generate Report
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onUploadAudio(file)
              e.target.value = ''
            }}
          />
        </div>
      )}
    </div>
  )
}
