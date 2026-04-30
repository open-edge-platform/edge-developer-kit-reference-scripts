// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Mic, Plus, Trash2, Upload, UserRound } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useEnrollSpeaker } from '@/services/diarization/hooks'
import { useRecording } from '../hooks/use-recording'
import type { DoctorProfile } from '../types'

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
  const [newName, setNewName] = useState('')
  const [enrollingId, setEnrollingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const enrollSpeaker = useEnrollSpeaker()
  const { isRecording, startRecording, stopRecording, clearAudio } =
    useRecording()

  const handleAdd = useCallback(() => {
    const trimmed = newName.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setNewName('')
    toast.success('Profile created')
  }, [newName, onAdd])

  const handleStartEnroll = useCallback(
    async (profileId: string) => {
      setEnrollingId(profileId)
      try {
        await startRecording()
      } catch {
        toast.error('Microphone access denied')
        setEnrollingId(null)
      }
    },
    [startRecording],
  )

  const handleStopEnroll = useCallback(async () => {
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
  }, [stopRecording, enrollingId, enrollSpeaker, onUpdateEmbedding, clearAudio])

  const handleEnrollFromFile = useCallback(
    async (profileId: string, file: File) => {
      try {
        const result = await enrollSpeaker.mutateAsync(file)
        onUpdateEmbedding(profileId, result.embedding)
        toast.success('Voice enrolled successfully')
      } catch {
        toast.error('Voice enrollment failed')
      }
    },
    [enrollSpeaker, onUpdateEmbedding],
  )

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          title="Manage doctor profiles"
        >
          <UserRound className="h-3.5 w-3.5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[360px] overflow-y-auto sm:max-w-[360px]"
      >
        <SheetHeader>
          <SheetTitle>Doctor Profiles</SheetTitle>
          <SheetDescription>
            Create profiles and enroll voice samples for speaker identification.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          <div className="flex gap-2">
            <Input
              placeholder="Doctor name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <Button size="sm" onClick={handleAdd} disabled={!newName.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="bg-muted/50 flex items-center gap-3 rounded-lg p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {profile.name}
                    </span>
                    <Badge
                      variant={profile.embedding ? 'default' : 'secondary'}
                      className="text-[10px]"
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
                        className="h-7 text-xs"
                      >
                        <Mic className="mr-1 h-3 w-3 animate-pulse" />
                        Stop &amp; Enroll
                      </Button>
                    </div>
                  )}
                  {enrollingId === profile.id && enrollSpeaker.isPending && (
                    <p className="text-muted-foreground mt-2 text-xs">
                      Enrolling…
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {enrollingId !== profile.id && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => handleStartEnroll(profile.id)}
                        title="Enroll voice via microphone"
                      >
                        <Mic className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => {
                          setEnrollingId(profile.id)
                          fileInputRef.current?.click()
                        }}
                        title="Enroll voice from file"
                      >
                        <Upload className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive h-7 w-7"
                    onClick={() => onRemove(profile.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
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

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file && enrollingId) {
              handleEnrollFromFile(enrollingId, file)
            }
            setEnrollingId(null)
            e.target.value = ''
          }}
        />
      </SheetContent>
    </Sheet>
  )
}
