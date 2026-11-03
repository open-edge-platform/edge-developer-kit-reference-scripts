// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { DocsErrors } from '@/services/types'
import { DocsText } from './docs-text'

/** The docs' Errors section: the error body, then each status and when. */
export function ErrorsSection({ errors }: { errors: DocsErrors }) {
  return (
    <section
      id="errors"
      tabIndex={-1}
      className="docs-section space-y-4"
      aria-labelledby="errors-heading"
    >
      <h2 id="errors-heading" className="text-lg font-semibold">
        Errors
      </h2>
      <DocsText>{errors.intro}</DocsText>
      <div
        className="border-border overflow-x-auto rounded-lg border"
        tabIndex={0}
        role="region"
        aria-label="Error statuses"
      >
        <table className="w-full min-w-[420px] text-left text-xs">
          <thead className="bg-muted/50 text-muted-foreground border-border border-b">
            <tr>
              <th scope="col" className="w-20 px-3 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-3 font-medium">
                When
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {errors.cases.map((error) => (
              <tr key={`${error.status}:${error.when}`}>
                <th
                  scope="row"
                  className="px-3 py-3 align-top font-mono font-normal"
                >
                  {error.status}
                </th>
                <td className="text-muted-foreground px-3 py-3 align-top leading-5 [overflow-wrap:anywhere]">
                  {error.when}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
