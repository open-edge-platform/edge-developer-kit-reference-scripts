// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Badge } from '@/components/ui/badge'
import type { ApiParam } from '@/services/types'
import { BackendBadge, type BackendContext } from './backend-badge'

/** An endpoint's parameters, noting the backends of those only some backends take. */
export function ParamsTable({
  params,
  backends,
}: {
  params: ApiParam[]
  backends: BackendContext
}) {
  if (!params.length) return null
  return (
    <div className="space-y-3">
      <h3 className="text-foreground text-xs font-semibold">Parameters</h3>
      <div
        className="border-border overflow-x-auto rounded-lg border"
        tabIndex={0}
        role="region"
        aria-label="Endpoint parameters"
      >
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="bg-muted/50 text-muted-foreground border-border border-b">
            <tr>
              {['Name', 'Type', 'Required', 'Description'].map((label) => (
                <th key={label} scope="col" className="px-3 py-3 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {params.map((param) => (
              <tr
                key={param.name}
                className="hover:bg-muted/20 transition-colors"
              >
                <th scope="row" className="px-3 py-3 align-top font-normal">
                  <code className="text-primary font-mono [overflow-wrap:anywhere]">
                    {param.name}
                  </code>
                </th>
                <td className="text-muted-foreground px-3 py-3 align-top font-mono [overflow-wrap:anywhere]">
                  {param.type}
                </td>
                <td className="px-3 py-3 align-top">
                  {param.required ? (
                    <Badge variant="secondary">Required</Badge>
                  ) : (
                    <span className="text-muted-foreground">Optional</span>
                  )}
                </td>
                <td className="text-muted-foreground min-w-48 px-3 py-3 align-top leading-5 [overflow-wrap:anywhere]">
                  {param.backends?.length ? (
                    <span className="mb-1.5 block">
                      <BackendBadge ids={param.backends} context={backends} />
                    </span>
                  ) : null}
                  {param.desc}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
