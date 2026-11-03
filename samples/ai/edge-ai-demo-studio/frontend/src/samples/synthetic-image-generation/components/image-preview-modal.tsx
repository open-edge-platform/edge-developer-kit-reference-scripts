// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { X } from 'lucide-react'
import NextImage from 'next/image'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { GenerationType } from '../lib/api'
import type { GeneratedImage } from '../lib/types'
import { imageFileName } from './image-card'
import { TypeBadge } from './type-badge'

interface ImagePreviewModalProps {
  image: GeneratedImage
  onClose: () => void
}

export function ImagePreviewModal({ image, onClose }: ImagePreviewModalProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-full max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-4 border-0 bg-black/95 p-4 shadow-none sm:rounded-none"
      >
        <DialogTitle className="sr-only">Image preview</DialogTitle>
        <DialogClose className="absolute top-6 right-6 z-50 rounded-full border border-white/15 bg-white/10 p-2 text-white/60 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white">
          <X className="h-6 w-6" aria-hidden />
          <span className="sr-only">Close</span>
        </DialogClose>

        <div className="flex h-full w-full max-w-7xl flex-col items-center justify-center gap-4">
          {image.type === GenerationType.MISSING_COMPONENTS && image.maskUrl ? (
            <div className="flex w-full items-start justify-center gap-4">
              <div className="flex flex-1 flex-col items-center gap-2">
                <span className="text-xs font-bold tracking-widest text-white/60 uppercase">
                  Bounding Box Mask
                </span>
                <NextImage
                  src={image.maskUrl}
                  className="h-auto max-h-[72vh] w-auto max-w-full rounded-lg border border-white/10 object-contain shadow-2xl"
                  alt="Bounding box mask"
                  height={1024}
                  width={1024}
                  unoptimized
                />
              </div>
              <div className="flex flex-1 flex-col items-center gap-2">
                <span className="text-xs font-bold tracking-widest text-white/60 uppercase">
                  Generated Image
                </span>
                <NextImage
                  src={image.url}
                  className="h-auto max-h-[72vh] w-auto max-w-full rounded-lg border border-white/10 object-contain shadow-2xl"
                  alt="Full preview"
                  height={1024}
                  width={1024}
                  unoptimized
                />
              </div>
            </div>
          ) : (
            <NextImage
              src={image.url}
              className="h-auto max-h-[80vh] w-auto max-w-full rounded-lg border border-white/10 object-contain shadow-2xl"
              alt="Full preview"
              height={1024}
              width={1024}
              unoptimized
            />
          )}

          <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-xs text-white/50">
                ID: {imageFileName(image)}
              </span>
              <div className="flex gap-2">
                <TypeBadge type={image.type} />
                {image.type === GenerationType.CUSTOM &&
                  image.customTypeRaw && (
                    <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-xs font-bold text-white/80 uppercase">
                      {image.customTypeRaw}
                    </span>
                  )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
