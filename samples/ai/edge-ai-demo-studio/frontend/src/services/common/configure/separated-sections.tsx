// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'

/** The truthy sections with separators between; `undefined` when none, so the slot stays empty. */
export function separatedSections(
  sections: ReactNode[],
): ReactNode[] | undefined {
  const shown = sections.filter(Boolean)
  return shown.length > 0
    ? shown.flatMap((section, i) =>
        i === 0 ? [section] : [<Separator key={`sep-${i}`} />, section],
      )
    : undefined
}
