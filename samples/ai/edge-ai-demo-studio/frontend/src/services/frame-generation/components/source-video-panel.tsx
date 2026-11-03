// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Film, Loader } from 'lucide-react'
import { ConfigSection } from '@/components/configure/config-section'
import { VideoFilePicker } from '@/components/common/video-file-picker'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { JobPhase } from '@/services/common/jobs/job-run'
import type { InterpolationMode } from '../hooks'
import { InterpolationPreview, modeEffect } from './interpolation-preview'

const MULTIPLIER_OPTIONS = ['2', '3', '4']

const MODE_OPTIONS: { value: InterpolationMode; label: string }[] = [
  { value: 'fps', label: 'Higher FPS' },
  { value: 'slowmo', label: 'Slow motion' },
]

const isMode = (value: string): value is InterpolationMode =>
  MODE_OPTIONS.some((m) => m.value === value)

const RUN_LABEL: Partial<Record<JobPhase | 'idle', string>> = {
  submitting: 'Uploading...',
  queued: 'Queued...',
  running: 'Interpolating...',
}

/** Mode as radio cards; native radios, so arrow keys move between them. */
function ModeChoice({
  mode,
  multiplier,
  onModeChange,
}: {
  mode: InterpolationMode
  multiplier: number
  onModeChange: (mode: InterpolationMode) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-muted-foreground mb-2 text-xs">Mode</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {MODE_OPTIONS.map((option) => {
          const checked = option.value === mode
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-md border p-2.5 transition-colors',
                checked
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/40',
              )}
            >
              <input
                type="radio"
                name="fg-mode"
                value={option.value}
                checked={checked}
                onChange={(e) => {
                  if (isMode(e.target.value)) onModeChange(e.target.value)
                }}
                className="accent-primary mt-0.5"
                data-testid={`fg-mode-${option.value}`}
              />
              <span className="min-w-0">
                <span className="text-foreground block text-sm font-medium">
                  {option.label}
                </span>
                <span className="text-muted-foreground block text-xs">
                  {modeEffect(option.value, multiplier)}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function SourceVideoPanel({
  videoFile,
  onVideoFileChange,
  mode,
  onModeChange,
  multiplier,
  onMultiplierChange,
  phase,
  available,
  onSubmit,
}: {
  videoFile: File | null
  onVideoFileChange: (file: File | null) => void
  mode: InterpolationMode
  onModeChange: (mode: InterpolationMode) => void
  multiplier: string
  onMultiplierChange: (multiplier: string) => void
  /** Where the current task is, `idle` before one. */
  phase: JobPhase | 'idle'
  /** The instance can take a request (`useDemoRuntime`). */
  available: boolean
  onSubmit: () => void
}) {
  const runLabel = RUN_LABEL[phase]
  const factor = Number(multiplier)

  return (
    <ConfigSection
      title="Source video"
      className="border-border space-y-4 rounded-lg border p-4"
    >
      <VideoFilePicker
        file={videoFile}
        onFileChange={onVideoFileChange}
        accept="video/*"
        formatsHint="MP4, WebM or other common formats"
      />

      <ModeChoice mode={mode} multiplier={factor} onModeChange={onModeChange} />

      <div className="space-y-2">
        <Label
          htmlFor="fg-multiplier-select"
          className="text-muted-foreground text-xs"
        >
          {mode === 'fps' ? 'FPS multiplier' : 'Slow-down factor'}
        </Label>
        <Select value={multiplier} onValueChange={onMultiplierChange}>
          <SelectTrigger id="fg-multiplier-select" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MULTIPLIER_OPTIONS.map((m) => (
              <SelectItem key={m} value={m} className="text-xs">
                {m}×
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {videoFile && (
        <InterpolationPreview
          file={videoFile}
          mode={mode}
          multiplier={factor}
        />
      )}

      <Button
        className="w-full"
        disabled={!videoFile || !available || runLabel !== undefined}
        onClick={onSubmit}
      >
        {runLabel ? (
          <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
        ) : (
          <Film aria-hidden="true" className="h-4 w-4" />
        )}
        {runLabel ?? 'Interpolate'}
      </Button>
    </ConfigSection>
  )
}
