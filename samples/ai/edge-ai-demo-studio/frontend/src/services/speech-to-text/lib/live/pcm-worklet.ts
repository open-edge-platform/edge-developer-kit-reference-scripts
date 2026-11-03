// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// 16 kHz mono in ~50 ms frames: short enough not to add latency while filling, long enough to
// keep the WebSocket message rate modest.
export const SAMPLE_RATE = 16000
const FRAME_SAMPLES = 800

export const PCM_WORKLET = 'pcm-worklet'

/** AudioWorklet posting 16-bit PCM frames of `FRAME_SAMPLES` to its port. */
const WORKLET_CODE = `
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Int16Array(${FRAME_SAMPLES})
    this._offset = 0
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        let sample = Math.max(-1, Math.min(1, channel[i]))
        this._buffer[this._offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
        if (this._offset === this._buffer.length) {
          this.port.postMessage(this._buffer.buffer.slice(0))
          this._offset = 0
        }
      }
    }
    return true
  }
}
registerProcessor('${PCM_WORKLET}', PcmWorklet)
`

/** Returns the module's object URL for the caller to revoke when the audio graph goes. */
export async function loadPcmWorklet(audioCtx: AudioContext): Promise<string> {
  const moduleUrl = URL.createObjectURL(
    new Blob([WORKLET_CODE], { type: 'application/javascript' }),
  )
  try {
    await audioCtx.audioWorklet.addModule(moduleUrl)
  } catch (error) {
    URL.revokeObjectURL(moduleUrl)
    throw error
  }
  return moduleUrl
}
