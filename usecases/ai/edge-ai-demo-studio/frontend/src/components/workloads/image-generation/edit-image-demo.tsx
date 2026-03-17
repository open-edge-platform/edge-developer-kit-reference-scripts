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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@radix-ui/react-label'
import { ImageIcon, Loader2, Upload } from 'lucide-react'
import { ImageGallery } from './image-gallery'
import { useRef } from 'react'
import { toast } from 'sonner'
import Image from 'next/image'
import { ProgressCard } from './progress-card'
import {
  ImageEditForm,
  ImageGenerationTaskStatus,
} from '@/types/image-generation'

interface EditImageDemoProps {
  editedImages: string[]
  editForm: ImageEditForm
  imageEditIsPending: boolean
  taskStatus: ImageGenerationTaskStatus | null
  numImages: number
  disabled?: boolean
  handleImageEdit: () => Promise<void>
  downloadImage: (imageData: string, index: number, prefix?: string) => void
  downloadAllImages: (images: string[], prefix?: string, delay?: number) => void
}

export function EditImageDemo({
  editedImages,
  editForm,
  imageEditIsPending,
  taskStatus,
  numImages,
  disabled = false,
  handleImageEdit,
  downloadImage,
  downloadAllImages,
}: EditImageDemoProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      editForm.handleFileUpload(file).catch((error) => {
        toast.error('Error', { description: error.message })
      })
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Edit Existing Image
          </CardTitle>
          <CardDescription>
            Upload an image and describe how you want to modify it
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label className="text-base font-semibold">
              Step 1: Upload Your Image
            </Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || imageEditIsPending}
              className="w-full"
              size="lg"
            >
              <Upload className="mr-2 h-5 w-5" />
              {editForm.formData.sourceImage
                ? 'Change Image'
                : 'Choose Image to Edit'}
            </Button>
            {editForm.formData.sourceImagePreview && (
              <div className="bg-muted/50 flex justify-center rounded-lg border p-4">
                <Image
                  src={editForm.formData.sourceImagePreview}
                  alt="Source for editing"
                  className="h-auto max-w-sm rounded-lg shadow-sm"
                  width={256}
                  height={256}
                  unoptimized
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-prompt" className="text-base font-semibold">
              Step 2: Describe Your Changes
            </Label>
            <Textarea
              id="edit-prompt"
              placeholder="Three astronauts in the jungle, vibrant color palette, live colors, detailed, 8k"
              value={editForm.formData.prompt}
              onChange={(e) => editForm.updateField('prompt', e.target.value)}
              className="min-h-[120px] resize-none text-base"
              disabled={disabled || imageEditIsPending}
            />
          </div>

          <Button
            onClick={handleImageEdit}
            disabled={
              disabled ||
              imageEditIsPending ||
              !editForm.formData.prompt.trim() ||
              !editForm.formData.sourceImage
            }
            className="w-full"
            size="lg"
          >
            {imageEditIsPending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Editing Image...
              </>
            ) : (
              <>
                <ImageIcon className="mr-2 h-5 w-5" />
                Generate{' '}
                {numImages > 1 ? `${numImages} Edited Images` : 'Edited Image'}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {taskStatus && (
        <ProgressCard taskType="generation" taskStatus={taskStatus} />
      )}

      <ImageGallery
        images={editedImages}
        title="Your Edited Images"
        description={`${editedImages.length} ${
          editedImages.length === 1 ? 'result' : 'results'
        }`}
        onDownload={(imageData: string, index: number) =>
          downloadImage(imageData, index, 'edited-image')
        }
        onDownloadAll={() => downloadAllImages(editedImages, 'edited-image')}
      />
    </>
  )
}
