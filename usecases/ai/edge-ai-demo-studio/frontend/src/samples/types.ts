// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ComponentType } from 'react'
import type { OS } from '@/types/common'
import { StaticImageData } from 'next/image'

// ─── Sample Types ─────────────────────────────────────────────────
export type SampleCategory =
  | 'Conversational AI'
  | 'Vision'
  | 'Productivity'
  | 'Creative'

export type DependencyRole = 'required' | 'optional'

export interface ServiceDependency {
  serviceId: string
  role: DependencyRole
  /** Short key for capability gating, e.g. "multilingual" */
  capabilityKey?: string
  /** User-facing impact when this optional service is offline */
  impactText?: string
}

/**
 * How the sample is launched:
 * - `component`: renders a custom React demo component inline (like services)
 * - `external`:  redirects user to external URL / spawned service UI
 */
export type SampleDemoType = 'component' | 'external'

export interface SampleDemo {
  type: SampleDemoType
  /** For "component" — the React component to render */
  component?: ComponentType<{ sample: Sample }>
  /** For "external" — the URL the user should navigate to */
  externalUrl?: string
  /** For "external" — short label shown on the redirect card */
  externalLabel?: string
  /** For "external" — helper text explaining where the user is going */
  externalDescription?: string
}

/**
 * A pipeline step: either a single service ID or an array of service IDs
 * that execute in parallel within that step.
 */
export type PipelineStep = string | string[]

export interface Sample {
  id: string
  title: string
  description: string
  longDescription: string
  category: SampleCategory
  dependencies: ServiceDependency[]
  tags: string[]
  /** Cover image path (e.g. '/data/samples/rag-chatbot.webp'). Falls back to a gradient placeholder. */
  image?: string | StaticImageData
  /** How this sample is demoed — custom component or external redirect */
  demo: SampleDemo
  /** Operating systems this sample supports (if omitted, derived from required services) */
  supportedOS?: OS[]
  /**
   * Pipeline flow definition. Each element is a sequential step:
   * - `string` — a single service
   * - `string[]` — services that execute in parallel
   *
   * If omitted, dependencies are shown sequentially in declaration order.
   */
  pipeline?: PipelineStep[]
}

// ─── Helpers ──────────────────────────────────────────────────────
export function getRequiredDeps(s: Sample): ServiceDependency[] {
  return s.dependencies.filter((d) => d.role === 'required')
}

export function getOptionalDeps(s: Sample): ServiceDependency[] {
  return s.dependencies.filter((d) => d.role === 'optional')
}

export type ReadinessStatus = 'ready' | 'partial' | 'blocked'

/** How 'ready' a sample is based on live service statuses */
export function getReadinessLabel(status: ReadinessStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready to launch'
    case 'partial':
      return 'Ready (limited)'
    case 'blocked':
      return 'Setup required'
  }
}

export const categories: SampleCategory[] = [
  'Conversational AI',
  'Vision',
  'Productivity',
  'Creative',
]
