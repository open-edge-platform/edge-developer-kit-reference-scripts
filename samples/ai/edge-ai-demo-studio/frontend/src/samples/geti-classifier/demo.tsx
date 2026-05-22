// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import {
  Sparkles,
  Settings,
  Scissors,
  BadgeCheck,
  Server,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useServiceLiveStatus } from '@/context/service-status-context'
import { useGetiHealth } from '@/services/geti-classifier/hooks'
import {
  GetiClassifierUpload,
  GetiClassifierResult,
  GetiClassifierRefine,
  GetiClassifierSettings,
} from './components'
import type { AppView, ClassificationResult, GetiConfig } from './components'
import type { Sample } from '../types'

export function GetiImageClassificationDemo({
  sample: _sample,
}: {
  sample: Sample
}) {
  const serviceStatus = useServiceLiveStatus('geti-classifier')
  const isServiceOnline = serviceStatus === 'online'

  const [currentView, setCurrentView] = useState<AppView>('upload')
  const [classificationResult, setClassificationResult] =
    useState<ClassificationResult | null>(null)
  const [getiConfig, setGetiConfig] = useState<GetiConfig>({
    host: '',
    token: '',
  })
  const [isConnected, setIsConnected] = useState(false)
  const [workerLabels, setWorkerLabels] = useState<string[]>([])

  const { data: healthData, isLoading: isHealthLoading } =
    useGetiHealth(isServiceOnline)

  // ── Sync labels from health response (restores across page refreshes) ──────
  if (
    healthData?.cls_allowed_labels &&
    healthData.cls_allowed_labels.length > 0 &&
    workerLabels.length === 0
  ) {
    setWorkerLabels(healthData.cls_allowed_labels)
  }

  // ── Pipeline ready: both seg + cls models must be loaded ──────────────────
  const modelReady = isServiceOnline && healthData?.pipeline_ready === true

  const handleSetCurrentView = (view: AppView) => {
    if ((view === 'result' || view === 'refine') && !classificationResult) {
      setCurrentView('upload')
      return
    }
    setCurrentView(view)
  }

  // ── Header metadata ───────────────────────────────────────────────────────
  const clsProjectName = healthData?.cls_project_name ?? null
  const segProjectName = healthData?.seg_project_name ?? null
  const clsModelName = healthData?.cls_model_name ?? null
  const clsModelVersion = healthData?.cls_model_version ?? null
  const segModelName = healthData?.seg_model_name ?? null
  const segModelVersion = healthData?.seg_model_version ?? null

  const bothConfigured =
    healthData?.cls_configured === true && healthData?.seg_configured === true

  return (
    <div className="space-y-6 p-6">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {/* ── Title row ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg">
              <Sparkles className="text-primary h-5 w-5" />
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
            onClick={() => handleSetCurrentView('settings')}
            className="flex-shrink-0"
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Button>
        </div>

        {/* ── Status row ────────────────────────────────────────────────────── */}
        <div className="bg-muted/30 grid grid-cols-2 gap-3 rounded-xl border p-3 md:grid-cols-4">
          {/* Pipeline status */}
          <div className="bg-card flex items-center gap-3 rounded-lg border p-3">
            <div
              className={cn(
                'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                isHealthLoading
                  ? 'bg-gray-100 dark:bg-gray-800'
                  : modelReady
                    ? 'bg-green-100 dark:bg-green-900/30'
                    : 'bg-red-100 dark:bg-red-900/30',
              )}
            >
              {isHealthLoading ? (
                <div className="h-3 w-3 animate-pulse rounded-full bg-gray-400" />
              ) : modelReady ? (
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                Pipeline
              </p>
              <p
                className={cn(
                  'truncate text-sm font-semibold',
                  isHealthLoading
                    ? 'text-muted-foreground'
                    : modelReady
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400',
                )}
              >
                {isHealthLoading
                  ? 'Loading...'
                  : modelReady
                    ? 'Ready'
                    : !bothConfigured
                      ? 'Not Configured'
                      : 'Not Loaded'}
              </p>
            </div>
          </div>

          {/* SEG model */}
          <div className="bg-card flex items-center gap-3 rounded-lg border p-3">
            <div
              className={cn(
                'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                healthData?.seg_model_loaded
                  ? 'bg-blue-100 dark:bg-blue-900/30'
                  : 'bg-muted',
              )}
            >
              <Scissors
                className={cn(
                  'h-4 w-4',
                  healthData?.seg_model_loaded
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-muted-foreground',
                )}
              />
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                SEG Model
              </p>
              <p className="truncate text-sm font-semibold">
                {healthData?.seg_model_loaded && segModelName
                  ? `${segModelName}${segModelVersion != null ? ` v${segModelVersion}` : ''}`
                  : 'Not loaded'}
              </p>
              {segProjectName && (
                <p className="text-muted-foreground truncate text-xs">
                  {segProjectName}
                </p>
              )}
            </div>
          </div>

          {/* CLS model */}
          <div className="bg-card flex items-center gap-3 rounded-lg border p-3">
            <div
              className={cn(
                'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                healthData?.cls_model_loaded
                  ? 'bg-purple-100 dark:bg-purple-900/30'
                  : 'bg-muted',
              )}
            >
              <BadgeCheck
                className={cn(
                  'h-4 w-4',
                  healthData?.cls_model_loaded
                    ? 'text-purple-600 dark:text-purple-400'
                    : 'text-muted-foreground',
                )}
              />
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                CLS Model
              </p>
              <p className="truncate text-sm font-semibold">
                {healthData?.cls_model_loaded && clsModelName
                  ? `${clsModelName}${clsModelVersion != null ? ` v${clsModelVersion}` : ''}`
                  : 'Not loaded'}
              </p>
              {clsProjectName && (
                <p className="text-muted-foreground truncate text-xs">
                  {clsProjectName}
                </p>
              )}
            </div>
          </div>

          {/* Geti connection */}
          <div className="bg-card flex items-center gap-3 rounded-lg border p-3">
            <div
              className={cn(
                'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                isConnected ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-muted',
              )}
            >
              <Server
                className={cn(
                  'h-4 w-4',
                  isConnected
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-muted-foreground',
                )}
              />
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                Geti Server
              </p>
              <p className="truncate text-sm font-semibold">
                {isConnected
                  ? getiConfig.host
                      .replace('https://', '')
                      .replace('http://', '')
                  : 'Not connected'}
              </p>
              {isConnected && (
                <div className="mt-0.5 flex items-center gap-1">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                  <span className="text-muted-foreground text-xs">
                    Connected
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Views ───────────────────────────────────────────────────────────── */}
      {currentView === 'upload' && (
        <GetiClassifierUpload
          modelReady={modelReady}
          setCurrentView={handleSetCurrentView}
          setClassificationResult={setClassificationResult}
        />
      )}

      {currentView === 'result' && classificationResult && (
        <GetiClassifierResult
          result={classificationResult}
          getiConfig={getiConfig}
          isConnected={isConnected}
          workerLabels={workerLabels}
          setCurrentView={handleSetCurrentView}
        />
      )}

      {currentView === 'refine' && classificationResult && (
        <GetiClassifierRefine
          classificationResult={classificationResult}
          getiConfig={getiConfig}
          isConnected={isConnected}
          workerLabels={workerLabels}
          setCurrentView={handleSetCurrentView}
        />
      )}

      {currentView === 'settings' && (
        <GetiClassifierSettings
          getiConfig={getiConfig}
          isConnected={isConnected}
          setGetiConfig={setGetiConfig}
          setIsConnected={setIsConnected}
          setWorkerLabels={setWorkerLabels}
          setCurrentView={handleSetCurrentView}
        />
      )}
    </div>
  )
}
