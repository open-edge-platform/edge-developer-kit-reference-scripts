// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { CreateWorkload, Model } from '@/types/workload'
import {
  DEFAULT_MULTISERVE_FIELDS,
  getDefaultModelForEngine,
  MULTISERVE_ENGINES,
} from '../engine/multiserve'
import { TEXT_GENERATION_PORT } from '../constants'

export const TEXT_GENERATION_TYPE = 'text-generation' as const

export const TEXT_GENERATION_DESCRIPTION =
  'Generate human-like text using advanced language models running directly in your browser. Perfect for content creation, code generation, and creative writing.'

export const TEXT_GENERATION_MODELS: Model[] = []

export const TEXT_GENERATION_ENGINES = [...MULTISERVE_ENGINES]
export const TEXT_GENERATION_URL = '/api/text-generation'

export const TEXT_GENERATION_WORKLOAD: CreateWorkload = {
  name: TEXT_GENERATION_TYPE,
  type: TEXT_GENERATION_TYPE,
  models: {
    default: getDefaultModelForEngine(
      DEFAULT_MULTISERVE_FIELDS.engine,
      TEXT_GENERATION_TYPE,
    ),
  },
  port: TEXT_GENERATION_PORT,
  ...DEFAULT_MULTISERVE_FIELDS,
}
