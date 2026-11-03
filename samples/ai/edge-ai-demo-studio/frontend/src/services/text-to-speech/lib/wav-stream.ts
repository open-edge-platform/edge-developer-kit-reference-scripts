// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Reads a WAV body as it streams in. Streamed WAVs (workers' `speech_stream.py`) carry placeholder
 * RIFF/`data` sizes (`0xFFFFFFFF`), so the bytes are kept to rebuild a seekable file with real sizes.
 */

export interface WavFormat {
  sampleRate: number
  channels: number
  bitsPerSample: 16 | 32
  /** 1 for integer PCM, 3 for IEEE float. */
  audioFormat: 1 | 3
}

const UNKNOWN_SIZE = 0xffffffff
/** A body with no `data` chunk within this many bytes is not a WAV we read. */
const MAX_HEADER_BYTES = 64 * 1024
const HEADER_BYTES = 44

type Header =
  | { format: WavFormat; dataStart: number; dataSize: number | null }
  | 'incomplete'

function tag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4))
}

/** The `fmt ` and `data` chunks of a RIFF/WAVE header; throws when it is none. */
function parseHeader(bytes: Uint8Array): Header {
  if (bytes.length < 12) return 'incomplete'
  if (tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') {
    throw new Error('The speech stream is not a WAV file')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let format: WavFormat | null = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = tag(bytes, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'data') {
      if (!format) throw new Error('The WAV stream has no format chunk')
      // A streamed header leaves the size unknown (or zero).
      const known = size !== UNKNOWN_SIZE && size !== 0
      return { format, dataStart: body, dataSize: known ? size : null }
    }
    if (id === 'fmt ') {
      if (body + 16 > bytes.length) return 'incomplete'
      let audioFormat = view.getUint16(body, true)
      if (audioFormat === 0xfffe && size >= 26) {
        if (body + 26 > bytes.length) return 'incomplete'
        audioFormat = view.getUint16(body + 24, true) // WAVE_FORMAT_EXTENSIBLE
      }
      const bitsPerSample = view.getUint16(body + 14, true)
      const supported =
        (audioFormat === 1 && (bitsPerSample === 16 || bitsPerSample === 32)) ||
        (audioFormat === 3 && bitsPerSample === 32)
      if (!supported) {
        throw new Error(
          `Unsupported WAV sample format (${audioFormat}, ${bitsPerSample}-bit)`,
        )
      }
      format = {
        audioFormat,
        bitsPerSample,
        channels: Math.max(1, view.getUint16(body + 2, true)),
        sampleRate: view.getUint32(body + 4, true),
      } as WavFormat
    }
    offset = body + size + (size % 2)
  }
  return 'incomplete'
}

/** One Float32Array of samples per channel. */
function decodeFrames(
  bytes: Uint8Array,
  format: WavFormat,
): Float32Array<ArrayBuffer>[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = format.bitsPerSample / 8
  const frames = bytes.byteLength / (width * format.channels)
  const channels = Array.from(
    { length: format.channels },
    () => new Float32Array(frames),
  )
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < format.channels; channel++) {
      const at = (frame * format.channels + channel) * width
      channels[channel][frame] =
        format.audioFormat === 3
          ? view.getFloat32(at, true)
          : format.bitsPerSample === 16
            ? view.getInt16(at, true) / 32768
            : view.getInt32(at, true) / 2147483648
    }
  }
  return channels
}

function wavHeader(format: WavFormat, dataBytes: number): ArrayBuffer {
  const header = new ArrayBuffer(HEADER_BYTES)
  const view = new DataView(header)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }
  const blockAlign = (format.channels * format.bitsPerSample) / 8
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, format.audioFormat, true)
  view.setUint16(22, format.channels, true)
  view.setUint32(24, format.sampleRate, true)
  view.setUint32(28, format.sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, format.bitsPerSample, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)
  return header
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b
  const joined = new Uint8Array(a.length + b.length)
  joined.set(a)
  joined.set(b, a.length)
  return joined
}

export class WavStreamReader {
  private wavFormat: WavFormat | null = null
  /** Header bytes not parsed yet, then the part of a frame still missing its end. */
  private pending: Uint8Array = new Uint8Array(0)
  /** Audio bytes still to come when the header gave a real size. */
  private remaining = Number.POSITIVE_INFINITY
  private readonly data: Uint8Array<ArrayBuffer>[] = []
  private dataBytes = 0

  get format(): WavFormat | null {
    return this.wavFormat
  }

  /** Seconds of audio received so far. */
  get seconds(): number {
    const format = this.wavFormat
    if (!format) return 0
    const bytesPerSecond =
      (format.sampleRate * format.channels * format.bitsPerSample) / 8
    return this.dataBytes / bytesPerSecond
  }

  /** Returns the samples of the whole frames completed, per channel, or `null` if none. */
  push(chunk: Uint8Array): Float32Array<ArrayBuffer>[] | null {
    let bytes = concat(this.pending, chunk)
    let format = this.wavFormat
    if (!format) {
      const header = parseHeader(bytes)
      if (header === 'incomplete') {
        if (bytes.length > MAX_HEADER_BYTES) {
          throw new Error('The speech stream has no WAV data chunk')
        }
        this.pending = bytes
        return null
      }
      format = header.format
      this.wavFormat = format
      this.remaining = header.dataSize ?? Number.POSITIVE_INFINITY
      bytes = bytes.subarray(header.dataStart)
    }
    const blockAlign = (format.channels * format.bitsPerSample) / 8
    const usable = Math.min(bytes.length, this.remaining)
    const whole = usable - (usable % blockAlign)
    this.pending = bytes.slice(whole, usable)
    if (whole === 0) return null
    const frames = bytes.slice(0, whole)
    this.remaining -= whole
    this.data.push(frames)
    this.dataBytes += whole
    return decodeFrames(frames, format)
  }

  /** Everything received, with real sizes in the header. */
  toBlob(): Blob {
    if (!this.wavFormat) throw new Error('The speech stream carried no audio')
    return new Blob([wavHeader(this.wavFormat, this.dataBytes), ...this.data], {
      type: 'audio/wav',
    })
  }
}
