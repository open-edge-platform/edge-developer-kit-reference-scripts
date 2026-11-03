// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowLeftRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Setters } from '@/hooks/use-param-state'
import {
  SUPPORTED_LANGUAGES,
  type PptTranslatorParamValues,
} from '../hooks/use-params'

interface LanguagePairProps {
  values: Pick<PptTranslatorParamValues, 'sourceLanguage' | 'targetLanguage'>
  setters: Pick<
    Setters<PptTranslatorParamValues>,
    'setSourceLanguage' | 'setTargetLanguage'
  >
  disabled?: boolean
}

/** Source → target language, next to the upload, with a swap between them. */
export function LanguagePair({ values, setters, disabled }: LanguagePairProps) {
  const swap = () => {
    const { sourceLanguage, targetLanguage } = values
    setters.setSourceLanguage(targetLanguage)
    setters.setTargetLanguage(sourceLanguage)
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor="source-language">Translate from</Label>
        <Select
          value={values.sourceLanguage}
          onValueChange={setters.setSourceLanguage}
          disabled={disabled}
        >
          <SelectTrigger
            id="source-language"
            data-testid="source-language-select"
            className="w-full"
          >
            <SelectValue placeholder="Select source language" />
          </SelectTrigger>
          <SelectContent data-testid="source-language-content">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {lang}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="self-center sm:mb-0.5 sm:self-end"
        onClick={swap}
        disabled={disabled}
        aria-label="Swap languages"
      >
        <ArrowLeftRight className="h-4 w-4" aria-hidden />
      </Button>
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor="target-language">Translate to</Label>
        <Select
          value={values.targetLanguage}
          onValueChange={setters.setTargetLanguage}
          disabled={disabled}
        >
          <SelectTrigger
            id="target-language"
            data-testid="target-language-select"
            className="w-full"
          >
            <SelectValue placeholder="Select target language" />
          </SelectTrigger>
          <SelectContent data-testid="target-language-content">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {lang}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
