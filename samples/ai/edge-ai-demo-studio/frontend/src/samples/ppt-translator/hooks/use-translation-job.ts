// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { fetchJson } from '@/lib/browser/fetch-json'
import { cancelJob } from '@/lib/browser/sse'
import { jobFailure } from '@/services/common/jobs/job-run'
import { useJobRun } from '@/services/common/jobs/use-job-run'
import { toSafeJobId } from '../lib/job-id'
import type { PptTranslatorParamValues } from './use-params'

/** The sample's own routes, which forward to the translation worker. */
const TRANSLATOR_API = '/api/samples/ppt-translator'

/** A translation job's status, as `GET /status/<id>/events` sends it. */
export interface TranslationJob {
  job_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  progress: number
  message: string
  created_at: string
  completed_at?: string
  output_file?: string
  error?: string
  /** Set once a stop is asked; a running job reports `cancelled` only at its next batch. */
  cancel_requested?: boolean
}

export interface TranslatePayload {
  file: File
  params: PptTranslatorParamValues
}

/** What survives a reload once the file is gone: enough to say what is being translated. */
export interface SavedTranslation {
  fileName: string
  params: PptTranslatorParamValues
}

/** The job's status path: `DELETE` on it cancels the job. */
function statusUrl(jobId: string): string {
  return `${TRANSLATOR_API}/status/${toSafeJobId(jobId)}`
}

/** Uploads the deck with its settings; resolves with the new job's id. */
async function submitTranslation(
  { file, params }: TranslatePayload,
  signal: AbortSignal,
): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('source_language', params.sourceLanguage)
  formData.append('target_language', params.targetLanguage)
  formData.append('preserve_proper_nouns', String(params.preserveProperNouns))
  formData.append(
    'translate_speaker_notes',
    String(params.translateSpeakerNotes),
  )
  formData.append('auto_adjust_font_size', String(params.autoAdjustFontSize))
  formData.append('presentation_context', params.presentationContext)
  formData.append('model', params.model)

  const accepted = await fetchJson<{ job_id: string }>(
    `${TRANSLATOR_API}/translate`,
    { method: 'POST', body: formData, signal, errorMessage: 'Upload failed' },
  )
  return accepted.job_id
}

/**
 * One translation at a time: upload, then follow its status events. The worker keeps jobs until it
 * restarts, so the job is kept (`keep`): it runs on when the demo is left and is followed again on
 * return or reload. A newer job or Translate another file cancels it.
 */
export function useTranslationJob() {
  const job = useJobRun<
    TranslatePayload,
    TranslationJob,
    TranslationJob,
    SavedTranslation
  >(
    {
      submit: submitTranslation,
      jobUrl: statusUrl,
      followErrorMessage: 'Lost track of the translation job',
      toResult: (status) => {
        if (status.status !== 'completed') {
          throw jobFailure(status, 'The translation did not finish.')
        }
        return status
      },
    },
    {
      // The sample's proxy reaches one translator, whichever instance.
      keep: {
        key: 'sample:ppt-translator',
        save: ({ file, params }) => ({ fileName: file.name, params }),
      },
      leaveGuardNoun: 'translation',
    },
  )
  return {
    ...job,
    /**
     * Translates the last file again as a new job, cancelling the previous one first (one whose
     * status was lost may still be running). Not possible after a reload: `input` is `null`.
     */
    restart: (params: PptTranslatorParamValues) => {
      if (!job.input) return
      if (job.jobId) cancelJob(statusUrl(job.jobId))
      job.start({ file: job.input.file, params })
    },
  }
}

export type TranslationJobRun = ReturnType<typeof useTranslationJob>
