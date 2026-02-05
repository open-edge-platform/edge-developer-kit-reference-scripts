// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Workload } from '@/payload-types'

export interface CreateWorkload {
  name: string
  type: Workload['type']
  engine: Workload['engine']
  models: Workload['models']
  port?: number
  healthCheck?: Workload['healthCheck']
  status?: Workload['status']
  metadata?: Workload['metadata']
}

export interface WorkloadStatusMessage {
  type: 'info' | 'warning' | 'error'
  message?: string
  title: string
}

export interface UpdateWorkload {
  name?: string
  models?: Workload['models']
  engine?: Workload['engine']
  metadata?: Workload['metadata']
  status?: Workload['status']
}

export interface InferenceEngine {
  id: string
  name: string
  description: string
}

export interface DocumentationProps {
  overview: React.ReactNode
  endpoints: React.ReactNode
}

export interface EndpointProps {
  title: string
  description: string
  path: string
  headers?: string
  body?: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  parameters?: Parameter[]
  exampleResponse: string
  queryParams?: string[]
  formData?: string[]
  output?: string
}

export interface Parameter {
  name: string
  description: string
  required?: boolean
}

export type Model = Workload['models']['default']
export type ModelTypes = Workload['type'] | 'rerank'
type ModelSource = 'huggingface' | 'modelscope'
export type ModelList = {
  id: string
  engine: Workload['engine']
  task: string
  quant?: string
  verified?: boolean
  downloaded?: boolean
  tool_parser?: string
  chat_template?: string
  source?: ModelSource[]
}[]

export interface EmbeddingSettings {
  engine: Workload['engine']
  embeddingModel: Model
  rerankerModel: Model
}

export interface SpeechToTextSettings {
  sttModel: Model
  denoiseModel: Model
}

export interface TTSSettings {
  model: Model
}

export interface ImageGenerationSettings {
  model: Model
}

export interface LipsyncSettings {
  turnServerIp: string
  model: Model
}

export interface TextGenerationSettings {
  model: Model
  engine: Workload['engine']
}

export interface WakeWordSettings {
  model: Model
  vadThreshold: number
}
