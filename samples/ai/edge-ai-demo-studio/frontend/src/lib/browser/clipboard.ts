// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Copies `text` to the clipboard. `navigator.clipboard` needs a secure context, so plain http on a
 * LAN address falls back to an off-screen textarea and `execCommand('copy')`.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-1000px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  const focused = document.activeElement
  try {
    textarea.select()
    if (!document.execCommand('copy')) {
      throw new Error('The browser refused to copy')
    }
  } finally {
    textarea.remove()
    if (focused instanceof HTMLElement) focused.focus()
  }
}
