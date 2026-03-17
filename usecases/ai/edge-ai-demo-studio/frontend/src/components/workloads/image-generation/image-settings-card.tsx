// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ImageGenerationForm } from '@/types/image-generation'
import { Label } from '@radix-ui/react-label'
import { Settings } from 'lucide-react'

interface ImageSettingsCardProps {
  generationForm: ImageGenerationForm
  imageGenerationIsPending: boolean
  imageEditIsPending: boolean
  disabled?: boolean
}

export function ImageSettingsCard({
  generationForm,
  imageGenerationIsPending,
  imageEditIsPending,
  disabled = false,
}: ImageSettingsCardProps) {
  return (
    <div className="lg:col-span-1">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Image Settings
          </CardTitle>
          <CardDescription>
            Configure image generation parameters. Settings apply to both Create
            and Edit modes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Number of Images */}
          <div>
            <Label
              htmlFor="num-images"
              className="mb-2 block text-sm font-medium"
            >
              Number of Images
            </Label>
            <Input
              id="num-images"
              type="number"
              min="1"
              max="4"
              value={generationForm.formData.numImages}
              onChange={(e) =>
                generationForm.updateField(
                  'numImages',
                  Number.parseInt(e.target.value) || 1,
                )
              }
              disabled={
                disabled || imageGenerationIsPending || imageEditIsPending
              }
            />
          </div>

          {/* Quality Steps */}
          <div>
            <Label htmlFor="steps" className="mb-2 block text-sm font-medium">
              Quality (Steps)
            </Label>
            <Input
              id="steps"
              type="number"
              min="1"
              max="100"
              value={generationForm.formData.steps}
              onChange={(e) =>
                generationForm.updateField(
                  'steps',
                  Number.parseInt(e.target.value) || 50,
                )
              }
              disabled={
                disabled || imageGenerationIsPending || imageEditIsPending
              }
            />
          </div>

          {/* Image Size */}
          <div>
            <Label
              htmlFor="size-mode"
              className="mb-2 block text-sm font-medium"
            >
              Image Size
            </Label>
            <Select
              value={generationForm.formData.sizeMode}
              onValueChange={(value: 'auto' | 'custom') =>
                generationForm.updateField('sizeMode', value)
              }
              disabled={
                disabled || imageGenerationIsPending || imageEditIsPending
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (model default)</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>

            {generationForm.formData.sizeMode === 'custom' && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="custom-width" className="text-xs">
                    Width (px)
                  </Label>
                  <Input
                    id="custom-width"
                    type="number"
                    min="64"
                    max="2048"
                    step="64"
                    value={generationForm.formData.customWidth}
                    onChange={(e) =>
                      generationForm.updateField(
                        'customWidth',
                        Number.parseInt(e.target.value) || 512,
                      )
                    }
                    disabled={
                      disabled || imageGenerationIsPending || imageEditIsPending
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="custom-height" className="text-xs">
                    Height (px)
                  </Label>
                  <Input
                    id="custom-height"
                    type="number"
                    min="64"
                    max="2048"
                    step="64"
                    value={generationForm.formData.customHeight}
                    onChange={(e) =>
                      generationForm.updateField(
                        'customHeight',
                        Number.parseInt(e.target.value) || 512,
                      )
                    }
                    disabled={
                      disabled || imageGenerationIsPending || imageEditIsPending
                    }
                  />
                </div>
              </div>
            )}
          </div>

          {/* Negative Prompt */}
          <div>
            <Label
              htmlFor="negative-prompt"
              className="mb-2 block text-sm font-medium"
            >
              Negative Prompt
            </Label>
            <Textarea
              id="negative-prompt"
              placeholder="blurry, low quality, watermark..."
              value={generationForm.formData.negativePrompt}
              onChange={(e) =>
                generationForm.updateField('negativePrompt', e.target.value)
              }
              className="min-h-[60px] resize-none"
              disabled={
                disabled || imageGenerationIsPending || imageEditIsPending
              }
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Only for models which support negative prompt (SD/SDXL/SD3).
            </p>
          </div>

          {/* Guidance Scale */}
          <div>
            <Label
              htmlFor="guidance-scale"
              className="mb-2 block text-sm font-medium"
            >
              Guidance Scale:
            </Label>
            <Input
              id="guidance-scale"
              type="number"
              min="1"
              max="20"
              step="0.5"
              value={generationForm.formData.guidanceScale}
              onChange={(e) =>
                generationForm.updateField(
                  'guidanceScale',
                  Number.parseFloat(e.target.value) || 7.5,
                )
              }
              disabled={
                disabled || imageGenerationIsPending || imageEditIsPending
              }
            />
            <p className="text-muted-foreground mt-1 text-xs">
              How closely to follow the prompt (7.5 recommended)
            </p>
          </div>

          {/* Random Seed */}
          <div>
            <Label
              htmlFor="rng-seed"
              className="mb-2 block text-sm font-medium"
            >
              Random Seed
            </Label>
            <Input
              id="rng-seed"
              type="number"
              value={generationForm.formData.rngSeed}
              onChange={(e) =>
                generationForm.updateField(
                  'rngSeed',
                  Number.parseInt(e.target.value),
                )
              }
              disabled={
                disabled || imageGenerationIsPending || imageEditIsPending
              }
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Use same seed for reproducible results
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
