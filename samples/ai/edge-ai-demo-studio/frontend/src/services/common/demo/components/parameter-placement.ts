// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { createContext, useContext } from 'react'

/** Where `DemoLayout` shows a demo's parameters: the side column, or its sheet (which has a title). */
export type ParameterPlacement = 'column' | 'sheet'

export const ParameterPlacementContext =
  createContext<ParameterPlacement>('column')

export function useParameterPlacement(): ParameterPlacement {
  return useContext(ParameterPlacementContext)
}
