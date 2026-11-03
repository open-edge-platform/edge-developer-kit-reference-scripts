// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ArrowLeft, Loader, RefreshCw, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useTransition } from 'react'
import { EmptyState } from '@/components/common/empty-state'
import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  const [pending, startTransition] = useTransition()
  // The page only says something went wrong; the details go to the console
  // (and, for a server error, the server log under `error.digest`).
  useEffect(() => {
    logger.error('Page failed to render:', error)
  }, [error])
  return (
    <div role="alert" className="py-12">
      <EmptyState
        icon={TriangleAlert}
        title="This page couldn’t load"
        description="Something interrupted the page. Try again, or return to your dashboard."
        tone="warning"
      >
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            onClick={() => startTransition(() => retry())}
            disabled={pending}
          >
            {pending ? <Loader className="animate-spin" /> : <RefreshCw />}
            {pending ? 'Trying again…' : 'Try again'}
          </Button>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft />
              Back to dashboard
            </Link>
          </Button>
        </div>
      </EmptyState>
    </div>
  )
}
