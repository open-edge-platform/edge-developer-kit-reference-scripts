// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ServiceParamGroup } from '@/types/demo-params'
import {
  DemoConfigSheet,
  type DemoConfigSheetChrome,
} from './components/demo-config-sheet'

/** Toolbar portal target for the Parameters sheet; provided by SampleDemoContent. */
export const SampleParamsSlotContext = createContext<HTMLDivElement | null>(
  null,
)

/** Portals the sample's Parameters sheet into the shared demo toolbar. */
export function SampleParamsSlot({
  groups,
  children,
  footer,
  chrome,
}: {
  groups: ServiceParamGroup[]
  children?: ReactNode
  /** Rendered in the sheet's footer (a Done button, say). */
  footer?: ReactNode
  /** Wording and test ids of the sheet, when a sample's own tests name them. */
  chrome?: DemoConfigSheetChrome
}) {
  const container = useContext(SampleParamsSlotContext)

  if (!container || groups.length === 0) return null
  return createPortal(
    <DemoConfigSheet groups={groups} footer={footer} chrome={chrome}>
      {children}
    </DemoConfigSheet>,
    container,
  )
}
