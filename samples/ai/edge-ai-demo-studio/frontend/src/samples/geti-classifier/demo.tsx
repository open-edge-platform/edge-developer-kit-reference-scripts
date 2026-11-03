// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Settings, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  useServiceApiBase,
  useServiceLiveStatus,
} from '@/context/service-status-context'
import type { Sample } from '../types'
import { GetiClassifierRefine } from './components/geti-classifier-refine'
import { GetiClassifierResult } from './components/geti-classifier-result'
import { GetiClassifierSettings } from './components/geti-classifier-settings'
import { GetiClassifierUpload } from './components/geti-classifier-upload'
import { GetiStatusRow } from './components/geti-status-row'
import { useGetiHealth } from './hooks/use-geti-api'
import type { GetiConnection } from './lib/api'
import type { AppView, ClassificationResult } from './lib/classification'

export function GetiImageClassificationDemo({
  sample: _sample,
}: {
  sample: Sample
}) {
  const isServiceOnline = useServiceLiveStatus('geti-classifier') === 'online'
  const apiBase = useServiceApiBase('geti-classifier')

  const [currentView, setCurrentView] = useState<AppView>('upload')
  const [classificationResult, setClassificationResult] =
    useState<ClassificationResult | null>(null)
  // The Geti server the wizard connected to; feedback goes there.
  const [connection, setConnection] = useState<GetiConnection | null>(null)
  const [workerLabels, setWorkerLabels] = useState<string[]>([])

  const { data: health, isLoading: isHealthLoading } = useGetiHealth(
    apiBase,
    isServiceOnline,
  )

  // The labels the worker was set up with, else those its health reports.
  const labels = workerLabels.length
    ? workerLabels
    : (health?.cls_allowed_labels ?? [])
  // Both segmentation and classification models loaded.
  const modelReady = isServiceOnline && health?.pipeline_ready === true

  const showView = (view: AppView) => {
    const needsResult = view === 'result' || view === 'refine'
    setCurrentView(needsResult && !classificationResult ? 'upload' : view)
  }

  // Bypasses `showView`, whose guard still sees no result in the render that made the first one.
  const showResult = (result: ClassificationResult) => {
    setClassificationResult(result)
    setCurrentView('result')
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg">
              <Sparkles className="text-primary h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Geti Image Classifier</h1>
              <p className="text-muted-foreground text-sm">
                Segmentation → Mask → Classification pipeline
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => showView('settings')}
            className="flex-shrink-0"
          >
            <Settings className="mr-2 h-4 w-4" aria-hidden />
            Settings
          </Button>
        </div>

        <GetiStatusRow
          health={health}
          isHealthLoading={isHealthLoading}
          modelReady={modelReady}
          connection={connection}
        />
      </div>

      {currentView === 'upload' && (
        <GetiClassifierUpload
          modelReady={modelReady}
          setCurrentView={showView}
          onClassified={showResult}
        />
      )}

      {currentView === 'result' && classificationResult && (
        <GetiClassifierResult
          result={classificationResult}
          connection={connection}
          workerLabels={labels}
          setCurrentView={showView}
        />
      )}

      {currentView === 'refine' && classificationResult && (
        <GetiClassifierRefine
          classificationResult={classificationResult}
          connection={connection}
          workerLabels={labels}
          setCurrentView={showView}
        />
      )}

      {currentView === 'settings' && (
        <GetiClassifierSettings
          connection={connection}
          onConnectionChange={setConnection}
          onLabelsChange={setWorkerLabels}
          setCurrentView={showView}
        />
      )}
    </div>
  )
}
