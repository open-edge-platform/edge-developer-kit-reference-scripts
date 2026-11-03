// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo, useSyncExternalStore } from 'react'

/**
 * A blob's object URL as an external store: created on subscribe (commit), not during render where
 * Strict Mode can run twice and leak a URL, and revoked on unsubscribe.
 */
function objectUrlStore(blob: Blob) {
  let url: string | null = null
  return {
    subscribe(onChange: () => void) {
      url = URL.createObjectURL(blob)
      onChange()
      return () => {
        if (url) URL.revokeObjectURL(url)
        url = null
      }
    },
    getSnapshot: () => url,
  }
}

const noopSubscribe = () => () => {}
const getNoUrl = () => null

/** Object URL for `blob`, revoked when it changes or on unmount; `null` until commit. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const store = useMemo(() => (blob ? objectUrlStore(blob) : null), [blob])
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getSnapshot ?? getNoUrl,
    getNoUrl,
  )
}
