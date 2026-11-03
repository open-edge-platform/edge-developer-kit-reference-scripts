// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import NextImage from 'next/image'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Download, Printer } from 'lucide-react'
import { printOverlay } from '@/samples/ai-exam-marking/lib/image-utils'

export interface PreviewEntry {
  image: string
  label: string
  overlay?: string
}

interface ImagePreviewDialogProps {
  entry: PreviewEntry | null
  onClose: () => void
  onDownload: (image: string) => void
}

export function ImagePreviewDialog({
  entry,
  onClose,
  onDownload,
}: ImagePreviewDialogProps) {
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{entry?.label}</DialogTitle>
        </DialogHeader>
        {entry && (
          <div className="space-y-4">
            <div className="max-h-[70vh] overflow-auto rounded-lg border">
              <NextImage
                src={entry.image}
                alt={entry.label}
                width={1200}
                height={1600}
                unoptimized
                className="h-auto w-full object-contain"
              />
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1 text-xs"
                disabled={!entry.overlay}
                onClick={() => {
                  if (!entry.overlay) return
                  printOverlay(entry.label, entry.overlay)
                }}
              >
                <Printer className="mr-2 h-4 w-4" />
                Print Overlay
              </Button>
              <Button
                variant="outline"
                className="flex-1 text-xs"
                onClick={() => onDownload(entry.image)}
              >
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
