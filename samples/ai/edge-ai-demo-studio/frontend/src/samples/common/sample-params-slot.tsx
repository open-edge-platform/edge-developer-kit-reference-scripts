// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DemoConfigSheet,
  type ServiceParamGroup,
} from './components/demo-config-sheet'

/**
 * Context that holds a reference to the portal target element in the shared
 * sample demo top bar. Each demo renders a <SampleParamsSlot> which portals
 * the DemoConfigSheet button into that target, ensuring consistent placement
 * across all samples.
 *
 * The provider is created in SampleDemoContent, which renders a
 * `<div ref={setContainer} />` in its top bar and passes the element
 * through this context.
 */
export const SampleParamsSlotContext = createContext<HTMLDivElement | null>(
  null,
)

/**
 * Render inside a sample demo to portal the DemoConfigSheet into the shared
 * top bar. This replaces direct `<DemoConfigSheet>` usage in each demo.
 */
export function SampleParamsSlot({
  groups,
  children,
}: {
  groups: ServiceParamGroup[]
  children?: ReactNode
}) {
  const container = useContext(SampleParamsSlotContext)

  if (!container || groups.length === 0) return null
  return createPortal(
    <DemoConfigSheet groups={groups}>{children}</DemoConfigSheet>,
    container,
  )
}
