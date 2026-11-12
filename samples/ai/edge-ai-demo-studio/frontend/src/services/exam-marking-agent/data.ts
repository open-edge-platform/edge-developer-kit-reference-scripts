// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Bot } from 'lucide-react'
import type { Service as PayloadService } from '@/payload-types'
import type { ServiceMeta, WorkerConfig } from '@/services/types'

export const service: ServiceMeta = {
  id: 'exam-marking-agent',
  name: 'Exam Marking Agent',
  description:
    'ReAct AI agent that queries the exam database and generates insightful student performance reports.',
  longDescription:
    'A ReAct-based AI agent powered by llama-index. It connects to the Exam Marking Database and an OpenAI-compatible LLM to answer questions about student results, generate per-student or class-wide reports, and save them to disk.',
  icon: Bot,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'worker' },
  logSources: [
    {
      type: 'service',
      label: 'exam-marking-agent',
      target: 'exam-marking-agent',
    },
  ],
  healthCheck: {
    url: '/healthcheck',
  },
  hidden: true,
}

export const worker: WorkerConfig = {
  buildArgs: (doc: PayloadService) => ['--port', String(doc.port)],
  workerSubDir: 'services/exam-marking-agent',
}
