// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { latency, throughput } from '@/services/common/metrics/figures'
import type { MetricFigure } from '@/services/common/metrics/types'

// `items` is output megapixels: an image's, every frame's of a video, or one live frame's.
export const figures: MetricFigure[] = [
  throughput({ unit: 'megapixels' }),
  latency(),
]
