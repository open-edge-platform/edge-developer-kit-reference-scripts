// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ConfigSection } from '@/components/configure/config-section'
import { Button } from '@/components/ui/button'
import { useConfigureDraftHost } from '@/hooks/use-configure-draft'
import { useClearModelCache } from '@/hooks/use-clear-model-cache'
import { useModelCacheSharedWith } from '@/hooks/use-is-model-downloaded'
import type { Service } from '@/services/types'

const listFormat = new Intl.ListFormat('en', {
  style: 'long',
  type: 'conjunction',
})

/**
 * Clears a worker's cached model files so the next start downloads them again. Acts on confirm with
 * the instance stopped; hidden for a new-instance draft, which must not touch its siblings' cache.
 * Per type, so the Overview of a service nobody added offers it too (`inSheet` false).
 */
export function ClearModelCacheSection({
  service,
  inSheet = true,
}: {
  service: Service
  inSheet?: boolean
}) {
  const isDraft = useConfigureDraftHost() !== null
  const { mutate: clearCache, isPending } = useClearModelCache()
  const [confirming, setConfirming] = useState(false)
  // Asked once the dialog opens: the sheet itself never needs it.
  const sharedWith = useModelCacheSharedWith(service.id, confirming)

  if (isDraft) return null

  const isOffline = service.status === 'offline'
  const label = service.label ?? service.name

  return (
    <ConfigSection title="Model cache" data-testid="clear-model-cache-section">
      <p className="text-muted-foreground text-xs">
        Deletes the downloaded model files of {service.name} now, so the next
        start downloads them again. Useful after an interrupted download or when
        your Hugging Face token changed.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-destructive hover:text-destructive w-full gap-2"
        disabled={!isOffline || isPending}
        onClick={() => setConfirming(true)}
        data-testid="clear-model-cache-button"
      >
        {isPending ? (
          <Loader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {isPending ? 'Clearing…' : 'Clear model cache'}
      </Button>
      {!isOffline && (
        <p className="text-muted-foreground text-xs">
          Stop {label} before clearing its model cache.
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        variant="destructive"
        title="Clear model cache now?"
        description={
          <>
            This deletes every downloaded model file of{' '}
            <span className="font-medium">{service.name}</span> right away — the
            files every {service.name} instance shares.
            {sharedWith.length > 0 && (
              <>
                {' '}
                Some of them are shared with {listFormat.format(sharedWith)}, so
                those services download them again too.
              </>
            )}{' '}
            They are downloaded again the next time an instance starts.
            {inSheet && ' Unsaved settings in this sheet are not affected.'}
          </>
        }
        confirmLabel="Clear cache"
        onConfirm={() =>
          clearCache({ type: service.id, serviceName: service.name })
        }
      />
    </ConfigSection>
  )
}
