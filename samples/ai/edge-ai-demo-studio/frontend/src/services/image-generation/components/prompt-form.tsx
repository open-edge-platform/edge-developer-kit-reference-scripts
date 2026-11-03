// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Loader, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** Prompt, negative prompt and submit for a Generate or Edit tab; `children` go above the prompt. */
export function PromptForm({
  id,
  promptLabel,
  prompt,
  onPromptChange,
  promptPlaceholder,
  promptRows,
  promptTestId,
  negativePrompt,
  onNegativePromptChange,
  submitLabel,
  pendingLabel,
  pending,
  canSubmit,
  onSubmit,
  submitTestId,
  children,
}: {
  /** Prefix of the fields' ids, unique per tab. */
  id: string
  promptLabel: string
  prompt: string
  onPromptChange: (value: string) => void
  promptPlaceholder: string
  promptRows: number
  promptTestId?: string
  negativePrompt: string
  onNegativePromptChange: (value: string) => void
  submitLabel: string
  pendingLabel: string
  pending: boolean
  canSubmit: boolean
  onSubmit: () => void
  submitTestId: string
  children?: ReactNode
}) {
  return (
    <div className="space-y-3">
      {children}
      <Label
        htmlFor={`${id}-prompt`}
        className="text-foreground text-sm font-medium"
      >
        {promptLabel}
      </Label>
      <Textarea
        id={`${id}-prompt`}
        data-testid={promptTestId}
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder={promptPlaceholder}
        rows={promptRows}
        className="bg-muted/30 resize-none"
      />
      <Label
        htmlFor={`${id}-negative-prompt`}
        className="text-foreground text-sm font-medium"
      >
        Negative prompt
        <span className="text-muted-foreground font-normal">(optional)</span>
      </Label>
      <Textarea
        id={`${id}-negative-prompt`}
        value={negativePrompt}
        onChange={(e) => onNegativePromptChange(e.target.value)}
        placeholder="What to keep out of the image: blurry, low quality, watermark…"
        rows={2}
        className="bg-muted/30 resize-none"
      />
      <Button
        data-testid={submitTestId}
        onClick={onSubmit}
        disabled={pending || !canSubmit}
        className="w-full gap-2"
      >
        {pending ? (
          <>
            <Loader aria-hidden className="h-4 w-4 animate-spin" />
            {pendingLabel}
          </>
        ) : (
          <>
            <Sparkles aria-hidden className="h-4 w-4" />
            {submitLabel}
          </>
        )}
      </Button>
    </div>
  )
}
