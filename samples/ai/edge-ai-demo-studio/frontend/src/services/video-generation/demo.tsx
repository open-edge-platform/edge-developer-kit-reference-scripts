// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { ImageDropZone } from '@/components/common/image-drop-zone'
import { VideoFilePicker } from '@/components/common/video-file-picker'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DemoLayout } from '@/services/common/demo/components/demo-layout'
import { useDemoRuntime } from '@/services/common/demo/demo-runtime'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useSessionState } from '@/services/common/demo/session-store'
import { PromptForm } from '@/services/image-generation/components/prompt-form'
import type { Service } from '@/services/types'
import { getEffectiveModel } from '@/types/service'
import {
  VIDEO_PARAMETERS_LABEL,
  VideoParameters,
} from './components/video-parameters'
import { VideoOutput } from './components/video-output'
import { DEFAULT_VIDEO_MODEL, demoConfig, sizeForOrientation } from './config'
import {
  useVideoJob,
  useVideoJobLeaveGuard,
  useVideoJobState,
} from './hooks/use-video-job'
import { useVideoGenParams } from './hooks/use-params'
import { isRunActive } from './lib/video-job'

type VideoTab = 'text' | 'image' | 'pose'

function isVideoTab(value: string): value is VideoTab {
  return value === 'text' || value === 'image' || value === 'pose'
}

