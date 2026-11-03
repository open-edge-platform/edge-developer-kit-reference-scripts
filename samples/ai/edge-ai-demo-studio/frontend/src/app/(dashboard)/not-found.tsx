// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ArrowLeft, SearchX, Server } from 'lucide-react'
import Link from 'next/link'
import { EmptyState } from '@/components/common/empty-state'
import { Button } from '@/components/ui/button'

/** Shown for an address the studio does not have, and for `notFound()`. */
export default function NotFound() {
  return (
    <div className="py-12">
      <EmptyState
        icon={SearchX}
        title="This page doesn’t exist"
        description="The address may be mistyped, or the service or sample it points to is not part of this studio."
        tone="primary"
      >
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/">
              <ArrowLeft />
              Back to dashboard
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/services">
              <Server />
              Browse services
            </Link>
          </Button>
        </div>
      </EmptyState>
    </div>
  )
}
