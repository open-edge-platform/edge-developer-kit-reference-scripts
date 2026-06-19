// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '../types'
import { SyntheticImageGenerationDemo } from './demo'

export const sample: Sample = {
  id: 'synthetic-image-generation',
  title: 'Synthetic Image Generation',
  description:
    'Generate and edit synthetic images from base images in real-time for dataset augmentation.',
  longDescription:
    'A project-based synthetic image generation pipeline for creating training datasets. Upload a base image and generate variations including good samples, missing component scenarios, and custom modifications. Supports project management with asset organization, export, and deletion. Uses diffusion models for high-quality synthetic data generation.',
  category: ['Creative'],
  dependencies: [
    {
      serviceId: 'synthetic-image-generation',
      role: 'required',
    },
  ],
  tags: ['Image Generation', 'Synthetic Data', 'Dataset', 'Diffusion'],
  supportedOS: ['linux'],
  requiredDevices: ['xpu'],
  demo: {
    type: 'component',
    component: SyntheticImageGenerationDemo,
  },
}
