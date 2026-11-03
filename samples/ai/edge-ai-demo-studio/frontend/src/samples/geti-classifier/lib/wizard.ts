// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  BadgeCheck,
  Layers,
  type LucideIcon,
  Plug,
  Rocket,
  Scissors,
  Settings2,
} from 'lucide-react'
import type { DeployPhase } from './api'

/** The settings wizard's phases: connect, then deploy each model. */
export type Phase = 'connect' | DeployPhase

export interface PhaseStyle {
  name: string
  /** Short name, as the status row and the step labels use it. */
  short: string
  icon: LucideIcon
  /** Solid accent: icon tiles and the header bar. */
  solid: string
  /** Accent text and icons on the page. */
  text: string
  /** Tinted panel: border and faint background. */
  surface: string
  /** Divider lines inside a tinted panel. */
  divide: string
  /** A label chip on a tinted panel. */
  chip: string
}

/**
 * Each phase's look. Segmentation and classification keep their own accents (no theme token means
 * "this model"); states such as success or errors use the theme's tone tokens.
 */
export const PHASES: Record<Phase, PhaseStyle> = {
  connect: {
    name: 'Connect',
    short: 'Connect',
    icon: Plug,
    solid: 'bg-foreground/80 text-background',
    text: 'text-foreground',
    surface: 'border-border bg-muted/40',
    divide: 'divide-border',
    chip: 'border border-border bg-background text-foreground',
  },
  seg: {
    name: 'Segmentation',
    short: 'SEG',
    icon: Scissors,
    solid: 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white',
    text: 'text-blue-700 dark:text-blue-300',
    surface:
      'border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20',
    divide: 'divide-blue-100 dark:divide-blue-900',
    chip: 'border border-blue-200 bg-background text-blue-700 dark:border-blue-700 dark:text-blue-300',
  },
  cls: {
    name: 'Classification',
    short: 'CLS',
    icon: BadgeCheck,
    solid: 'bg-gradient-to-br from-violet-600 to-purple-700 text-white',
    text: 'text-violet-700 dark:text-violet-300',
    surface:
      'border-violet-200 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/20',
    divide: 'divide-violet-100 dark:divide-violet-900',
    chip: 'border border-violet-200 bg-background text-violet-700 dark:border-violet-700 dark:text-violet-300',
  },
}

export type StepKey =
  | 'connect'
  | 'seg-project'
  | 'seg-model'
  | 'seg-deploy'
  | 'cls-project'
  | 'cls-model'
  | 'cls-deploy'

export interface WizardStep {
  key: StepKey
  /** The step indicator's label. */
  label: string
  /** The step's tooltip in the indicator. */
  description: string
  /** The card header while the step is shown. */
  title: string
  subtitle: string
  icon: LucideIcon
  phase: Phase
}

/** The wizard, in order: every step's wording, icon and phase. */
export const STEPS: readonly WizardStep[] = [
  {
    key: 'connect',
    label: 'Connect',
    description: 'Server credentials',
    title: 'Connect to Geti Server',
    subtitle: 'Enter your server URL and personal access token',
    icon: Plug,
    phase: 'connect',
  },
  {
    key: 'seg-project',
    label: 'SEG Project',
    description: 'Segmentation project',
    title: 'Select Segmentation Project',
    subtitle: 'Choose the Geti project with your segmentation model',
    icon: Scissors,
    phase: 'seg',
  },
  {
    key: 'seg-model',
    label: 'SEG Model',
    description: 'Configure seg model',
    title: 'Configure Segmentation Model',
    subtitle: 'Pick a model version and inference device for segmentation',
    icon: Settings2,
    phase: 'seg',
  },
  {
    key: 'seg-deploy',
    label: 'SEG Deploy',
    description: 'Deploy seg worker',
    title: 'Deploy Segmentation Worker',
    subtitle: 'Download and activate the segmentation deployment',
    icon: Rocket,
    phase: 'seg',
  },
  {
    key: 'cls-project',
    label: 'CLS Project',
    description: 'Classification project',
    title: 'Select Classification Project',
    subtitle: 'Choose the Geti project with your classification model',
    icon: Layers,
    phase: 'cls',
  },
  {
    key: 'cls-model',
    label: 'CLS Model',
    description: 'Configure cls model',
    title: 'Configure Classification Model',
    subtitle: 'Pick a model version and inference device for classification',
    icon: Settings2,
    phase: 'cls',
  },
  {
    key: 'cls-deploy',
    label: 'CLS Deploy',
    description: 'Deploy cls worker',
    title: 'Deploy Classification Worker',
    subtitle: 'Download and activate the classification deployment',
    icon: Rocket,
    phase: 'cls',
  },
]

export function stepOf(key: StepKey): WizardStep {
  return STEPS.find((step) => step.key === key) ?? STEPS[0]
}

/** The step after `key`, or `key` itself at the end. */
export function nextStep(key: StepKey): StepKey {
  const index = STEPS.findIndex((step) => step.key === key)
  return STEPS[Math.min(index + 1, STEPS.length - 1)].key
}

/** The step before `key`, or `key` itself at the start. */
export function previousStep(key: StepKey): StepKey {
  const index = STEPS.findIndex((step) => step.key === key)
  return STEPS[Math.max(index - 1, 0)].key
}

/** "Segmentation Phase — Step 2 of 3": where a step sits in its phase. */
export function phaseStepTitle(key: StepKey): string {
  const { phase } = stepOf(key)
  const inPhase = STEPS.filter((step) => step.phase === phase)
  const index = inPhase.findIndex((step) => step.key === key)
  return `${PHASES[phase].name} Phase — Step ${index + 1} of ${inPhase.length}`
}
