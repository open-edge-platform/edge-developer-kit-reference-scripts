// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { ReactNode } from 'react'
import { CollapsibleSection } from '@/components/configure/collapsible-section'
import { Separator } from '@/components/ui/separator'

export interface ConfigureDraftFormProps {
  /** Model, device and anything else a new instance needs decided. */
  children: ReactNode
  /** Engine tabs, folded into Advanced settings with `advanced`. */
  engineTabs?: ReactNode
  /** Settings with a recommended value, folded away by default. */
  advanced?: ReactNode
  advancedOpen: boolean
  onAdvancedOpenChange: (open: boolean) => void
}

/**
 * New-instance draft form: essentials first, recommended-value settings folded under "Advanced
 * settings" (kept mounted so they keep values and validation).
 */
export function ConfigureDraftForm({
  children,
  engineTabs,
  advanced,
  advancedOpen,
  onAdvancedOpenChange,
}: ConfigureDraftFormProps) {
  const hasAdvanced = Boolean(engineTabs || advanced)
  return (
    <div className="space-y-5">
      {children}
      {hasAdvanced && (
        <CollapsibleSection
          title="Advanced settings"
          note="Optional"
          open={advancedOpen}
          onOpenChange={onAdvancedOpenChange}
          keepMounted
          testId="configure-advanced"
        >
          {engineTabs && (
            <>
              {engineTabs}
              {advanced && <Separator />}
            </>
          )}
          {advanced}
        </CollapsibleSection>
      )}
    </div>
  )
}
