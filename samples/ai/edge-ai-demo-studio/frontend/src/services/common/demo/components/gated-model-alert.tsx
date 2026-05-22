// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CircleAlert } from 'lucide-react'
import Link from 'next/link'
import { useHasHfToken } from '@/hooks/use-has-hf-token'
import type { ModelOption, ModelSource } from '@/types/common'

interface GatedModelAlertProps {
  model: ModelOption | undefined
  source: ModelSource
}

export function GatedModelAlert({ model, source }: GatedModelAlertProps) {
  const hasHfToken = useHasHfToken()

  if (!model?.gated?.length || hasHfToken === undefined) return null

  const isGatedOnSource = model.gated.includes(source)
  if (!isGatedOnSource) return null

  if (source === 'huggingface' && hasHfToken) return null

  return (
    <div className="border-border bg-muted/20 flex items-start gap-3 rounded-xl border p-4">
      <CircleAlert className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
      <div className="text-muted-foreground space-y-1.5 text-sm leading-relaxed">
        {source === 'huggingface' && (
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
      </div>
    </div>
  )
}
