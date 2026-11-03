// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface ToolOption {
  id: string
  name: string
  description?: string
  server?: string
}

/**
 * Normalizes the worker's `/api/mcp/connect` tools payload, which may arrive
 * as a flat array, an array of `{ server, tools }` groups, or a
 * `{ [server]: tools }` map, into a flat list of options for the tool picker.
 */
export function normalizeTools(rawTools: unknown): ToolOption[] {
  const tools: ToolOption[] = []

  const pushTool = (
    tool: Record<string, unknown>,
    serverLabel?: string,
    fallbackIndex?: number,
  ) => {
    const rawId = typeof tool.id === 'string' ? tool.id : undefined
    const name = tool.name
    if (typeof name !== 'string' || !name.trim()) return

    const description =
      typeof tool.description === 'string' ? tool.description : undefined
    const server = serverLabel ?? undefined
    const idSource = server ? `${server}::${name}` : name
    const id =
      rawId && rawId.trim().length > 0
        ? rawId
        : fallbackIndex !== undefined
          ? `${idSource}::${fallbackIndex}`
          : idSource
    tools.push({ id, name, description, server })
  }

  if (Array.isArray(rawTools)) {
    rawTools.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return
      const entryRecord = entry as Record<string, unknown>
      const serverLabel =
        typeof entryRecord.server === 'string' ? entryRecord.server : undefined
      const nestedTools = entryRecord.tools
      if (Array.isArray(nestedTools)) {
        nestedTools.forEach((tool, toolIndex) => {
          if (!tool || typeof tool !== 'object') return
          pushTool(tool as Record<string, unknown>, serverLabel, toolIndex)
        })
        return
      }
      pushTool(entryRecord, serverLabel, index)
    })
    return tools
  }

  if (rawTools && typeof rawTools === 'object') {
    Object.entries(rawTools as Record<string, unknown>).forEach(
      ([serverLabel, value]) => {
        if (Array.isArray(value)) {
          value.forEach((tool, toolIndex) => {
            if (!tool || typeof tool !== 'object') return
            pushTool(tool as Record<string, unknown>, serverLabel, toolIndex)
          })
        } else if (value && typeof value === 'object') {
          pushTool(value as Record<string, unknown>, serverLabel)
        }
      },
    )
  }

  return tools
}
