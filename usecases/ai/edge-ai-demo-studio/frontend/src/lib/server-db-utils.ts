// Server-side database utilities for MCP servers
// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { McpServer } from '@/payload-types'

// export interface McpServerDoc {
//   id: number
//   name: string
//   url: string
//   apiKey?: string
//   disabled?: boolean | null
//   description?: string
// }

let payload: Awaited<ReturnType<typeof getPayload>> | null = null

async function getPayloadInstance() {
  if (!payload) {
    payload = await getPayload({ config: configPromise })
  }
  return payload
}

export async function getActiveMcpServers(): Promise<McpServer[]> {
  try {
    const payloadInstance = await getPayloadInstance()

    const { docs } = await payloadInstance.find({
      collection: 'mcp-servers',
      where: {
        disabled: {
          equals: false,
        },
      },
    })

    return docs || []
  } catch (error) {
    console.error('Failed to fetch MCP servers from database:', error)
    return []
  }
}

export async function getMcpServerById(id: string): Promise<McpServer | null> {
  try {
    const payloadInstance = await getPayloadInstance()

    const doc = await payloadInstance.findByID({
      collection: 'mcp-servers',
      id,
    })

    return doc || null
  } catch (error) {
    console.error(`Failed to fetch MCP server ${id}:`, error)
    return null
  }
}
