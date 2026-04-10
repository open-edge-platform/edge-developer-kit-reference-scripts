// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface ParamSlider {
  type: 'slider'
  id: string
  label: string
  tooltip?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

export interface ParamSelect {
  type: 'select'
  id: string
  label: string
  tooltip?: string
  value: string
  options: { value: string; label: string; downloaded?: boolean }[]
  onChange: (value: string) => void
  /** Hint text shown below the select (e.g. download disclaimer). */
  hint?: string
  /** Optional callback to refresh the options list (e.g. re-fetch devices). */
  onRefresh?: () => void
  /** Whether a refresh is currently in progress. */
  isRefreshing?: boolean
}

export interface ParamCheckboxGroup {
  type: 'checkbox-group'
  id: string
  label: string
  options: { value: string; label: string; checked: boolean }[]
  onChange: (value: string, checked: boolean) => void
}

export interface ParamInfoList {
  type: 'info-list'
  id: string
  label: string
  items: { name: string; description?: string }[]
  emptyText?: string
}

export interface ParamTextarea {
  type: 'textarea'
  id: string
  label: string
  tooltip?: string
  value: string
  placeholder?: string
  rows?: number
  onChange: (value: string) => void
}

export interface ParamToggle {
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
