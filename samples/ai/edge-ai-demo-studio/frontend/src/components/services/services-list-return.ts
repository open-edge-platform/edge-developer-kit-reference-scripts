// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  createListReturn,
  useListReturnContext,
  useListReturnHref,
} from '@/hooks/use-list-return'

/** The Services list's query and scroll position, so the breadcrumb and Back return to it. */
const servicesReturn = createListReturn('services-list:return', '/services')

/** The href of the Services breadcrumb: the list view the user left. */
export function useServicesReturnHref(): string {
  return useListReturnHref(servicesReturn)
}

/** Restores the remembered scroll once the list is on screen, then tracks it. */
export function useServicesReturnContext(ready: boolean): void {
  useListReturnContext(servicesReturn, ready)
}

/** Call after a search or filter change, and right before a click leaves the list. */
export function recordServicesView(): void {
  servicesReturn.record()
}
