// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { MessageSquare } from 'lucide-react'
import type { ServiceMeta } from '@/services/types'
import {
  getMultiserveDefaultModel,
  getMultiserveServiceConfig,
} from '../../engines/multiserve/config'

export const service: ServiceMeta = {
  id: 'text-generation',
  name: 'Text Generation',
  description:
    'Generate coherent text using large language models optimized for Intel hardware.',
  longDescription:
    'High-performance text generation powered by optimized LLMs running on Intel Xeon processors with OpenVINO acceleration. Supports streaming output, configurable temperature, top-k/top-p sampling, and custom system prompts.',
  icon: MessageSquare,
  port: 8001,
  supportedOS: ['linux', 'windows'],
  execution: { mode: 'multiserve' },
  defaultModel: getMultiserveDefaultModel('text-generation'),
  config: getMultiserveServiceConfig('text-generation'),
  logSources: [
    { type: 'service', label: 'text-generation', target: 'text-generation' },
  ],
}
