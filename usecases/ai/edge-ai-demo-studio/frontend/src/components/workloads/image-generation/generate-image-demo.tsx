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
import { ImageIcon, Loader2 } from 'lucide-react'
import { ImageGallery } from './image-gallery'
import { ImageGenerationForm, TaskStatus } from '@/hooks/use-image-generation'
import { ProgressCard } from './progress-card'

interface GenerateImageDemoProps {
  generatedImages: string[]
  generationForm: ImageGenerationForm
  imageGenerationIsPending: boolean
  taskStatus: TaskStatus | null
  disabled?: boolean
  handleGenerate: () => Promise<void>
  downloadImage: (imageData: string, index: number, prefix?: string) => void
  downloadAllImages: (images: string[], prefix?: string, delay?: number) => void
}

export function GenerateImageDemo({
  generatedImages,
  generationForm,
  imageGenerationIsPending,
  taskStatus,
  disabled = false,
  handleGenerate,
  downloadImage,
  downloadAllImages,
}: GenerateImageDemoProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            Create New Image
          </CardTitle>
          <CardDescription>
            Describe what you want to see and let AI generate it
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="prompt" className="text-base font-semibold">
              What do you want to create?
            </Label>
            <Textarea
              id="prompt"
              placeholder="Three astronauts on the moon, cold color palette, muted colors, detailed, 8k"
              value={generationForm.formData.prompt}
              onChange={(e) =>
                generationForm.updateField('prompt', e.target.value)
              }
              className="min-h-[120px] resize-none text-base"
              disabled={disabled || imageGenerationIsPending}
            />
          </div>

          <Button
            onClick={handleGenerate}
            disabled={
              disabled ||
              imageGenerationIsPending ||
              !generationForm.formData.prompt.trim()
            }
            className="w-full"
            size="lg"
          >
            {imageGenerationIsPending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Generating Images...
              </>
            ) : (
              <>
                <ImageIcon className="mr-2 h-5 w-5" />
                Generate{' '}
                {generationForm.formData.numImages > 1
                  ? `${generationForm.formData.numImages} Images`
                  : 'Image'}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {taskStatus && (
        <ProgressCard taskType="generation" taskStatus={taskStatus} />
      )}

      <ImageGallery
        images={generatedImages}
        title="Your Generated Images"
        description={`${generatedImages.length} ${
          generatedImages.length === 1 ? 'image' : 'images'
        } created`}
        onDownload={(imageData: string, index: number) =>
          downloadImage(imageData, index, 'generated-image')
        }
        onDownloadAll={() =>
          downloadAllImages(generatedImages, 'generated-image')
        }
      />
    </>
  )
}
