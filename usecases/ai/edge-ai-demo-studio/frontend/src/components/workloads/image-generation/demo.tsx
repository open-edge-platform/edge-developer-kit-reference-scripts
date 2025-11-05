// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type React from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useImageGeneration,
  useImageEdit,
  useImageGenerationForm,
  useImageEditForm,
} from '@/hooks/use-image-generation'
import type {
  ImageGenerationRequest,
  ImageEditRequest,
  ImageGenerationResponse,
} from '@/types/image-generation'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { ImageSettingsCard } from './image-settings-card'
import { GenerateImageDemo } from './generate-image-demo'
import { EditImageDemo } from './edit-image-demo'

interface ImageGenerationDemoProps {
  disabled?: boolean
  selectedModel: string
}

const downloadImage = (imageData: string, index: number, prefix = 'image') => {
  const link = document.createElement('a')
  link.href = imageData
  link.download = `${prefix}-${index + 1}.png`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

const downloadAllImages = (images: string[], prefix = 'image', delay = 100) => {
  images.forEach((imageData, index) => {
    setTimeout(() => downloadImage(imageData, index, prefix), index * delay)
  })
}

const processApiResponse = (response: ImageGenerationResponse) => {
  if (!response?.data || response.data.length === 0) {
    return { success: false, images: [], error: 'No data received' }
  }

  const images = response.data
    .filter((item) => item.b64_json)
    .map((item) => `data:image/png;base64,${item.b64_json}`)

  if (images.length === 0) {
    return { success: false, images: [], error: 'No valid images' }
  }

  return { success: true, images, error: null }
}

const showToastMessage = (
  success: boolean,
  count?: number,
  operation = 'generated',
) => {
  if (success && count) {
    toast.success('Success', {
      description: `${operation} ${count} image(s) successfully!`,
    })
  } else if (!success) {
    toast.error('Error', {
      description: `Failed to ${operation.toLowerCase()} images. Please try again.`,
    })
  }
}

export default function ImageGenerationDemo({
  disabled,
  selectedModel,
}: ImageGenerationDemoProps) {
  const generationForm = useImageGenerationForm()
  const editForm = useImageEditForm()

  const [generatedImages, setGeneratedImages] = useState<string[]>([])
  const [editedImages, setEditedImages] = useState<string[]>([])

  const imageGeneration = useImageGeneration()
  const imageEdit = useImageEdit()

  // Handle image generation results
  useEffect(() => {
    if (imageGeneration.result) {
      const result = processApiResponse(imageGeneration.result)
      if (result.success) {
        setGeneratedImages(result.images)
        showToastMessage(true, result.images.length, 'Generated')
      } else {
        showToastMessage(false, 0, 'generate')
      }
    }
    if (imageGeneration.error) {
      showToastMessage(false, 0, 'generate')
    }
  }, [imageGeneration.result, imageGeneration.error])

  // Handle image edit results
  useEffect(() => {
    if (imageEdit.result) {
      const result = processApiResponse(imageEdit.result)
      if (result.success) {
        setEditedImages(result.images)
        showToastMessage(true, result.images.length, 'Edited')
      } else {
        showToastMessage(false, 0, 'edit')
      }
    }
    if (imageEdit.error) {
      showToastMessage(false, 0, 'edit')
    }
  }, [imageEdit.result, imageEdit.error])

  const handleGenerate = async () => {
    // clear previous images
    setGeneratedImages([])

    if (!generationForm.formData.prompt.trim()) {
      toast.error('Error', { description: 'Please enter a prompt' })
      return
    }

    const params: ImageGenerationRequest = {
      model: selectedModel,
      prompt: generationForm.formData.prompt.trim(),
      size: generationForm.getFormattedSize(),
      n: generationForm.formData.numImages,
      num_inference_steps: generationForm.formData.steps,
      guidance_scale: generationForm.formData.guidanceScale,
      ...(generationForm.formData.negativePrompt.trim() && {
        negative_prompt: generationForm.formData.negativePrompt.trim(),
      }),
    }

    try {
      await imageGeneration.mutateAsync(params)
      toast.success('Task Started', {
        description: 'Image generation started. Please wait...',
      })
    } catch (error) {
      console.error('Image generation error:', error)
      showToastMessage(false, 0, 'generate')
    }
  }

  const handleImageEdit = async () => {
    // clear previous images
    setEditedImages([])

    if (!editForm.formData.prompt.trim()) {
      toast.error('Error', {
        description: 'Please enter a prompt for image editing',
      })
      return
    }

    if (!editForm.formData.sourceImage) {
      toast.error('Error', { description: 'Please upload an image to edit' })
      return
    }

    const params: ImageEditRequest = {
      model: selectedModel,
      image: editForm.formData.sourceImage,
      prompt: editForm.formData.prompt.trim(),
      size: generationForm.getFormattedSize(),
      n: generationForm.formData.numImages,
      num_inference_steps: generationForm.formData.steps,
      guidance_scale: generationForm.formData.guidanceScale,
      rng_seed: generationForm.formData.rngSeed,
      ...(generationForm.formData.negativePrompt.trim() && {
        negative_prompt: generationForm.formData.negativePrompt.trim(),
      }),
    }

    try {
      await imageEdit.mutateAsync(params)
      toast.success('Task Started', {
        description: 'Image editing started. Please wait...',
      })
    } catch (error) {
      console.error('Image edit error:', error)
      showToastMessage(false, 0, 'edit')
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Tabs defaultValue="generate" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="generate">Generate Images</TabsTrigger>
            <TabsTrigger value="edit">Edit Images</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-6">
            <GenerateImageDemo
              generatedImages={generatedImages}
              generationForm={generationForm}
              imageGenerationIsPending={imageGeneration.isPending}
              taskStatus={imageGeneration.taskStatus}
              disabled={disabled}
              handleGenerate={handleGenerate}
              downloadImage={downloadImage}
              downloadAllImages={downloadAllImages}
            />
          </TabsContent>

          <TabsContent value="edit" className="space-y-6">
            <EditImageDemo
              editedImages={editedImages}
              editForm={editForm}
              imageEditIsPending={imageEdit.isPending}
              taskStatus={imageEdit.taskStatus}
              numImages={generationForm.formData.numImages}
              disabled={disabled}
              handleImageEdit={handleImageEdit}
              downloadImage={downloadImage}
              downloadAllImages={downloadAllImages}
            />
          </TabsContent>
        </Tabs>
      </div>

      <ImageSettingsCard
        generationForm={generationForm}
        imageGenerationIsPending={imageGeneration.isPending}
        imageEditIsPending={imageEdit.isPending}
        disabled={disabled}
      />
    </div>
  )
}
