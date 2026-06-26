// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { SuiteLaunchPanel } from '@/samples/common/components/suite-launch-panel'
import { RestartPipelineButton } from './components/restart-pipeline-button'
import { lossPreventionSuite } from './config'

export function LossPreventionDemo() {
  // Loss Prevention runs in visual mode — the GStreamer pipeline opens a
  // display window directly on the host (RENDER_MODE=1 DISPLAY=:0).
  // There is no browser-accessible web UI to link to.
  return (
    <SuiteLaunchPanel
      {...lossPreventionSuite}
      popupHint="Loss Prevention runs in visual mode — the GStreamer pipeline output window will appear on your host display. If the window disappears or does not appear, click Reopen Display Window to restart the pipeline container."
      extraActions={<RestartPipelineButton />}
    />
  )
}
