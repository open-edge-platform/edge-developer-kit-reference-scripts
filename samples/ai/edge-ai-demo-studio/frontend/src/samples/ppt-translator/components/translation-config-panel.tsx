// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Setters } from '@/hooks/use-param-state'
import type { PptTranslatorParamValues } from '../hooks/use-params'

interface TranslationConfigPanelProps {
  disabled?: boolean
  values: PptTranslatorParamValues
  availableModels: string[]
  setters: Setters<PptTranslatorParamValues>
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  testId,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  testId: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <p className="text-muted-foreground text-[11px]">{description}</p>
      </div>
      <Switch
        data-testid={testId}
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="shrink-0"
      />
    </div>
  )
}

/** Advanced translation settings for the Parameters sheet; the languages sit beside the upload. */
export function TranslationConfigPanel({
  disabled,
  values,
  availableModels,
  setters,
}: TranslationConfigPanelProps) {
  return (
    <div className="space-y-5">
      {disabled && (
        <p className="text-muted-foreground text-[11px]">
          Settings are locked while a translation runs; they apply to the next
          job.
        </p>
      )}

      {availableModels.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="model" className="text-xs">
            AI model
          </Label>
          <Select
            value={values.model}
            onValueChange={setters.setModel}
            disabled={disabled}
          >
            <SelectTrigger
              id="model"
              data-testid="model-select"
              className="w-full"
            >
              <SelectValue placeholder="Select AI model" />
            </SelectTrigger>
            <SelectContent data-testid="model-content">
              {availableModels.map((modelName) => (
                <SelectItem key={modelName} value={modelName}>
                  {modelName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="context" className="text-xs">
          Presentation context{' '}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          data-testid="presentation-context-textarea"
          id="context"
          placeholder="e.g. A technology conference talk about IoT and edge computing"
          value={values.presentationContext}
          onChange={(e) => setters.setPresentationContext(e.target.value)}
          disabled={disabled}
          rows={3}
          className="bg-muted/30 resize-none text-xs"
        />
        <p className="text-muted-foreground text-[11px]">
          A sentence about the deck helps the model choose the right terms.
        </p>
      </div>

      <div className="space-y-4">
        <SwitchRow
          id="preserve-names"
          testId="preserve-proper-nouns-toggle"
          label="Preserve proper nouns"
          description="Keep names and brands unchanged"
          checked={values.preserveProperNouns}
          onCheckedChange={setters.setPreserveProperNouns}
          disabled={disabled}
        />
        <SwitchRow
          id="speaker-notes"
          testId="translate-speaker-notes-toggle"
          label="Translate speaker notes"
          description="Include the notes under each slide"
          checked={values.translateSpeakerNotes}
          onCheckedChange={setters.setTranslateSpeakerNotes}
          disabled={disabled}
        />
        <SwitchRow
          id="auto-adjust"
          testId="auto-adjust-font-size-toggle"
          label="Auto-adjust font size"
          description="Shrink text that no longer fits its box"
          checked={values.autoAdjustFontSize}
          onCheckedChange={setters.setAutoAdjustFontSize}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
