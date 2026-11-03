// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, ImageOff, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { InlineNotice } from '@/components/common/inline-notice'
import { RefImage } from '@/components/common/ref-media'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/errors'
import { toastError } from '@/lib/browser/toast-error'
import { cn } from '@/lib/utils'
import {
  type AvatarSkin,
  useAvatarList,
  useDeleteSkin,
  useSetDefaultSkin,
} from '../hooks'

const skinName = (skin: AvatarSkin) => skin.skin_name || skin.skin_id

/** One skin: its preview, and Use / Delete unless it is the active one. */
function SkinCard({
  skin,
  apiBase,
  isActive,
  disabled,
  onUse,
  onDelete,
}: {
  skin: AvatarSkin
  apiBase: string | undefined
  isActive: boolean
  disabled: boolean
  onUse: () => void
  onDelete: () => void
}) {
  const [previewBroken, setPreviewBroken] = useState(false)
  const displayName = skinName(skin)

  return (
    <div
      className={cn(
        'bg-muted/20 overflow-hidden rounded-lg border transition-colors',
        isActive
          ? 'border-primary ring-primary/40 ring-1'
          : 'border-border hover:border-primary/40',
      )}
    >
      <div className="bg-muted relative aspect-[3/4]">
        {previewBroken ? (
          <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-1">
            <ImageOff aria-hidden="true" className="h-6 w-6" />
            <span className="text-xs">No preview</span>
          </div>
        ) : (
          <RefImage
            src={`${apiBase}/v1/avatar/${encodeURIComponent(skin.skin_id)}/preview`}
            alt={`Preview of skin ${displayName}`}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setPreviewBroken(true)}
          />
        )}
        {isActive && (
          <Badge className="absolute top-1.5 left-1.5 gap-1 text-xs shadow-sm">
            <Check aria-hidden="true" className="h-3 w-3" />
            Active
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1 p-1.5">
        <TruncatedText
          text={displayName}
          className="text-foreground text-xs font-medium"
        />
        {!isActive && (
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={onUse}
              disabled={disabled}
              aria-label={`Use skin ${displayName}`}
            >
              Use
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive h-8 w-8"
              aria-label={`Delete skin ${displayName}`}
              onClick={onDelete}
              disabled={disabled}
            >
              <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/** The instance's avatar skins: which one is active, switch to or delete one. */
export function SkinGrid({ apiBase }: { apiBase: string | undefined }) {
  const avatarList = useAvatarList(apiBase)
  const setDefaultSkin = useSetDefaultSkin(apiBase)
  const { mutateAsync: deleteSkin, isPending: isDeleting } =
    useDeleteSkin(apiBase)
  const [skinToDelete, setSkinToDelete] = useState<AvatarSkin | null>(null)

  const skins = avatarList.data?.items ?? []
  const defaultSkinId = avatarList.data?.default_skin ?? null
  const mutationPending = setDefaultSkin.isPending || isDeleting

  const handleUse = (skinId: string) => {
    setDefaultSkin.mutate(skinId, {
      onSuccess: (data) =>
        toast.success(
          data.reloaded_sessions?.length
            ? 'Avatar skin updated and applied to the live stream.'
            : 'Avatar skin updated.',
        ),
      onError: toastError('Failed to set skin'),
    })
  }

  const handleDelete = async () => {
    if (!skinToDelete) return
    await deleteSkin(skinToDelete.skin_id)
    toast.success('Skin deleted')
  }

  if (avatarList.isError && skins.length === 0) {
    return (
      <InlineNotice tone="destructive" size="sm">
        Could not load the avatar skins:{' '}
        {getErrorMessage(avatarList.error, 'the worker did not answer')}.{' '}
        <Button
          variant="link"
          size="xs"
          className="h-auto p-0"
          onClick={() => void avatarList.refetch()}
          disabled={avatarList.isFetching}
        >
          <RefreshCw aria-hidden="true" />
          Retry
        </Button>
      </InlineNotice>
    )
  }

  if (skins.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium">
        Available Skins ({skins.length})
      </p>
      <div className="max-h-[320px] overflow-y-auto pr-1">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {skins.map((skin) => (
            <li key={skin.skin_id}>
              <SkinCard
                skin={skin}
                apiBase={apiBase}
                isActive={skin.skin_id === defaultSkinId}
                disabled={mutationPending}
                onUse={() => handleUse(skin.skin_id)}
                onDelete={() => setSkinToDelete(skin)}
              />
            </li>
          ))}
        </ul>
      </div>

      <ConfirmDialog
        open={skinToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setSkinToDelete(null)
        }}
        variant="destructive"
        title="Delete skin?"
        description={
          <>
            This will permanently delete the skin{' '}
            <span className="text-foreground font-medium">
              {skinToDelete ? skinName(skinToDelete) : ''}
            </span>
            . This action cannot be undone.
          </>
        }
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        onConfirm={handleDelete}
      />
    </div>
  )
}
