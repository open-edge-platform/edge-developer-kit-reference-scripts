// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CircleAlert } from 'lucide-react'
import Link from 'next/link'
import { useHasHfToken } from '@/hooks/use-has-hf-token'
import { useIsModelDownloaded } from '@/hooks/use-is-model-downloaded'
import type { ModelOption, ModelSource } from '@/types/common'

interface GatedModelAlertProps {
  model: ModelOption | undefined
  source: ModelSource
  serviceId?: number
}

export function GatedModelAlert({
  model,
  source,
  serviceId,
}: GatedModelAlertProps) {
  const hasHfToken = useHasHfToken()

  const isGatedOnSource = Boolean(model?.gated?.includes(source))
  const isDownloaded = useIsModelDownloaded(
    serviceId,
    isGatedOnSource && source === 'huggingface' && hasHfToken === true,
  )

  if (!model?.gated?.length || hasHfToken === undefined) return null
  if (!isGatedOnSource) return null

  const missingToken = source === 'huggingface' && !hasHfToken
  const notYetDownloaded =
    source === 'huggingface' && hasHfToken && isDownloaded === false

  // Token present and either the model is already downloaded, or its download
  // status hasn't resolved yet — hide the alert to avoid a flash of content.
  if (source === 'huggingface' && !missingToken && !notYetDownloaded) {
    return null
  }

  return (
    <div className="border-border bg-muted/20 flex items-start gap-3 rounded-xl border p-4">
      <CircleAlert className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-muted-foreground space-y-1.5 text-sm leading-relaxed">
        {source === 'huggingface' && missingToken && (
          <>
            <p>
              <strong className="text-foreground">{model.label}</strong> is a
              gated model on Hugging Face. A{' '}
              <code className="bg-muted text-foreground rounded px-1 font-mono text-xs">
                HF_TOKEN
              </code>{' '}
              is required to download it. Go to{' '}
              <Link
                href="/settings"
                className="text-primary font-medium underline"
              >
                Settings
              </Link>{' '}
              to configure your token, then restart the service.
            </p>
            <p>
              You must also accept the model license on its{' '}
              <a
                href={`https://huggingface.co/${model.value}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline"
              >
                Hugging Face page
              </a>
              .
            </p>
          </>
        )}
        {source === 'huggingface' && notYetDownloaded && (
          <>
            <p>
              <strong className="text-foreground">{model.label}</strong> is a
              gated model on Hugging Face and does not appear to be downloaded
              yet. Your{' '}
              <code className="bg-muted text-foreground rounded px-1 font-mono text-xs">
                HF_TOKEN
              </code>{' '}
              may not have access to it.
            </p>
            <p>
              Verify that your account has been granted access and that
              you&apos;ve accepted the license on its{' '}
              <a
                href={`https://huggingface.co/${model.value}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline"
              >
                Hugging Face page
              </a>
              , then restart the service.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
