// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Sparkles, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useGetiHealth } from './hooks'
import type { Service } from '@/services/types'

export function GetiClassifierDemo({ service }: { service: Service }) {
  const isOnline = service.status === 'online'
  const healthQuery = useGetiHealth(isOnline)

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16">
      <div className="from-primary/20 to-secondary/10 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br">
        <Sparkles className="text-primary h-8 w-8" />
      </div>

      <div className="text-center">
        <h2 className="text-foreground text-xl font-semibold">
          Geti Image Classifier
        </h2>
        <p className="text-muted-foreground mt-2 max-w-md text-sm">
          Classify images using a local Intel Geti deployment and send feedback
          for continuous model improvement.
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        {healthQuery.isLoading ? (
          <>
            <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            <span className="text-muted-foreground">Checking service…</span>
          </>
        ) : healthQuery.data?.status === 'ok' ? (
          <>
            <CheckCircle2 className="text-success h-4 w-4" />
            <span className="text-success">Service healthy</span>
          </>
        ) : (
          <>
            <XCircle className="text-destructive h-4 w-4" />
            <span className="text-destructive">Service unavailable</span>
          </>
        )}
      </div>

      <Button asChild className="bg-primary hover:bg-primary-light gap-2">
        <Link href="/samples/geti-classifier/demo">Open Full Demo</Link>
      </Button>
    </div>
  )
}
