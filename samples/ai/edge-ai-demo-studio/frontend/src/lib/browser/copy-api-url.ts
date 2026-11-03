// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { toast } from 'sonner'
import { copyText } from '@/lib/browser/clipboard'

/** Copies an instance's API base as an absolute URL and toasts the result. Client-only. */
export function copyApiUrl(apiBase: string): void {
  const url = `${window.location.origin}${apiBase}`
  copyText(url)
    .then(() => toast.success('API URL copied', { description: url }))
    .catch(() =>
      toast.error('Could not copy the API URL', { description: url }),
    )
}
