// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Streamdown } from 'streamdown'

/** A docs paragraph written in Markdown (links allowed). */
export function DocsText({ children }: { children: string }) {
  return (
    <div className="text-muted-foreground [&_a]:text-primary text-sm leading-7 [overflow-wrap:anywhere] [&_a]:underline [&_p+p]:mt-3">
      <Streamdown mode="static" linkSafety={{ enabled: false }}>
        {children}
      </Streamdown>
    </div>
  )
}
