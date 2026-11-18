// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Plain HTTP LAN origins have no Clipboard API; use the browser's user-gesture copy command. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const previous = document.activeElement;
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  const container = previous?.closest('[role="dialog"], [role="alertdialog"]') ?? document.body;
  container.append(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    if (typeof document.execCommand !== 'function' || !document.execCommand('copy')) {
      throw new Error('Copy failed. Select and copy the field manually.');
    }
  } finally {
    field.remove();
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
  }
}
