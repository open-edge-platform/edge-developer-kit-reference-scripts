// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRestartPipeline } from '../hooks/use-restart-pipeline'

export function RestartPipelineButton() {
  const { mutate: restart, isPending } = useRestartPipeline()

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => restart()}
    >
      {isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RotateCw className="mr-2 h-4 w-4" />
      )}
      Reopen Display Window
    </Button>
  )
}
