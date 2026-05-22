// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useState } from 'react'
import { FileText, Settings } from 'lucide-react'
import { AlertCircle } from 'lucide-react'
import { useServiceLiveStatus } from '@/context/service-status-context'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  TranslationUpload,
  TranslationProgress,
  TranslationConfigPanel,
} from './components'
import { usePptTranslatorParams, useTranslate } from './hooks'
import type { Sample } from '../types'

type AppState = 'idle' | 'translating' | 'completed'

export function PptTranslatorDemo({ sample: _sample }: { sample: Sample }) {
  const pptStatus = useServiceLiveStatus('ppt-translator')
  const textGenStatus = useServiceLiveStatus('text-generation')
  const isServiceReady = pptStatus === 'online' && textGenStatus === 'online'

  const [appState, setAppState] = useState<AppState>('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const { values, setters } = usePptTranslatorParams()

  const translate = useTranslate({
    onSuccess: (result) => {
      setJobId(result.job_id)
      setAppState('translating')
    },
  })

  const handleUpload = useCallback(
    (file: File) => {
      translate.mutate({ file, params: values })
    },
    [translate, values],
  )

  const handleTranslationComplete = useCallback(() => {
    setAppState('completed')
  }, [])

  const handleReset = useCallback(() => {
    setAppState('idle')
    setJobId(null)
    translate.reset()
  }, [translate])

  const settingsDisabled = appState !== 'idle'

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6" />
          <div>
            <h1 className="text-xl font-semibold">PowerPoint Translator</h1>
            <p className="text-muted-foreground text-sm">
              Translate PowerPoint presentations while preserving formatting
              using AI
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge
            data-testid="language-badge"
            variant="secondary"
            className="border-blue-200 bg-blue-100 px-3 py-1 text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200"
          >
            {values.sourceLanguage} → {values.targetLanguage}
          </Badge>

          {values.preserveProperNouns && (
            <Badge
              data-testid="preserve-names-badge"
              variant="secondary"
              className="border-green-200 bg-green-100 px-3 py-1 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200"
            >
              <div className="mr-1.5 h-2 w-2 animate-pulse rounded-full bg-green-500" />
              Preserve Names
            </Badge>
          )}

          {values.presentationContext && (
            <Badge
              data-testid="context-provided-badge"
              variant="secondary"
              className="border-purple-200 bg-purple-100 px-3 py-1 text-purple-800 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-200"
            >
              <div className="mr-1.5 h-2 w-2 animate-pulse rounded-full bg-purple-500" />
              Context Provided
            </Badge>
          )}

          <Badge
            data-testid="api-status-badge"
            variant="secondary"
            className={
              isServiceReady
                ? 'border-green-200 bg-green-100 px-3 py-1 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200'
                : 'border-red-200 bg-red-100 px-3 py-1 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200'
            }
          >
            <div
              className={`mr-1.5 h-2 w-2 rounded-full ${isServiceReady ? 'animate-pulse bg-green-500' : 'bg-red-500'}`}
            />
            {isServiceReady ? 'Service Online' : 'Service Offline'}
          </Badge>

          <Button
            data-testid="settings-button"
            variant="outline"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </div>
      </div>

      {translate.isError && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-4">
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            Translation Error
          </p>
          <p className="mt-1 text-sm">{translate.error.message}</p>
        </div>
      )}

      {appState === 'idle' && (
        <TranslationUpload
          disabled={!isServiceReady}
          isUploading={translate.isPending}
          uploadError={translate.isError ? translate.error.message : null}
          model={values.model}
          onUpload={handleUpload}
        />
      )}

      {(appState === 'translating' || appState === 'completed') &&
        jobId !== null && (
          <TranslationProgress
            jobId={jobId}
            onReset={handleReset}
            onComplete={handleTranslationComplete}
          />
        )}

      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle
              data-testid="settings-dialog-title"
              className="flex items-center gap-2"
            >
              <Settings className="h-5 w-5" />
              Translation Settings
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            <TranslationConfigPanel
              disabled={settingsDisabled}
              values={values}
              availableModels={[values.model]}
              onChangeSourceLanguage={setters.setSourceLanguage}
              onChangeTargetLanguage={setters.setTargetLanguage}
              onChangeModel={setters.setModel}
              onChangePreserveProperNouns={setters.setPreserveProperNouns}
              onChangeTranslateSpeakerNotes={setters.setTranslateSpeakerNotes}
              onChangeAutoAdjustFontSize={setters.setAutoAdjustFontSize}
              onChangePresentationContext={setters.setPresentationContext}
            />
          </div>
          <DialogFooter className="mt-4">
            <Button
              data-testid="settings-close-button"
              onClick={() => setIsSettingsOpen(false)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
