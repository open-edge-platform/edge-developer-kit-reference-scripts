// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Cable } from 'lucide-react'
import type { ServiceMeta } from '@/services/types'

export const service: ServiceMeta = {
  id: 'mcp',
  name: 'MCP Manager',
  description:
    'Manage Model Context Protocol servers and their tool integrations.',
  longDescription:
    'Centralized management for Model Context Protocol (MCP) servers. Add, edit, enable/disable, and remove MCP server configurations. Each server exposes tools that can be used by LLM-powered services for dynamic tool calling during text generation.',
  icon: Cable,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'none' },
  logSources: [],
}
