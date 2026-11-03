// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowLeft, ExternalLink, Loader, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useServiceApiBase } from '@/context/service-status-context'
import { useFeedback } from '../hooks/use-geti-api'
import type { GetiConnection } from '../lib/api'
import type { AppView, ClassificationResult } from '../lib/classification'
import { FeedbackSuccess, ResultImages, SegmentInfo } from './result-parts'
import { SettingsRequiredNotice } from './settings-required-notice'

interface GetiClassifierRefineProps {
  classificationResult: ClassificationResult
  /** The Geti server feedback goes to, once connected. */
  connection: GetiConnection | null
  workerLabels: string[]
  setCurrentView: (view: AppView) => void
}

/** Correcting a wrong prediction: the right label goes to Geti for retraining. */
export function GetiClassifierRefine({
  classificationResult: result,
  connection,
  workerLabels,
  setCurrentView,
}: GetiClassifierRefineProps) {
  const [selectedLabel, setSelectedLabel] = useState('')
  const apiBase = useServiceApiBase('geti-classifier')
  const feedback = useFeedback(apiBase)

  const submit = () => {
    if (!selectedLabel || !connection) return
    feedback.mutate({
      connection,
      imageId: result.imageId,
      labelName: selectedLabel,
      isCorrect: false,
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ExternalLink className="text-primary h-5 w-5" aria-hidden />
          <CardTitle>Refine Label</CardTitle>
        </div>
        <CardDescription>
          Provide the correct label for the masked segment to improve
          model&apos;s accuracy in future training cycles.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {feedback.isSuccess ? (
          <FeedbackSuccess
            title="Correction sent to Geti for fine-tuning"
            onNext={() => setCurrentView('upload')}
          >
            <p className="text-muted-foreground text-sm">
              Label submitted:{' '}
              <span className="font-medium capitalize">{selectedLabel}</span>
            </p>
            <p className="text-muted-foreground text-xs">
              The masked segment image was uploaded to Geti with the label.
            </p>
          </FeedbackSuccess>
        ) : (
          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-4">
              <p className="text-primary text-sm font-medium">
                ID: {result.id}
              </p>

              <ResultImages result={result} layout="stacked" />

              <dl className="grid grid-cols-2 gap-3">
                <div className="bg-muted/30 rounded-lg p-4">
                  <dt className="text-muted-foreground mb-1 text-xs font-medium tracking-wider uppercase">
                    Current Prediction
                  </dt>
                  <dd className="text-base font-medium capitalize">
                    {result.predictedLabel}
                  </dd>
                </div>
                <div className="bg-muted/30 rounded-lg p-4">
                  <dt className="text-muted-foreground mb-1 text-xs font-medium tracking-wider uppercase">
                    Confidence
                  </dt>
                  <dd className="text-primary text-base font-medium">
                    {result.confidenceScore}%
                  </dd>
                </div>
              </dl>

              <section
                aria-label="Segment info"
                className="bg-muted/20 space-y-1.5 rounded-lg border p-3"
              >
                <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  Segment Info
                </p>
                <SegmentInfo segmentation={result.segmentation} compact />
              </section>
            </div>

            <div className="flex flex-col">
              {!connection && (
                <SettingsRequiredNotice
                  className="mb-4"
                  onOpenSettings={() => setCurrentView('settings')}
                >
                  {(settingsLink) => (
                    <>
                      Configure Geti server in {settingsLink} to send feedback.
                    </>
                  )}
                </SettingsRequiredNotice>
              )}

              {feedback.isError && (
                <InlineNotice tone="destructive" size="sm" className="mb-4">
                  {feedback.error.message}
                </InlineNotice>
              )}

              <div className="mb-8 space-y-3">
                <Label htmlFor="geti-correct-label" className="font-medium">
                  Correct Classification
                </Label>
                <p
                  id="geti-correct-label-hint"
                  className="text-muted-foreground text-xs"
                >
                  Select the correct label for the masked segment shown above.
                  This image will be uploaded to Geti for retraining.
                </p>

                {workerLabels.length === 0 ? (
                  <SettingsRequiredNotice
                    onOpenSettings={() => setCurrentView('settings')}
                  >
                    {(settingsLink) => (
                      <>
                        No labels available. Make sure the worker is configured
                        in {settingsLink}.
                      </>
                    )}
                  </SettingsRequiredNotice>
                ) : (
                  <Select
                    value={selectedLabel}
                    onValueChange={setSelectedLabel}
                  >
                    <SelectTrigger
                      id="geti-correct-label"
                      aria-describedby="geti-correct-label-hint"
                      className="bg-card h-14 w-full text-base"
                    >
                      <SelectValue placeholder="Select the accurate label..." />
                    </SelectTrigger>
                    <SelectContent>
                      {workerLabels.map((label) => (
                        <SelectItem key={label} value={label}>
                          <span className="capitalize">{label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="mt-auto space-y-3">
                <Button
                  className="h-14 w-full gap-2 text-base font-medium"
                  onClick={submit}
                  disabled={
                    !selectedLabel ||
                    feedback.isPending ||
                    !connection ||
                    workerLabels.length === 0
                  }
                  aria-busy={feedback.isPending || undefined}
                >
                  {feedback.isPending ? (
                    <>
                      <Loader className="h-4 w-4 animate-spin" aria-hidden />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="h-4 w-4" aria-hidden />
                      Submit for Retraining
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  className="w-full gap-2"
                  onClick={() => setCurrentView('result')}
                  disabled={feedback.isPending}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Back to Result
                </Button>

                <p className="text-muted-foreground text-center text-xs">
                  The masked segment will be uploaded to Geti with your
                  corrected label to refine model weights in the next cycle.
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