export function VideoGenerationDemo({ service }: { service: Service }) {
  // Drafts and settings are kept per instance for the page visit.
  const stateKey = (name: string) => demoStateKey(service, `videogen:${name}`)
  const { available } = useDemoRuntime()
  const { apiBase } = service

  const model = getEffectiveModel(service).name || DEFAULT_VIDEO_MODEL
  const { values, params, spec, setSize } = useVideoGenParams({
    model,
    sessionKey: stateKey(`params:${model}`),
  })

  const [prompt, setPrompt] = useSessionState(
    stateKey('prompt'),
    demoConfig.defaultInput,
  )
  const [imagePrompt, setImagePrompt] = useSessionState(
    stateKey('image-prompt'),
    '',
  )
  const [negativePrompt, setNegativePrompt] = useSessionState(
    stateKey('negative-prompt'),
    '',
  )
  const [startImage, setStartImage] = useSessionState<File | null>(
    stateKey('start-image'),
    null,
  )
  const [posePrompt, setPosePrompt] = useSessionState(
    stateKey('pose-prompt'),
    '',
  )
  const [drivingVideo, setDrivingVideo] = useSessionState<File | null>(
    stateKey('driving-video'),
    null,
  )
  const [subjectImage, setSubjectImage] = useSessionState<File | null>(
    stateKey('subject-image'),
    null,
  )
  // A new driving video turns the resolution to its orientation (it is fitted inside the frame,
  // never cropped, so a portrait dancer in a landscape frame would fill a third of it).
  const pickDrivingVideo = (file: File | null) => {
    setDrivingVideo(file)
    if (!file) return
    const probe = document.createElement('video')
    const url = URL.createObjectURL(file)
    const done = () => {
      URL.revokeObjectURL(url)
      probe.removeAttribute('src')
    }
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => {
      if (probe.videoWidth && probe.videoHeight)
        setSize(
          sizeForOrientation(
            spec,
            values.size,
            probe.videoWidth,
            probe.videoHeight,
          ),
        )
      done()
    }
    probe.onerror = done
    probe.src = url
  }
  // The tabs the model has, its own kind first: a pose model opens on Pose to video. The tab chosen
  // is kept per model.
  const tabs: VideoTab[] = [
    ...(spec.poseToVideo ? (['pose'] as const) : []),
    'text',
    ...(spec.imageToVideo ? (['image'] as const) : []),
  ]
  const [tab, setTab] = useSessionState<VideoTab>(
    stateKey(`tab:${model}`),
    tabs[0],
  )
  const activeTab: VideoTab = tabs.includes(tab) ? tab : tabs[0]

  const job = useVideoJob(service, apiBase, available)
  const state = useVideoJobState(job)
  const generating = isRunActive(state.run)
  useVideoJobLeaveGuard(generating, state.run?.phase === 'starting')

  const submit = (
    text: string,
    image: File | null,
    driving: File | null = null,
  ) => {
    if (!apiBase || !available) return
    job.submit(apiBase, {
      model,
      prompt: text.trim(),
      size: values.size,
      num_frames: values.numFrames,
      num_inference_steps: spec.fixedSteps === null ? values.steps : undefined,
      guidance_scale: values.guidance,
      ...(negativePrompt.trim() && { negative_prompt: negativePrompt.trim() }),
      image,
      drivingVideo: driving,
      preview: values.previews,
    })
  }

  const output = (
    <VideoOutput
      state={state}
      onCancel={() => job.cancel()}
      onReconnect={() => apiBase && job.reconnect(apiBase)}
      available={available}
    />
  )

  return (
    <DemoLayout
      sidebar={
        <VideoParameters
          params={params}
          modelLabel={spec.label}
          numFrames={values.numFrames}
          fps={spec.fps}
        />
      }
      parametersLabel={VIDEO_PARAMETERS_LABEL}
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (isVideoTab(value)) setTab(value)
        }}
        className="w-full"
      >
        <TabsList
          className="grid w-full"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}
        >
          {spec.poseToVideo && (
            <TabsTrigger value="pose" data-testid="videogen-pose-tab">
              Pose to video
            </TabsTrigger>
          )}
          <TabsTrigger value="text">Text to video</TabsTrigger>
          {spec.imageToVideo && (
            <TabsTrigger value="image" data-testid="videogen-image-tab">
              Image to video
            </TabsTrigger>
          )}
        </TabsList>

        {spec.poseToVideo && (
          <TabsContent value="pose" className="mt-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <PromptForm
                id="videogen-pose"
                promptLabel="Prompt"
                promptOptional
                prompt={posePrompt}
                onPromptChange={setPosePrompt}
                promptPlaceholder={demoConfig.posePromptPlaceholder}
                promptRows={4}
                promptTestId="videogen-pose-prompt"
                negativePrompt={negativePrompt}
                onNegativePromptChange={setNegativePrompt}
                negativePromptPlaceholder={demoConfig.negativePlaceholder}
                submitLabel="Generate from poses"
                pendingLabel="Generating…"
                pending={generating}
                canSubmit={available && !generating && drivingVideo !== null}
                onSubmit={() => submit(posePrompt, subjectImage, drivingVideo)}
                submitTestId="videogen-pose-button"
              >
                <h3 className="text-foreground text-sm font-medium">
                  Driving video
                </h3>
                <VideoFilePicker
                  file={drivingVideo}
                  onFileChange={pickDrivingVideo}
                  label="Drop a video of someone moving"
                  formatsHint="MP4, MOV, MKV or WebM. The people's poses are drawn from it, fitted inside the frame; its length (up to the duration set) is the result's."
                  maxSizeMb={200}
                  previewClassName="max-h-48"
                  testId="videogen-driving-zone"
                  inputTestId="videogen-driving-input"
                />
                <h3 className="text-foreground text-sm font-medium">
                  Subject image{' '}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </h3>
                <ImageDropZone
                  file={subjectImage}
                  onFileChange={setSubjectImage}
                  label="Drop who should move: their look, clothes and setting"
                  hint="A full-body picture works best"
                  compact
                  testId="videogen-subject-zone"
                  inputTestId="videogen-subject-input"
                />
              </PromptForm>
              {output}
            </div>
          </TabsContent>
        )}

        <TabsContent value="text" className="mt-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <PromptForm
              id="videogen-text"
              promptLabel="Prompt"
              prompt={prompt}
              onPromptChange={setPrompt}
              promptPlaceholder={demoConfig.inputPlaceholder}
              promptRows={5}
              promptTestId="videogen-prompt"
              negativePrompt={negativePrompt}
              onNegativePromptChange={setNegativePrompt}
              negativePromptPlaceholder={demoConfig.negativePlaceholder}
              submitLabel="Generate video"
              pendingLabel="Generating…"
              pending={generating}
              canSubmit={available && !generating && Boolean(prompt.trim())}
              onSubmit={() => submit(prompt, null)}
              submitTestId="videogen-generate-button"
            />
            {output}
          </div>
        </TabsContent>

        {spec.imageToVideo && (
          <TabsContent value="image" className="mt-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <PromptForm
                id="videogen-image"
                promptLabel="Prompt"
                prompt={imagePrompt}
                onPromptChange={setImagePrompt}
                promptPlaceholder={demoConfig.imagePromptPlaceholder}
                promptRows={4}
                promptTestId="videogen-image-prompt"
                negativePrompt={negativePrompt}
                onNegativePromptChange={setNegativePrompt}
                negativePromptPlaceholder={demoConfig.negativePlaceholder}
                submitLabel="Animate image"
                pendingLabel="Generating…"
                pending={generating}
                canSubmit={
                  available &&
                  !generating &&
                  Boolean(imagePrompt.trim()) &&
                  startImage !== null
                }
                onSubmit={() => submit(imagePrompt, startImage)}
                submitTestId="videogen-animate-button"
              >
                <h3 className="text-foreground text-sm font-medium">
                  Start image
                </h3>
                <ImageDropZone
                  file={startImage}
                  onFileChange={setStartImage}
                  label="Drop the first frame of the video"
                  hint="Cropped to the resolution's shape, keeping the centre"
                  compact
                  testId="videogen-image-zone"
                  inputTestId="videogen-image-input"
                />
              </PromptForm>
              {output}
            </div>
          </TabsContent>
        )}
      </Tabs>
    </DemoLayout>
  )
}
