// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ExternalLink, Rocket, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DemoErrorBoundary } from '@/components/common/demo-error-boundary'
import { EmptyState } from '@/components/common/empty-state'
import type { Sample } from '@/samples/types'

export function SampleDemo({ sample }: { sample: Sample }) {
  const { demo } = sample

  if (demo.type === 'component' && demo.component) {
    const DemoComponent = demo.component
    return (
      <DemoErrorBoundary>
        <DemoComponent sample={sample} />
      </DemoErrorBoundary>
    )
  }

  if (demo.type === 'external' && demo.externalUrl) {
    return (
      <EmptyState
        icon={Rocket}
        tone="primary"
        title={demo.externalLabel ?? 'Open Demo UI'}
        description={
          demo.externalDescription ??
          'This sample opens in a separate interface. Click below to launch it.'
        }
      >
        <Button asChild size="lg" className="mt-6 gap-2">
          <a href={demo.externalUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" aria-hidden />
            {demo.externalLabel ?? 'Open Demo'}
          </a>
        </Button>
        <p className="text-muted-foreground mt-3 text-xs">
          Opens at{' '}
          <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
            {demo.externalUrl}
          </code>
        </p>
      </EmptyState>
    )
  }

  return (
    <EmptyState
      icon={Zap}
      size="sm"
      description="Demo not available for this sample."
    />
  )
}
