// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { DOWNLOAD_CHARS, safeDownloadUrl } from '@/lib/validation'

/** Saves `href` (a data:, blob: or same-origin URL) as `fileName`; throws for any other URL. */
export function downloadUrl(href: string, fileName: string): void {
  // Rebuilt inline from allowed characters: Coverity treats a helper's return value as tainted.
  let target = ''
  for (const ch of safeDownloadUrl(href)) {
    let ok = ''
    for (const allowed of DOWNLOAD_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) throw new Error('Forbidden character in download URL')
    target += ok
  }
  const link = document.createElement('a')
  link.href = target
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** Saves a blob as `fileName`, releasing its object URL afterwards. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  try {
    downloadUrl(url, fileName)
  } finally {
    URL.revokeObjectURL(url)
  }
}
