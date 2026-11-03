// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'

interface ParamCommon {
  /** Less-used: `DemoParameterSidebar` lists it under a collapsed "Advanced" section. */
  advanced?: boolean
}

export interface ParamSlider extends ParamCommon {
  type: 'slider'
  id: string
  label: string
  tooltip?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  /**
   * Set for a param that may be left to the backend, adding a Default / Custom choice. `true` means
   * untouched (the request omits it); switching to Custom calls `onChange` with the seeded value.
   */
  unset?: boolean
  /** Reverts the param to its untouched/default state; renders a reset affordance. */
  onReset?: () => void
  /** Unit shown after the value, e.g. "tokens". */
  unit?: string
}

export interface ParamSelect extends ParamCommon {
  type: 'select'
  id: string
  label: string
  tooltip?: string
  value: string
  options: { value: string; label: string; downloaded?: boolean }[]
  onChange: (value: string) => void
  /** Hint text shown below the select (e.g. download disclaimer). */
  hint?: string
  /** Refreshes the options, e.g. re-fetches devices. */
  onRefresh?: () => void
  isRefreshing?: boolean
  /** Shown but not changeable for now (the caller says why). */
  disabled?: boolean
}

export interface ParamCheckboxGroup extends ParamCommon {
  type: 'checkbox-group'
  id: string
  label: string
  options: { value: string; label: string; checked: boolean }[]
  onChange: (value: string, checked: boolean) => void
}

export interface ParamInfoList extends ParamCommon {
  type: 'info-list'
  id: string
  label: string
  items: { name: string; description?: string }[]
  emptyText?: string
}

export interface ParamTextarea extends ParamCommon {
  type: 'textarea'
  id: string
  label: string
  tooltip?: string
  value: string
  placeholder?: string
  rows?: number
  onChange: (value: string) => void
}

export interface ParamToggle extends ParamCommon {
  type: 'toggle'
  id: string
  label: string
  tooltip?: string
  checked: boolean
  onChange: (checked: boolean) => void
}

export type DemoParam =
  | ParamSlider
  | ParamSelect
  | ParamCheckboxGroup
  | ParamInfoList
  | ParamTextarea
  | ParamToggle

export interface ServiceParamGroup {
  serviceLabel: string
  serviceId: string
  online: boolean
  optional: boolean
  offlineMessage?: string
  configHref?: string
  params: DemoParam[]
  enabled?: boolean
  onToggle?: (enabled: boolean) => void
  children?: ReactNode
  /**
   * Service types a sample may pick instances of for this group (RAG: vectordb and embeddings).
   * Defaults to `[serviceId]`.
   */
  instanceTypes?: string[]
}
