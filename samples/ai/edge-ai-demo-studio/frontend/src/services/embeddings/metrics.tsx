// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { latency, throughput } from '@/services/common/metrics/figures'
import type { MetricFigure } from '@/services/common/metrics/types'

export const figures: MetricFigure[] = [
  throughput({ unit: 'inputs' }),
  latency(),
]
