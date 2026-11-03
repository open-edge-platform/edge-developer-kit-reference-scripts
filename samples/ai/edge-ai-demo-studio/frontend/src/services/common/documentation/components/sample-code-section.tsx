// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { CodeSample } from '@/services/types'
import CodeBlock from './codeblock'
import { DocsText } from './docs-text'

/** The docs' Sample code section: an optional intro, then one block per sample. */
export function SampleCodeSection({
  intro,
  samples,
}: {
  intro?: string
  samples: CodeSample[]
}) {
  return (
    <section id="samples" tabIndex={-1} className="docs-section space-y-4">
      <h2 className="text-lg font-semibold">Sample code</h2>
      {intro && <DocsText>{intro}</DocsText>}
      {samples.map((sample) => (
        <CodeBlock
          key={sample.title}
          title={sample.title}
          data={sample.codeSnippets}
        />
      ))}
    </section>
  )
}
