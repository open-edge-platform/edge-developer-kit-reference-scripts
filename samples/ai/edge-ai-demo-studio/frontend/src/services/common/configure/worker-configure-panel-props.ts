// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import type { SettingDescriptions } from '@/components/configure/applied-settings'
import type { ConfigurePanelStatus } from '@/components/configure/service-configure-panel'
import type { ServiceConfigUpdate } from '@/hooks/use-service-config'
import type { ModelOption, ModelSource, Service } from '@/services/types'
import type { WorkerModelCatalog } from './use-worker-model-catalog'

/**
 * Service-specific settings beyond model, device, source and CPU pinning. The panel resets them with
 * its own, counts them as unsaved, blocks Save while invalid and merges `config` into the save.
 */
export interface ConfigureExtension {
  /** The drafts differ from what is saved. */
  changed: boolean
  /** The drafts can be saved; true when omitted. */
  valid?: boolean
  /** Puts the drafts back to what is saved. */
  reset: () => void
  /** Merged into every save; with a replacing `modelSection`, it names the model and device. */
  config?: ServiceConfigUpdate
  /** What a New instance draft would create, with `modelSection`. */
  preview?: { model?: string; device?: string }
}

/** The model and device the panel holds, for the render slots. */
export interface WorkerModelDraft {
  model: string
  device: string
}

/** What a replacing `modelSection` may need from the panel. */
export interface WorkerPanelContext {
  /** The sheet is open, or the panel drafts inline: fetch now. */
  active: boolean
  /** Which presets are on disk. */
  catalog: WorkerModelCatalog
}

export interface WorkerConfigurePanelProps {
  service: Service
  /** Engine tabs of a multi-engine service: an immediate action leading Advanced settings. */
  engineTabs?: ReactNode
  /**
   * A drafted choice that decides what the rest offers (e.g. the Speech to Text backend): first
   * under Advanced settings, where the engine tabs go, but saved with the rest.
   */
  leadingSection?: ReactNode
  /**
   * Names the model list in use (e.g. the drafted backend). Changing it restarts the model drafts
   * from `startModel` or the saved model; other drafts are kept.
   */
  modelScope?: string
  /** Where the model drafts start when the saved model does not fit the current scope. */
  startModel?: { name?: string; source?: ModelSource }
  /** How the service names its own settings where running ≠ saved. */
  settingDescriptions?: SettingDescriptions
  /** Controlled sheet state, so a multi-engine service keeps the sheet open across the engine swap. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  extension?: ConfigureExtension
  /**
   * Replaces the model and Accelerator sections (e.g. wake words, a storage backend). The panel then
   * saves no model or device of its own (the extension's `config` does) and shows only `statusItems`.
   */
  modelSection?: ReactNode | ((context: WorkerPanelContext) => ReactNode)
  /** Sections after the model, given the drafted model (a voice list). */
  renderAfterModel?: (draft: WorkerModelDraft) => ReactNode
  /** A line under each preset in the model list (a weight hint). */
  renderModelHint?: (option: ModelOption) => ReactNode
  /** A note under the model select for the drafted model. */
  renderModelNote?: (draft: WorkerModelDraft) => ReactNode
  /** A note under the device select (a slow-device warning). */
  renderDeviceNote?: (draft: WorkerModelDraft) => ReactNode
  /** Advanced sections of the service, before CPU affinity. */
  advanced?: ReactNode
  /** Status rows after the current model and device. */
  statusItems?: ConfigurePanelStatus[]
  /** Presets are listed by `label` instead of their model id. */
  listPresetsBy?: 'value' | 'label'
  /** DOM id of the model select, for a panel addressed by it in tests. */
  modelSelectId?: string
  /** Test id of the model select; `cfg-model-select` by default. */
  modelSelectTestId?: string
  /** Offers the downloaded models and "Clear model cache"; by default when a model is configured. */
  clearModelCache?: boolean
}
