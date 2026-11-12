// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { RotateCcw, ScanText, Settings2, Sparkles } from 'lucide-react'
import {
  DEFAULT_LLM_PROMPT,
  DEFAULT_OCR_PROMPT,
} from '@/samples/ai-exam-marking/lib/prompts'

interface GradingSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ocrPrompt: string
  setOcrPrompt: (prompt: string) => void
  llmPrompt: string
  setLlmPrompt: (prompt: string) => void
}

export function GradingSettingsDialog({
  open,
  onOpenChange,
  ocrPrompt,
  setOcrPrompt,
  llmPrompt,
  setLlmPrompt,
}: GradingSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Grading Configuration
          </DialogTitle>
          <DialogDescription className="text-xs">
            Customize the prompts used during OCR extraction and AI grading.
            Changes apply to all subsequent gradings.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="ocr" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="ocr" className="gap-2 text-xs">
              <ScanText className="h-3.5 w-3.5" />
              OCR/VLM Prompt
            </TabsTrigger>
            <TabsTrigger value="llm" className="gap-2 text-xs">
              <Sparkles className="h-3.5 w-3.5" />
              Grading Prompt
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ocr" className="mt-4 space-y-3">
            <div className="bg-muted/40 rounded-lg border px-4 py-3">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Sent to the vision model to extract answers from each uploaded
                image. Automatically handles text, mathematical working (LaTeX),
                and graph/diagram descriptions. No template variables needed.
              </p>
            </div>
            <Textarea
              value={ocrPrompt}
              onChange={(e) => setOcrPrompt(e.target.value)}
              className="max-h-[320px] font-mono text-xs"
              placeholder="Enter OCR extraction instructions..."
            />
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground gap-1.5 text-xs"
                onClick={() => setOcrPrompt(DEFAULT_OCR_PROMPT)}
              >
                <RotateCcw className="h-3 w-3" />
                Reset to default
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="llm" className="mt-4 space-y-3">
            <div className="bg-muted/40 rounded-lg border px-4 py-3">
              <p className="text-muted-foreground text-xs leading-relaxed">
                Sent to the LLM for each question. Automatically detects text,
                math, and graph/diagram answers and applies the right grading
                logic. Use{' '}
                <code className="bg-muted rounded px-1 font-mono">
                  {'{question}'}
                </code>
                ,{' '}
                <code className="bg-muted rounded px-1 font-mono">
                  {'{marks}'}
                </code>
                , and{' '}
                <code className="bg-muted rounded px-1 font-mono">
                  {'{marking_scheme}'}
                </code>{' '}
                as template variables.
              </p>
            </div>
            <Textarea
              value={llmPrompt}
              onChange={(e) => setLlmPrompt(e.target.value)}
              className="max-h-[320px] font-mono text-xs"
              placeholder="Enter LLM grading instructions..."
            />
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground gap-1.5 text-xs"
                onClick={() => setLlmPrompt(DEFAULT_LLM_PROMPT)}
              >
                <RotateCcw className="h-3 w-3" />
                Reset to default
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
