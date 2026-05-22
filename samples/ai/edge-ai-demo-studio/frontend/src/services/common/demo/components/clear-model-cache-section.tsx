// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader2, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useClearModelCache } from '@/hooks/use-clear-model-cache'
import type { Service } from '@/services/types'

interface ClearModelCacheSectionProps {
  service: Service
}

/**
 * Reusable section for worker configure panels that lets users clear
 * cached model files so they are re-downloaded on the next service start.
 *
 * Useful when a model download was interrupted (corrupt files) or when
 * the HF_TOKEN was updated and a different/gated model should be fetched.
 *
 * The service must be stopped before clearing the cache.
 */
export function ClearModelCacheSection({
  service,
}: ClearModelCacheSectionProps) {
  const { mutate: clearCache, isPending } = useClearModelCache()

  const isOffline = service.status === 'offline'

  const handleClear = () => {
    if (!service.dbId) return
    clearCache({ serviceId: service.dbId, serviceName: service.name })
  }

  return (
    <div className="space-y-3 px-2">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Model Cache
      </p>
      <p className="text-muted-foreground text-xs">
        Clear downloaded model files to force a fresh re-download on next start.
        Useful if a download was interrupted or your Hugging Face token changed.
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive w-full gap-2"
            disabled={!isOffline || isPending}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {isPending ? 'Clearing…' : 'Clear Model Cache'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear model cache?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all downloaded model files for{' '}
              <span className="font-medium">{service.name}</span>. The models
              will be re-downloaded automatically when the service is started
              again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClear}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              Clear Cache
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {!isOffline && (
        <p className="text-muted-foreground text-[10px]">
          Stop the service before clearing its model cache.
        </p>
      )}
    </div>
  )
}
