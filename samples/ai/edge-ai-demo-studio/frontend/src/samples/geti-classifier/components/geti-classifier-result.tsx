// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  BadgeCheck,
  CheckCircle2,
  Cpu,
  Loader,
  RotateCcw,
  Scissors,
  XCircle,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { TONES } from '@/components/common/tones'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useServiceApiBase } from '@/context/service-status-context'
import { useFeedback } from '../hooks/use-geti-api'
import type { GetiConnection } from '../lib/api'
import type { AppView, ClassificationResult } from '../lib/classification'
import { formatModel } from '../lib/format'
import {
  FeedbackSuccess,
  labelTone,
  ResultImages,
  SegmentInfo,
} from './result-parts'
import { SettingsRequiredNotice } from './settings-required-notice'

interface GetiClassifierResultProps {
  result: ClassificationResult
  /** The Geti server feedback goes to, once connected. */
  connection: GetiConnection | null
  workerLabels: string[]
  setCurrentView: (view: AppView) => void
}

const SECTION_TITLE_CLASS =
  'text-muted-foreground text-sm font-medium tracking-wider uppercase'

/** A classification: the images, the prediction, the pipeline, and feedback. */
export function GetiClassifierResult({
  result,
  connection,
  workerLabels,
  setCurrentView,
}: GetiClassifierResultProps) {
  const apiBase = useServiceApiBase('geti-classifier')
  const feedback = useFeedback(apiBase)

  const confirmCorrect = () => {
    if (!connection) return
    feedback.mutate({
      connection,
      imageId: result.imageId,
      labelName: result.predictedLabel,
      isCorrect: true,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BadgeCheck className="text-primary h-5 w-5" aria-hidden />
          <h2 className="text-lg font-semibold">Classification Result</h2>
          <Badge variant="secondary" className="text-xs">
            {result.id}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground gap-2"
          onClick={() => setCurrentView('upload')}
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          New Image
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ResultImages result={result} layout="cards" />

        <div className="space-y-4">
          <InfoCard title="Prediction">
            <div className="flex items-center justify-between">
              <Badge
                tone={labelTone(result.predictedLabel, workerLabels)}
                className="px-3 py-1 text-sm capitalize"
              >
                {result.predictedLabel}
              </Badge>
              <span className="text-primary text-2xl font-bold">
                {result.confidenceScore}%
              </span>
            </div>
            <ul className="space-y-2.5 pt-1" aria-label="All predictions">
              {result.allPredictions.map((pred) => (
                <li key={pred.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium capitalize">{pred.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {pred.confidence}%
                    </span>
                  </div>
                  <Progress
                    value={pred.confidence}
                    aria-label={`${pred.label} confidence`}
                    indicatorClassName={
                      TONES[labelTone(pred.label, workerLabels)].dot
                    }
                  />
                </li>
              ))}
            </ul>
          </InfoCard>

          <InfoCard title="Segment Info">
            <SegmentInfo segmentation={result.segmentation} />
          </InfoCard>

          <InfoCard title="Pipeline Info">
            <dl className="space-y-2">
              <PipelineRow
                icon={<Scissors className="h-3.5 w-3.5" aria-hidden />}
                label="SEG model"
                value={formatModel(result.segModelName, result.segModelVersion)}
              />
              <PipelineRow
                icon={<BadgeCheck className="h-3.5 w-3.5" aria-hidden />}
                label="CLS model"
                value={formatModel(result.clsModelName, result.clsModelVersion)}
              />
              <PipelineRow
                icon={<Cpu className="h-3.5 w-3.5" aria-hidden />}
                label="SEG device"
                value={result.segDevice}
              />
              <PipelineRow
                icon={<Cpu className="h-3.5 w-3.5" aria-hidden />}
                label="CLS device"
                value={result.clsDevice}
              />
            </dl>
          </InfoCard>
        </div>

        <Card className="h-full">
          <CardHeader className="px-4 pt-4 pb-2">
            <CardTitle className={SECTION_TITLE_CLASS}>Feedback</CardTitle>
            <CardDescription>
              Is this classification correct? Your feedback improves the next
              training cycle.
            </CardDescription>
          </CardHeader>

          <CardContent className="px-4 pb-4">
            {feedback.isSuccess ? (
              <FeedbackSuccess
                title="Feedback submitted!"
                onNext={() => setCurrentView('upload')}
              >
                <p className="text-muted-foreground text-sm">
                  Sent to Geti for model enhancement
                </p>
              </FeedbackSuccess>
            ) : (
              <div className="space-y-4">
                {!connection && (
                  <SettingsRequiredNotice
                    onOpenSettings={() => setCurrentView('settings')}
                  >
                    {(settingsLink) => (
                      <>Configure Geti in {settingsLink} to send feedback.</>
                    )}
                  </SettingsRequiredNotice>
                )}

                {feedback.isError && (
                  <InlineNotice tone="destructive" size="sm">
                    {feedback.error.message}
                  </InlineNotice>
                )}

                <div className="bg-muted/20 space-y-1 rounded-lg border p-4 text-center">
                  <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    Predicted as
                  </p>
                  <p className="text-xl font-bold capitalize">
                    {result.predictedLabel}
                  </p>
                  <p className="text-primary text-sm font-semibold">
                    {result.confidenceScore}% confidence
                  </p>
                </div>

                <Button
                  className="h-12 w-full gap-2"
                  onClick={confirmCorrect}
                  disabled={feedback.isPending || !connection}
                  aria-busy={feedback.isPending || undefined}
                >
                  {feedback.isPending ? (
                    <>
                      <Loader className="h-4 w-4 animate-spin" aria-hidden />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      Confirm Correct
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  className="h-12 w-full gap-2"
                  onClick={() => setCurrentView('refine')}
                  disabled={feedback.isPending}
                >
                  <XCircle className="h-4 w-4" aria-hidden />
                  Report Incorrect
                </Button>

                <p className="text-muted-foreground text-center text-xs">
                  Confirming uploads the masked image to Geti with the predicted
                  label. Reporting incorrect lets you pick the label.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-2">
        <CardTitle className={SECTION_TITLE_CLASS}>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4">{children}</CardContent>
    </Card>
  )
}

function PipelineRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="bg-muted/30 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
      <dt className="text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </dt>
      <dd className="max-w-[140px] truncate text-right font-semibold">
        {value}
      </dd>
    </div>
  )
}
