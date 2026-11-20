// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Film, ImageUpscale, Video } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useSessionState } from '@/services/common/demo/session-store'
import type { Service } from '@/services/types'
import { getEffectiveModel } from '@/types/service'
import { ImageTab } from './components/image-tab'
import { LiveTab } from './components/live-tab'
import { VideoTab } from './components/video-tab'
import { describeUpscalingModel } from './config'

type UpscalingTab = 'image' | 'video' | 'live'

const isTab = (value: string): value is UpscalingTab =>
  value === 'image' || value === 'video' || value === 'live'

export function ImageUpscalingDemo({ service }: { service: Service }) {
  const model = describeUpscalingModel(getEffectiveModel(service).name)
  const [savedTab, setTab] = useSessionState<UpscalingTab>(
    demoStateKey(service, 'image-upscaling:tab'),
    'image',
  )
  // SeedVR2 has no video or live tab; the saved tab comes back with the next model that does.
  const imageOnly = model.imageOnly === true
  const tab = imageOnly ? 'image' : savedTab

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">
        {imageOnly
          ? `Upscale an image with ${model.label}, compared side by side with its input. This model upscales still images only; images are queued and processed one at a time.`
          : `Upscale with ${model.label}: an image, compared side by side with its input; a whole video, frame by frame with its sound kept; or your webcam live. Images and videos are queued and processed one at a time.`}
      </p>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (isTab(v)) setTab(v)
        }}
      >
        <TabsList
          className={`grid w-full ${imageOnly ? 'grid-cols-1' : 'grid-cols-3'}`}
        >
          <TabsTrigger value="image" data-testid="upscaling-tab-image">
            <ImageUpscale aria-hidden="true" className="mr-2 h-4 w-4" />
            Image
          </TabsTrigger>
          {!imageOnly && (
            <>
              <TabsTrigger value="video" data-testid="upscaling-tab-video">
                <Film aria-hidden="true" className="mr-2 h-4 w-4" />
                Video
              </TabsTrigger>
              <TabsTrigger value="live" data-testid="upscaling-tab-live">
                <Video aria-hidden="true" className="mr-2 h-4 w-4" />
                Live webcam
              </TabsTrigger>
            </>
          )}
        </TabsList>
        <TabsContent value="image" className="mt-4">
          <ImageTab service={service} model={model} />
        </TabsContent>
        {!imageOnly && (
          <>
            <TabsContent value="video" className="mt-4">
              <VideoTab service={service} model={model} />
            </TabsContent>
            <TabsContent value="live" className="mt-4">
              <LiveTab service={service} model={model} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}
