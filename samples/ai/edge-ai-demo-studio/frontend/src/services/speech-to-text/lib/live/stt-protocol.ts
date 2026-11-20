// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { SttBackendId } from '../../config'
import { audioStreamProtocol } from './audio-stream-protocol'
import type { LiveProtocolFactory, SttStreamSettings } from './protocol'
import { realtimeProtocol } from './realtime-protocol'

/**
 * Live transcription on the running worker's backend: `/v1/realtime` on OEP, `/v1/audio/stream` on
 * OVMS and MERaLiON.
 */
export function sttProtocol(
  backend: SttBackendId,
  settings: SttStreamSettings,
): LiveProtocolFactory {
  return (ctx) =>
    backend === 'oep'
      ? realtimeProtocol(settings, ctx)
      : audioStreamProtocol(settings, ctx)
}
