// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'
import type { NavItem } from './components/docs-navigation'

/** The docs' sections in page order, each only when the docs have it. */
export function buildNavItems(docs: ServiceDocsData): NavItem[] {
  return [
    { id: 'quick-start', title: 'Quick start' },
    ...(docs.serviceDescription ? [{ id: 'about', title: 'Overview' }] : []),
    { id: 'api-overview', title: 'API overview' },
    ...(docs.endpoints?.length
      ? [{ id: 'endpoints', title: 'Endpoints' }]
      : []),
    ...(docs.errors ? [{ id: 'errors', title: 'Errors' }] : []),
    ...(docs.responseExample
      ? [{ id: 'response', title: 'Response example' }]
      : []),
    ...(docs.sampleCode?.length
      ? [{ id: 'samples', title: 'Sample code' }]
      : []),
  ]
}
