// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { formatCompactNumber, formatDurationMs } from '@/lib/browser/format'
import { rate } from '@/services/common/metrics/calc'
import {
  detailLine,
  formatRate,
  latency,
} from '@/services/common/metrics/figures'
import { StatTile } from '@/services/common/metrics/stat-tile'
import type { MetricFigure } from '@/services/common/metrics/types'
import type { MeasuredWork } from '@/services/common/metrics/types'

/** Decode speed: generated tokens per second after the first one. */
const decode = (work: MeasuredWork | null) =>
  rate(work, 'outputTokens', 'after-first-output')

const tps: MetricFigure = {
  id: 'tps',
  render: (work) => {
    const speed = decode(work)
    const tokens = work?.quantities.outputTokens
    return (
      <StatTile
        id="tps"
        label="TPS"
        value={speed === null ? '—' : formatRate(speed)}
        detail={
          speed === null
            ? 'Tokens per second'
            : detailLine(
                `TPOT ${Math.round(1000 / speed)} ms`,
                tokens !== undefined && `${formatCompactNumber(tokens)} tokens`,
              )
        }
        tip="Tokens per second of the latest response after its first token — the decode speed. TPOT is the time per output token, its inverse. A response that was not streamed has no first token to split its time at, so it shows none."
      />
    )
  },
  headline: (work) => {
    const speed = decode(work)
    return speed === null
      ? null
      : detailLine(
          `TPS ${formatRate(speed)}`,
          work.firstOutputMs !== undefined &&
            `TTFT ${formatDurationMs(work.firstOutputMs)}`,
        )
  },
}

const ttft: MetricFigure = {
  id: 'ttft',
  render: (work) => {
    const ms = work?.firstOutputMs
    return (
      <StatTile
        id="ttft"
        label="TTFT"
        value={ms === undefined ? '—' : formatDurationMs(ms)}
        detail="Time to first token"
        tip="Time to first token of the latest response: from sending the prompt until the first token was generated, the wait before text starts appearing. It grows with the length of the prompt."
      />
    )
  },
  headline: (work) =>
    work.firstOutputMs === undefined
      ? null
      : `TTFT ${formatDurationMs(work.firstOutputMs)}`,
}

const prefillTps: MetricFigure = {
  id: 'prefill-tps',
  render: (work) => {
    // Excludes prompt-cache hits, which took no time.
    const speed = rate(work, 'prefillTokens', 'to-first-output')
    const prefilled = work?.quantities.prefillTokens
    const prompt = work?.quantities.inputTokens
    const cached =
      prefilled !== undefined && prompt !== undefined ? prompt - prefilled : 0
    return (
      <StatTile
        id="prefill-tps"
        label="Prefill TPS"
        value={speed === null ? '—' : formatCompactNumber(Math.round(speed))}
        detail={
          speed === null || prefilled === undefined
            ? 'Prompt tokens per second'
            : detailLine(
                `${formatCompactNumber(prefilled)}-token prompt`,
                cached > 0 && `${formatCompactNumber(cached)} cached`,
              )
        }
        tip="Prompt tokens processed per second before the first token of the latest response — the prefill speed: the prompt tokens processed divided by the TTFT. Tokens the engine reused from its prompt cache are left out, as they took no time."
      />
    )
  },
}

export const figures: MetricFigure[] = [
  tps,
  ttft,
  prefillTps,
  // Prompt sent to last token, as the demo timed it.
  latency({ label: 'E2E latency', source: 'response' }),
]
