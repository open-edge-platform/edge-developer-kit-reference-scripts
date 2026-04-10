// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { SUPPORTED_LANGUAGES } from '../hooks'
import type { PptTranslatorParamValues } from '../hooks'

interface TranslationConfigPanelProps {
  disabled?: boolean
  values: PptTranslatorParamValues
  availableModels: string[]
  onChangeSourceLanguage: (v: string) => void
  onChangeTargetLanguage: (v: string) => void
  onChangeModel: (v: string) => void
  onChangePreserveProperNouns: (v: boolean) => void
  onChangeTranslateSpeakerNotes: (v: boolean) => void
  onChangeAutoAdjustFontSize: (v: boolean) => void
  onChangePresentationContext: (v: string) => void
}

export function TranslationConfigPanel({
  disabled,
  values,
  availableModels,
  onChangeSourceLanguage,
  onChangeTargetLanguage,
  onChangeModel,
  onChangePreserveProperNouns,
  onChangeTranslateSpeakerNotes,
  onChangeAutoAdjustFontSize,
  onChangePresentationContext,
}: TranslationConfigPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Translation Settings</CardTitle>
        <CardDescription>Configure translation options</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Source Language */}
        <div className="space-y-2">
          <Label htmlFor="source-language">Source Language</Label>
          <Select
            value={values.sourceLanguage}
            onValueChange={onChangeSourceLanguage}
            disabled={disabled}
          >
            <SelectTrigger
              id="source-language"
              data-testid="source-language-select"
            >
              <SelectValue placeholder="Select source language" />
            </SelectTrigger>
            <SelectContent data-testid="source-language-content">
              {SUPPORTED_LANGUAGES.map((lang: string) => (
                <SelectItem key={lang} value={lang}>
                  {lang}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Target Language */}
        <div className="space-y-2">
          <Label htmlFor="target-language">Target Language</Label>
          <Select
            value={values.targetLanguage}
            onValueChange={onChangeTargetLanguage}
            disabled={disabled}
          >
            <SelectTrigger
              id="target-language"
              data-testid="target-language-select"
            >
              <SelectValue placeholder="Select target language" />
            </SelectTrigger>
            <SelectContent data-testid="target-language-content">
              {SUPPORTED_LANGUAGES.map((lang: string) => (
                <SelectItem key={lang} value={lang}>
                  {lang}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Model Selection */}
        {availableModels.length > 1 && (
          <div className="space-y-2">
            <Label htmlFor="model">AI Model</Label>
            <Select
              value={values.model}
              onValueChange={onChangeModel}
              disabled={disabled}
            >
              <SelectTrigger id="model" data-testid="model-select">
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

        {/* Presentation Context */}
        <div className="space-y-2">
          <Label htmlFor="context">
            Presentation Context{' '}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </Label>
          <Textarea
            data-testid="presentation-context-textarea"
            id="context"
            placeholder="e.g., This is a technology conference about IoT and edge computing"
            value={values.presentationContext}
            onChange={(e) => onChangePresentationContext(e.target.value)}
            disabled={disabled}
            rows={3}
            className="resize-none"
          />
          <p className="text-muted-foreground text-xs">
            Provide context to improve translation accuracy
          </p>
        </div>

        {/* Toggle Options */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="preserve-names" className="text-base">
                Preserve Proper Nouns
              </Label>
              <p className="text-muted-foreground text-sm">
                Keep names and brands unchanged
              </p>
            </div>
            <Switch
              data-testid="preserve-proper-nouns-toggle"
              id="preserve-names"
              checked={values.preserveProperNouns}
              onCheckedChange={onChangePreserveProperNouns}
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="speaker-notes" className="text-base">
                Translate Speaker Notes
              </Label>
              <p className="text-muted-foreground text-sm">
                Include notes in translation
              </p>
            </div>
            <Switch
              data-testid="translate-speaker-notes-toggle"
              id="speaker-notes"
              checked={values.translateSpeakerNotes}
              onCheckedChange={onChangeTranslateSpeakerNotes}
              disabled={disabled}
            />
          </div>

          <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="auto-adjust" className="text-base">
                Auto-Adjust Font Size
              </Label>
              <p className="text-muted-foreground text-sm">
                Dynamically resize text to fit
              </p>
            </div>
            <Switch
              data-testid="auto-adjust-font-size-toggle"
              id="auto-adjust"
              checked={values.autoAdjustFontSize}
              onCheckedChange={onChangeAutoAdjustFontSize}
              disabled={disabled}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
