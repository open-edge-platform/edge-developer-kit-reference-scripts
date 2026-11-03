// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { usePathname, useSearchParams } from 'next/navigation'

/** This page's address on its Logs tab, keeping its other parameters, so the link works in a new tab. */
export function useLogsHref(): string {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = new URLSearchParams(searchParams.toString())
  params.set('tab', 'logs')
  return `${pathname}?${params.toString()}`
}
