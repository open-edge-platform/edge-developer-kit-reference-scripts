// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Database } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'exam-marking-database',
  name: 'Exam Marking Database',
  description:
    'Stores and retrieves AI exam marking results and exposes an MCP server for insights.',
  longDescription:
    'A dedicated database service for AI Exam Marking. It persists graded student records (OCR + LLM results) in SQLite and exposes a Model Context Protocol (MCP) server at /mcp/sse with tools for querying stats, looking up individual students, and generating comprehensive insights reports.',
  icon: Database,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  logSources: [
    {
      type: 'service',
      label: 'exam-marking-database',
      target: 'exam-marking-database',
    },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
  hidden: true,
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => ['--port', String(doc.port)],
  workerSubDir: 'services/exam-marking-database',
}
