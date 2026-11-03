// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertCircle, Check } from 'lucide-react'
import { useState } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import { SheetClose } from '@/components/ui/sheet'
import { useServiceLiveStatus } from '@/context/service-status-context'
import type { ServiceParamGroup } from '@/types/demo-params'
import { StepProgress } from '../common/components/step-progress'
import { SampleParamsSlot } from '../common/sample-params-slot'
import { useSampleWorkspace } from '../common/sample-workspace'
import type { Sample } from '../types'
import { LanguagePair } from './components/language-pair'
import { TranslationConfigPanel } from './components/translation-config-panel'
import { TranslationProgress } from './components/translation-progress'
import { TranslationUpload } from './components/translation-upload'
import {
  usePptTranslatorParams,
  type PptTranslatorParamValues,
} from './hooks/use-params'
import { useTranslationJob } from './hooks/use-translation-job'

type Step = 'upload' | 'translate' | 'download'

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'translate', label: 'Translate' },
  { key: 'download', label: 'Download' },
]

/** Upload → translate → download; languages beside the upload, advanced settings in Parameters. */
export function PptTranslatorDemo({ sample: _sample }: { sample: Sample }) {
  const pptStatus = useServiceLiveStatus('ppt-translator')
  const textGenStatus = useServiceLiveStatus('text-generation')
  const workspace = useSampleWorkspace()
  const servicesReady =
    pptStatus === 'online' && textGenStatus === 'online' && !workspace.suspended

  // The file in the drop zone. The one a job was started with stays with
  // the job (`job.input`), so a failed upload or job can be retried with it.
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const { values, setters } = usePptTranslatorParams()
  const job = useTranslationJob()

  const canRetry = job.input !== null
  const accepted = job.jobId !== null
  const uploadFailed = job.phase === 'failed' && !accepted
  const settingsLocked = accepted || job.phase === 'submitting'
  const step: Step = !accepted
    ? 'upload'
    : job.phase === 'done'
      ? 'download'
      : 'translate'

  const startTranslation = () => {
    if (selectedFile) job.start({ file: selectedFile, params: values })
  }
  const retryWithSameFile = () => job.restart(values)
  const reset = () => {
    setSelectedFile(null)
    job.reset()
  }

  const blockedReason = !servicesReady
    ? workspace.offlineRequired.length > 0
      ? `Waiting for ${workspace.offlineRequired.join(', ')} to be ready.`
      : 'Waiting for the translation services to be ready.'
    : undefined

  const groups: ServiceParamGroup[] = [
    {
      serviceLabel: 'Translation settings',
      serviceId: 'ppt-translator',
      online: true,
      optional: false,
      params: [],
      children: (
        <TranslationConfigPanel
          disabled={settingsLocked}
          values={values}
          availableModels={[values.model]}
          setters={setters}
        />
      ),
    },
    {
      serviceLabel: 'Text Generation',
      serviceId: 'text-generation',
      online: textGenStatus === 'online',
      optional: false,
      offlineMessage: 'Translation runs on the Text Generation service.',
      params: [],
    },
  ]

  return (
    <div className="space-y-4">
      <SampleParamsSlot
        groups={groups}
        chrome={{
          triggerTestId: 'settings-button',
          titleTestId: 'settings-dialog-title',
          title: 'Translation settings',
          description:
            'Context, proper nouns, speaker notes and font sizing for this job. Languages are chosen next to the upload.',
        }}
        footer={
          <SheetClose asChild>
            <Button data-testid="settings-close-button">Done</Button>
          </SheetClose>
        }
      />

      <StepProgress steps={STEPS} current={step} label="Translation steps" />

      {uploadFailed && (
        <div className="space-y-2">
          <InlineNotice
            tone="destructive"
            size="sm"
            icon={<AlertCircle className="text-destructive h-4 w-4 shrink-0" />}
          >
            <span className="font-medium">Upload failed.</span>{' '}
            {job.error?.message} Your file and settings are kept; trying again
            uploads the file again and starts a new job.
          </InlineNotice>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={retryWithSameFile} disabled={!canRetry}>
              Try again
            </Button>
            <Button size="sm" variant="outline" onClick={job.reset}>
              Change settings first
            </Button>
          </div>
        </div>
      )}

      {!accepted ? (
        <section
          aria-labelledby="ppt-upload-heading"
          className="surface-panel space-y-5 rounded-xl p-5"
        >
          <div>
            <h2
              id="ppt-upload-heading"
              className="text-foreground text-lg font-semibold"
            >
              Upload a presentation
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Choose the languages, add a PowerPoint file, then start the
              translation. Formatting, fonts and layout are preserved.
            </p>
          </div>

          <LanguagePair
            values={values}
            setters={setters}
            disabled={settingsLocked}
          />

          <JobSettingsSummary values={values} />

          <TranslationUpload
            file={selectedFile}
            onFileChange={setSelectedFile}
            blockedReason={blockedReason}
            isUploading={job.phase === 'submitting'}
            model={values.model}
            onStart={startTranslation}
          />
        </section>
      ) : (
        <TranslationProgress
          job={job}
          onRetry={retryWithSameFile}
          onReset={reset}
        />
      )}
    </div>
  )
}

/** The settings the next job runs with, as chips under the languages. */
function JobSettingsSummary({ values }: { values: PptTranslatorParamValues }) {
  return (
    <ul
      className="flex flex-wrap items-center gap-2 text-xs"
      aria-label="Job settings"
    >
      <li
        data-testid="language-badge"
        className="bg-secondary text-secondary-foreground rounded-full px-2.5 py-1 font-medium"
      >
        {values.sourceLanguage} → {values.targetLanguage}
      </li>
      {values.preserveProperNouns && (
        <li
          data-testid="preserve-names-badge"
          className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2.5 py-1"
        >
          <Check className="h-3 w-3" aria-hidden />
          Names kept
        </li>
      )}
      {values.presentationContext.trim() && (
        <li
          data-testid="context-provided-badge"
          className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2.5 py-1"
        >
          <Check className="h-3 w-3" aria-hidden />
          Context provided
        </li>
      )}
      <li className="bg-muted text-muted-foreground rounded-full px-2.5 py-1">
        Speaker notes {values.translateSpeakerNotes ? 'included' : 'left as is'}
      </li>
    </ul>
  )
}
