// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader } from 'lucide-react'
import { ImageDropZone } from '@/components/common/image-drop-zone'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DemoLayout } from '@/services/common/demo/components/demo-layout'
import { useDemoRuntime } from '@/services/common/demo/demo-runtime'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useSessionState } from '@/services/common/demo/session-store'
import type { Service } from '@/services/types'
import { getEffectiveModel } from '@/types/service'
import { ImageOutput } from './components/image-output'
import {
  IMAGE_PARAMETERS_LABEL,
  ImageParameters,
} from './components/image-parameters'
import { PromptForm } from './components/prompt-form'
import { demoConfig, serviceConfig } from './config'
import {
  useImageJobLeaveGuard,
  useImageJobState,
  useImageJobs,
} from './hooks/use-image-job'
import { useImageGenParams } from './hooks/use-params'
import { isRunActive } from './lib/image-job'

type ImageTab = 'generate' | 'edit'

function isImageTab(value: string): value is ImageTab {
  return value === 'generate' || value === 'edit'
}

export function ImageGenerationDemo({ service }: { service: Service }) {
  // Drafts, settings and requests are kept per instance for the page visit.
  const stateKey = (name: string) => demoStateKey(service, `imggen:${name}`)
  const { available } = useDemoRuntime()
  const { apiBase } = service

  const [tab, setTab] = useSessionState<ImageTab>(stateKey('tab'), 'generate')
  const [genPrompt, setGenPrompt] = useSessionState(
    stateKey('prompt'),
    demoConfig.defaultInput,
  )
  const [editPrompt, setEditPrompt] = useSessionState(
    stateKey('edit-prompt'),
    '',
  )
  const [negativePrompt, setNegativePrompt] = useSessionState(
    stateKey('negative-prompt'),
    '',
  )
  const [sourceImage, setSourceImage] = useSessionState<File | null>(
    stateKey('source-image'),
    null,
  )

  const model =
    getEffectiveModel(service).name ||
    (serviceConfig.availableModels?.[0]?.value ?? '')

  const isEditMode = tab === 'edit'
  // Per model: a turbo model's few-step defaults must not carry over to
  // another model on the same instance, nor the other way round.
  const { values: imageGenValues, params } = useImageGenParams({
    model,
    showStrength: isEditMode,
    sessionKey: stateKey(`params:${model}`),
  })

  const jobs = useImageJobs(service, apiBase, available)
  const generation = useImageJobState(jobs.generate)
  const edit = useImageJobState(jobs.edit)
  const generating = isRunActive(generation.run)
  const editing = isRunActive(edit.run)
  useImageJobLeaveGuard(
    generating || editing,
    generation.run?.phase === 'starting' || edit.run?.phase === 'starting',
  )

  const sharedRequest = () => ({
    model,
    size: imageGenValues.resolution,
    n: 1,
    num_inference_steps: imageGenValues.steps,
    guidance_scale: imageGenValues.cfgScale,
    ...(negativePrompt.trim() && { negative_prompt: negativePrompt.trim() }),
  })

  const handleGenerate = () => {
    if (!apiBase || !available) return
    jobs.generate.submit(apiBase, {
      ...sharedRequest(),
      prompt: genPrompt.trim(),
    })
  }

  const handleEdit = () => {
    if (!apiBase || !available || !sourceImage) return
    jobs.edit.submit(apiBase, {
      ...sharedRequest(),
      prompt: editPrompt.trim(),
      image: sourceImage,
      strength: imageGenValues.strength,
    })
  }

  const reconnect = (kind: ImageTab) => {
    if (apiBase) jobs[kind].reconnect(apiBase)
  }

  return (
    <DemoLayout
      sidebar={<ImageParameters params={params} model={model} />}
      parametersLabel={IMAGE_PARAMETERS_LABEL}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (isImageTab(value)) setTab(value)
        }}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="generate" className="gap-1.5">
            Generate Image
            {generating && (
              <Loader aria-hidden="true" className="h-3 w-3 animate-spin" />
            )}
          </TabsTrigger>
          <TabsTrigger value="edit" className="gap-1.5">
            Edit Image
            {editing && (
              <Loader aria-hidden="true" className="h-3 w-3 animate-spin" />
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="mt-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <PromptForm
              id="imggen-generate"
              promptLabel="Prompt"
              prompt={genPrompt}
              onPromptChange={setGenPrompt}
              promptPlaceholder={demoConfig.inputPlaceholder}
              promptRows={5}
              promptTestId="imggen-prompt"
              negativePrompt={negativePrompt}
              onNegativePromptChange={setNegativePrompt}
              submitLabel="Generate image"
              pendingLabel="Generating…"
              pending={generating}
              canSubmit={available && Boolean(genPrompt.trim())}
              onSubmit={handleGenerate}
              submitTestId="imggen-generate-button"
            />

            <ImageOutput
              state={generation}
              label="Generated image"
              noun="Generation"
              verb="Generating"
              onCancel={() => jobs.generate.cancel()}
              onReconnect={() => reconnect('generate')}
              available={available}
              data-testid="imggen-gallery"
            />
          </div>
        </TabsContent>

        <TabsContent value="edit" className="mt-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <PromptForm
              id="imggen-edit"
              promptLabel="Edit prompt"
              prompt={editPrompt}
              onPromptChange={setEditPrompt}
              promptPlaceholder="Describe how you want to change the image…"
              promptRows={4}
              negativePrompt={negativePrompt}
              onNegativePromptChange={setNegativePrompt}
              submitLabel="Edit image"
              pendingLabel="Editing…"
              pending={editing}
              canSubmit={
                available && Boolean(editPrompt.trim()) && sourceImage !== null
              }
              onSubmit={handleEdit}
              submitTestId="imggen-edit-button"
            >
              <h3 className="text-foreground text-sm font-medium">
                Source image
              </h3>
              <ImageDropZone
                file={sourceImage}
                onFileChange={setSourceImage}
                label="Drop an image to edit"
                compact
                testId="imggen-source-zone"
                inputTestId="imggen-source-input"
              />
            </PromptForm>

            <ImageOutput
              state={edit}
              label="Edited image"
              noun="Edit"
              verb="Editing"
              onCancel={() => jobs.edit.cancel()}
              onReconnect={() => reconnect('edit')}
              available={available}
              data-testid="imggen-edit-gallery"
            />
          </div>
        </TabsContent>
      </Tabs>
    </DemoLayout>
  )
}
