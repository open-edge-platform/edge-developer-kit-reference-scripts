// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { type ReactNode, useEffect } from 'react'
import type { SettingDescriptions } from '@/components/configure/applied-settings'
import { ConfigureDraftForm } from '@/components/configure/configure-draft-form'
import { useRegisterConfigureOpener } from '@/components/configure/configure-opener'
import {
  type ConfigureSaveRequest,
  ConfigureSheet,
} from '@/components/configure/configure-sheet'
import type { ConfigurePanelStatus } from '@/components/configure/status-items'
import { useConfigureDraftHost } from '@/hooks/use-configure-draft'
import type { ConfigSavePhase } from '@/hooks/use-service-config'
import type { Service } from '@/types/service'

export type { ConfigurePanelStatus, ConfigureSaveRequest }

export interface ServiceConfigurePanelProps {
  service: Service
  statusItems: ConfigurePanelStatus[]
  /** How the panel names its own settings where running ≠ saved. */
  settingDescriptions?: SettingDescriptions
  isDirty: boolean
  isValid: boolean
  /** A New instance draft calls it with no request, to collect the configuration. */
  onSave: (request?: ConfigureSaveRequest) => void
  isSaving?: boolean
  savePhase?: ConfigSavePhase | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Engine choice of a multi-engine service: applies on confirm in the sheet, a draft field in a draft. */
  engineTabs?: ReactNode
  /** Settings most setups leave at their recommended values, folded under "Advanced settings". */
  advanced?: ReactNode
  /** Actions that apply at once (e.g. clear model cache), outside the draft; hidden in a draft. */
  maintenance?: ReactNode
  children: ReactNode
}

/**
 * Frame of every service's Configure panel: the Runtime Settings sheet on a service page, or an
 * inline form under a configure draft host (New instance sheet), whose save hands over the config.
 */
export function ServiceConfigurePanel({
  service,
  statusItems,
  settingDescriptions,
  isDirty,
  isValid,
  onSave,
  isSaving = false,
  savePhase = null,
  open,
  onOpenChange,
  engineTabs,
  advanced,
  maintenance,
  children,
}: ServiceConfigurePanelProps) {
  const draftHost = useConfigureDraftHost()

  useEffect(() => {
    if (!draftHost) return
    draftHost.register({ save: () => onSave(), valid: isValid })
    return () => draftHost.register(null)
  }, [draftHost, onSave, isValid])

  // A draft has no sheet of its own to open.
  useRegisterConfigureOpener(draftHost ? undefined : () => onOpenChange(true))

  if (draftHost) {
    return (
      <ConfigureDraftForm
        engineTabs={engineTabs}
        advanced={advanced}
        advancedOpen={draftHost.advancedOpen}
        onAdvancedOpenChange={draftHost.setAdvancedOpen}
      >
        {children}
      </ConfigureDraftForm>
    )
  }

  return (
    <ConfigureSheet
      service={service}
      statusItems={statusItems}
      settingDescriptions={settingDescriptions}
      isDirty={isDirty}
      isValid={isValid}
      onSave={onSave}
      isSaving={isSaving}
      savePhase={savePhase}
      open={open}
      onOpenChange={onOpenChange}
      engineTabs={engineTabs}
      advanced={advanced}
      maintenance={maintenance}
    >
      {children}
    </ConfigureSheet>
  )
}
