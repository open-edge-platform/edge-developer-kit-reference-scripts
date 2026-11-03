// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Task types selectable for each service, default-first. */
const SERVICE_TASK_MAP: Record<string, string[]> = {
  'text-generation': ['text_generation', 'multimodal'],
  embeddings: ['embeddings'],
  rerank: ['rerank'],
}

/** Tasks a service's models may have; takes a service type or an instance key. */
export function tasksFor(serviceIdOrKey: string): string[] | undefined {
  return SERVICE_TASK_MAP[serviceIdOrKey.split('@')[0]]
}

export function defaultTaskFor(serviceIdOrKey: string): string {
  return tasksFor(serviceIdOrKey)?.[0] ?? 'text_generation'
}
