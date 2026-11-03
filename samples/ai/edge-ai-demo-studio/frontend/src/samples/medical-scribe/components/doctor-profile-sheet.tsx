// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Mic, Plus, Trash2, Upload, UserRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { UploadButton } from '@/components/common/upload-button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useServiceApiBase } from '@/context/service-status-context'
import { RecordingCancelledError } from '@/hooks/use-media-recorder'
import { useEnrollSpeaker } from '@/services/diarization/hooks'
import { useRecording } from '../hooks/use-recording'
import type { DoctorProfile } from '../lib/types'

interface DoctorProfileSheetProps {
  profiles: DoctorProfile[]
  onAdd: (name: string) => DoctorProfile
  onRemove: (id: string) => void
  onUpdateEmbedding: (id: string, embedding: number[]) => void
}

export function DoctorProfileSheet({
  profiles,
  onAdd,
  onRemove,
  onUpdateEmbedding,
}: DoctorProfileSheetProps) {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [enrollingId, setEnrollingId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<DoctorProfile | null>(null)

  const diarizationApiBase = useServiceApiBase('diarization')
  const enrollSpeaker = useEnrollSpeaker(diarizationApiBase)
  const { isRecording, startRecording, stopRecording, clearAudio } =
    useRecording()

  const handleAdd = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setNewName('')
    toast.success('Profile created')
  }

  const handleStartEnroll = async (profileId: string) => {
    setEnrollingId(profileId)
    try {
      await startRecording()
    } catch (err) {
      if (!(err instanceof RecordingCancelledError)) {
        toast.error('Microphone access denied')
      }
      setEnrollingId(null)
    }
  }

  const handleStopEnroll = async () => {
    const blob = await stopRecording()
    if (!blob.size || !enrollingId) {
      setEnrollingId(null)
      return
    }
    try {
      const result = await enrollSpeaker.mutateAsync(blob)
      onUpdateEmbedding(enrollingId, result.embedding)
      toast.success('Voice enrolled successfully')
    } catch {
      toast.error('Voice enrollment failed')
    } finally {
      setEnrollingId(null)
      clearAudio()
    }
  }

  const handleEnrollFromFile = async (profileId: string, file: File) => {
    setEnrollingId(profileId)
    try {
      const result = await enrollSpeaker.mutateAsync(file)
      onUpdateEmbedding(profileId, result.embedding)
      toast.success('Voice enrolled successfully')
    } catch {
      toast.error('Voice enrollment failed')
    } finally {
      setEnrollingId(null)
    }
  }

  // Closing the sheet mid-enrollment would leave the microphone recording
  // with its Stop button gone: the recording is dropped instead.
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next || !isRecording) return
    stopRecording().then(() => {
      clearAudio()
      setEnrollingId(null)
    })
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          title="Manage doctor profiles"
          aria-label="Manage doctor profiles"
        >
          <UserRound className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-[360px]"
      >
        <SheetHeader>
          <SheetTitle>Doctor profiles</SheetTitle>
          <SheetDescription>
            Create profiles and enroll voice samples for speaker identification.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          <div className="flex gap-2">
            <Input
              aria-label="Doctor name"
              placeholder="Doctor name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={handleAdd}
              disabled={!newName.trim()}
              aria-label="Add doctor profile"
              title="Add doctor profile"
            >
              <Plus className="h-4 w-4" aria-hidden />
            </Button>
          </div>

          <div className="space-y-2">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="bg-muted/50 flex items-center gap-3 rounded-lg p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <TruncatedText
                      text={profile.name}
                      className="text-sm font-medium"
                    />
                    <Badge
                      variant={profile.embedding ? 'default' : 'secondary'}
                      className="shrink-0 text-xs"
                    >
                      {profile.embedding ? 'Enrolled' : 'No voice'}
                    </Badge>
                  </div>
                  {enrollingId === profile.id && isRecording && (
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={handleStopEnroll}
                        className="h-8 text-xs"
                      >
                        <Mic
                          className="mr-1 h-3 w-3 animate-pulse"
                          aria-hidden
                        />
                        Stop and enroll
                      </Button>
                    </div>
                  )}
                  {enrollingId === profile.id && enrollSpeaker.isPending && (
                    <p className="text-muted-foreground mt-2 text-xs">
                      Enrolling…
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {enrollingId !== profile.id && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => handleStartEnroll(profile.id)}
                        aria-label={`Enroll ${profile.name}'s voice via microphone`}
                        title="Enroll voice via microphone"
                      >
                        <Mic className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                      <UploadButton
                        accept="audio/*"
                        onFiles={(files) =>
                          handleEnrollFromFile(profile.id, files[0])
                        }
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Enroll voice from file"
                        aria-label={`Enroll ${profile.name}'s voice from a file`}
                      >
                        <Upload className="h-3.5 w-3.5" aria-hidden />
                      </UploadButton>
                    </>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive h-8 w-8"
                    onClick={() => setRemoving(profile)}
                    aria-label={`Remove ${profile.name}`}
                    title="Remove profile"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
            ))}
            {profiles.length === 0 && (
              <p className="text-muted-foreground py-4 text-center text-sm">
                No profiles yet. Add a doctor profile above.
              </p>
            )}
          </div>
        </div>
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(next) => !next && setRemoving(null)}
          variant="destructive"
          title={`Remove ${removing?.name ?? 'this profile'}?`}
          description="Its enrolled voice is deleted too, so sessions with this doctor are no longer matched to their voice. This cannot be undone."
          confirmLabel="Remove"
          onConfirm={() => {
            if (removing) onRemove(removing.id)
          }}
        />
      </SheetContent>
    </Sheet>
  )
}
