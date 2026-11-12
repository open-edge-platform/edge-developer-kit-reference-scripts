// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Plus } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  resolveSttLanguage,
  type SttLanguageOption,
} from '@/services/speech-to-text/config'
import type { DoctorProfile } from '../lib/types'
import { doctorOptions, SessionSelectField } from './session-select-field'

/** Name, doctor and language of a new consultation. */
export function NewSessionForm({
  doctorProfiles,
  languageOptions,
  onCreate,
  profileActions,
}: {
  doctorProfiles: DoctorProfile[]
  languageOptions: SttLanguageOption[]
  onCreate: (
    name: string,
    doctorProfileId: string | null,
    language: string,
  ) => void
  /** Beside the doctor select, e.g. the doctor profiles button. */
  profileActions?: ReactNode
}) {
  const [sessionName, setSessionName] = useState('')
  const [doctorId, setDoctorId] = useState('')
  // Empty until picked: the default follows the STT service's languages as it loads.
  const [pickedLanguage, setPickedLanguage] = useState('')
  const language = resolveSttLanguage(pickedLanguage, languageOptions)

  const create = () => {
    const name = sessionName.trim()
    if (!name) return
    onCreate(name, doctorId || null, language)
    setSessionName('')
  }

  return (
    <div className="border-b p-3">
      <h3 className="mb-3 text-sm font-semibold">New session</h3>
      <div className="space-y-2">
        <Input
          aria-label="Session name"
          placeholder="Session name"
          value={sessionName}
          onChange={(e) => setSessionName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          className="h-8 text-sm"
        />
        <div className="flex gap-2">
          <SessionSelectField
            label="Doctor"
            placeholder="Select doctor"
            value={doctorId}
            onChange={setDoctorId}
            options={doctorOptions(doctorProfiles)}
            emptyMessage="No profiles — create one first"
            className="h-8 text-sm"
          />
          {profileActions}
        </div>
        <SessionSelectField
          label="Language"
          value={language}
          onChange={setPickedLanguage}
          options={languageOptions}
          className="h-8 text-sm"
        />
        <Button
          size="sm"
          className="w-full"
          onClick={create}
          disabled={!sessionName.trim()}
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
          Create session
        </Button>
      </div>
    </div>
  )
}
