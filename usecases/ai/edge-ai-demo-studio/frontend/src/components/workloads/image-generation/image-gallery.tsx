// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Download } from 'lucide-react'
import Image from 'next/image'

interface ImageGalleryProps {
  images: string[]
  title: string
  description: string
  onDownload: (imageData: string, index: number) => void
  onDownloadAll?: () => void
}

export function ImageGallery({
  images,
  title,
  description,
  onDownload,
  onDownloadAll,
}: ImageGalleryProps) {
  if (images.length === 0) return null

  return (
    <Card data-testid="imggen-gallery">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {images.length > 1 && onDownloadAll && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDownloadAll}
              className="flex items-center gap-2 bg-transparent"
            >
              <Download className="h-4 w-4" />
              Download All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((imageData, index) => (
            <div
              key={index}
              className="group bg-muted/50 relative overflow-hidden rounded-lg border"
            >
              <Image
                src={new URL(imageData).href}
                alt="Generated Output"
                className="h-auto w-full transition-transform group-hover:scale-105"
                width={512}
                height={512}
                unoptimized
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onDownload(imageData, index)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
