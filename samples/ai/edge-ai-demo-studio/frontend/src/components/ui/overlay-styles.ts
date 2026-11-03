// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Corner close button of dialogs and sheets; its accessible name is an `sr-only` "Close" inside. */
export const OVERLAY_CLOSE_CLASS =
  'ring-offset-background focus-visible:ring-ring text-muted-foreground hover:bg-accent hover:text-foreground absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:pointer-events-none'

/**
 * A footer that stays in view while a tall dialog's body scrolls under it. The shadows paint the
 * background over the padding beside and below it, so scrolled content never shows around it.
 */
export const STICKY_FOOTER_CLASS =
  'bg-background sticky bottom-0 z-10 shadow-[0_1.5rem_0_var(--background),-1.5rem_0_0_var(--background),1.5rem_0_0_var(--background),-1.5rem_1.5rem_0_var(--background),1.5rem_1.5rem_0_var(--background)]'
