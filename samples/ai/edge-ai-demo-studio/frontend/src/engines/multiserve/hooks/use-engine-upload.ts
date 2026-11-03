// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useRef, useState } from 'react'
import type { BackendId } from '../types'
import { useUploadModel } from './use-models'

interface EngineUploadParams {
  backend: BackendId
  repoId: string
  task: string
  files: File[]
}

/**
 * `useUploadModel` for an engine that may be down: the upload waits for `ensureEngine`, and a
 * cancel during that wait bumps the attempt so the upload never goes out.
 */
export function useEngineUpload(
  engineKey: string,
  {
    engineUp,
    ensureEngine,
  }: {
    engineUp: boolean
    ensureEngine: () => Promise<void>
  },
) {
  const {
    upload: uploadModelFiles,
    cancel: cancelUpload,
    reset,
    progress,
    isPending,
    isSuccess,
    error,
  } = useUploadModel(engineKey)

  const [waitingForEngine, setWaitingForEngine] = useState(false)
  const uploadAttempt = useRef(0)

  const upload = (params: EngineUploadParams, onSuccess: () => void) => {
    const run = () => uploadModelFiles(params, { onSuccess })
    if (engineUp) return run()

    uploadAttempt.current += 1
    const attempt = uploadAttempt.current
    setWaitingForEngine(true)
    ensureEngine()
      .then(
        () => {
          if (uploadAttempt.current === attempt) run()
        },
        () => {},
      )
      .finally(() => {
        if (uploadAttempt.current === attempt) setWaitingForEngine(false)
      })
  }

  const cancel = () => {
    uploadAttempt.current += 1
    setWaitingForEngine(false)
    cancelUpload()
  }

  return {
    upload,
    cancel,
    reset,
    progress,
    isPending,
    isSuccess,
    error,
    waitingForEngine,
  }
}
