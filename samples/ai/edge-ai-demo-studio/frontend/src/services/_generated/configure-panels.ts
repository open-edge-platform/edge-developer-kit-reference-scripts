// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

import type { ComponentType } from 'react'
import type { Service } from '../types'

import { IbvsConfigurePanel } from '../suites/metro-ai-suite/image-based-video-search/components/configure-panel'
import { LipsyncConfigurePanel } from '../lipsync/components/configure-panel'
import { TtsConfigurePanel } from '../text-to-speech/components/configure-panel'

export type ServiceConfigurePanelComponent = ComponentType<{
  service: Service
}>

/** Optional service-specific configure panel keyed by service ID. */
export const configurePanelRegistry: Partial<
  Record<string, ServiceConfigurePanelComponent>
> = {
  'image-based-video-search': IbvsConfigurePanel,
  lipsync: LipsyncConfigurePanel,
  'text-to-speech': TtsConfigurePanel,
}

export function getServiceConfigurePanel(
  serviceId: string,
): ServiceConfigurePanelComponent | undefined {
  return configurePanelRegistry[serviceId]
}
