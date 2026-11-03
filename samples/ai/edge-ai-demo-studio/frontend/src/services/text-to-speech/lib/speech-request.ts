// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { requireApiBase } from '@/lib/browser/api-base'
import { fetchOk } from '@/lib/browser/fetch-json'
import { buildSpeechRequestBody, type SpeechRequestParams } from './tts-models'

/** `POST /v1/audio/speech` with a body shaped per worker; the response is returned unread. */
export async function requestSpeech(
  apiBase: string | undefined,
  model: string,
  params: SpeechRequestParams,
  signal?: AbortSignal,
): Promise<Response> {
  requireApiBase(apiBase, 'Text to Speech')
  return fetchOk(`${apiBase}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSpeechRequestBody(model, params)),
    signal,
  })
}
