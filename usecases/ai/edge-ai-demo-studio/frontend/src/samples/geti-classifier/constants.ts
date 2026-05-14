// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Layers, Plug, Rocket, Scissors, Settings2 } from 'lucide-react'

// ── Wizard step definitions ───────────────────────────────────────────────────

export const STEPS = [
  {
    id: 1,
    key: 'seg-connect',
    label: 'Connect',
    description: 'Server credentials',
    icon: Plug,
    phase: 'connect' as const,
  },
  {
    id: 2,
    key: 'seg-project',
    label: 'SEG Project',
    description: 'Segmentation project',
    icon: Scissors,
    phase: 'seg' as const,
  },
  {
    id: 3,
    key: 'seg-model',
    label: 'SEG Model',
    description: 'Configure seg model',
    icon: Settings2,
    phase: 'seg' as const,
  },
  {
    id: 4,
    key: 'seg-deploy',
    label: 'SEG Deploy',
    description: 'Deploy seg worker',
    icon: Rocket,
    phase: 'seg' as const,
  },
  {
    id: 5,
    key: 'cls-project',
    label: 'CLS Project',
    description: 'Classification project',
    icon: Layers,
    phase: 'cls' as const,
  },
  {
    id: 6,
    key: 'cls-model',
    label: 'CLS Model',
    description: 'Configure cls model',
    icon: Settings2,
    phase: 'cls' as const,
  },
  {
    id: 7,
    key: 'cls-deploy',
    label: 'CLS Deploy',
    description: 'Deploy cls worker',
    icon: Rocket,
    phase: 'cls' as const,
  },
] as const

// ── Phase colour tokens ───────────────────────────────────────────────────────

export const PHASE_CONFIG = {
  connect: {
    gradient: 'from-slate-600 to-slate-800',
    lightBg: 'bg-slate-50 dark:bg-slate-950/30',
    border: 'border-slate-200 dark:border-slate-800',
    text: 'text-slate-700 dark:text-slate-300',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    accent: 'text-slate-600',
    ring: 'ring-slate-500',
    dot: 'bg-slate-500',
  },
  seg: {
    gradient: 'from-blue-600 to-indigo-700',
    lightBg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800',
    text: 'text-blue-700 dark:text-blue-300',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    accent: 'text-blue-600',
    ring: 'ring-blue-500',
    dot: 'bg-blue-500',
  },
  cls: {
    gradient: 'from-violet-600 to-purple-700',
    lightBg: 'bg-violet-50 dark:bg-violet-950/30',
    border: 'border-violet-200 dark:border-violet-800',
    text: 'text-violet-700 dark:text-violet-300',
    badge:
      'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
    accent: 'text-violet-600',
    ring: 'ring-violet-500',
    dot: 'bg-violet-500',
  },
} as const

// ── Step header copy ──────────────────────────────────────────────────────────

export const STEP_TITLES: Record<number, string> = {
  1: 'Connect to Geti Server',
  2: 'Select Segmentation Project',
  3: 'Configure Segmentation Model',
  4: 'Deploy Segmentation Worker',
  5: 'Select Classification Project',
  6: 'Configure Classification Model',
  7: 'Deploy Classification Worker',
}

export const STEP_DESCRIPTIONS: Record<number, string> = {
  1: 'Enter your server URL and personal access token',
  2: 'Choose the Geti project with your segmentation model',
  3: 'Pick a model version and inference device for segmentation',
  4: 'Download and activate the segmentation deployment',
  5: 'Choose the Geti project with your classification model',
  6: 'Pick a model version and inference device for classification',
  7: 'Download and activate the classification deployment',
}
