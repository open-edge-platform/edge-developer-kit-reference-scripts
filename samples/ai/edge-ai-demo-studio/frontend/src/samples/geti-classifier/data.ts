// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Sample } from '../types'
import { GetiImageClassificationDemo } from './demo'

export const sample: Sample = {
  id: 'geti-classifier',
  title: 'Geti Image Classification',
  description:
    'Classify images using a local Intel Geti deployment and send feedback for continuous model improvement.',
  longDescription:
    'Upload an image to classify it using a locally deployed Intel Geti model. Confirm or correct the prediction to send labelled feedback back to your Geti server, triggering retraining for continuous model improvement. Supports automatic model hot-swap when a newer version is trained.',
  category: ['Vision'],
  dependencies: [{ serviceId: 'geti-classifier', role: 'required' }],
  tags: [
    'Segmentation',
    'Classification',
    'Geti',
    'Computer Vision',
    'Feedback',
    'OpenVINO',
  ],
  supportedOS: ['linux'],
  demo: {
    type: 'component',
    component: GetiImageClassificationDemo,
  },
}
