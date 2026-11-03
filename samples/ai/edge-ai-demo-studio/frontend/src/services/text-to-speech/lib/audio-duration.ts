// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Length of a whole MP3 or Ogg Opus file from its frame headers and pages, not decoded, so it is
 * synchronous and can run between a response's last byte and the end of its timing.
 */

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

// MPEG Layer III, in kbit/s by bitrate index: MPEG-1, then MPEG-2 and 2.5.
const MPEG1_BITRATES = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
]
const MPEG2_BITRATES = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
]
// By the header's version bits: 0 MPEG-2.5, 2 MPEG-2, 3 MPEG-1.
const MPEG_SAMPLE_RATES: Record<number, number[]> = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000],
}

/** Size of a leading ID3v2 tag, or 0. */
function id3v2Size(bytes: Uint8Array): number {
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== 'ID3') return 0
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f)
  const footer = bytes[5] & 0x10 ? 10 : 0
  return 10 + size + footer
}

function mp3Seconds(bytes: Uint8Array): number | undefined {
  let offset = id3v2Size(bytes)
  let samples = 0
  let sampleRate = 0
  let first = true
  while (offset + 4 <= bytes.length) {
    const b1 = bytes[offset + 1]
    const b2 = bytes[offset + 2]
    // A trailing ID3v1 tag, or anything else that is not a frame, ends it.
    if (bytes[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) break
    const version = (b1 >> 3) & 0x03
    const layer = (b1 >> 1) & 0x03
    const bitrateIndex = b2 >> 4
    const rateIndex = (b2 >> 2) & 0x03
    if (
      version === 1 ||
      layer !== 1 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15 ||
      rateIndex === 3
    ) {
      return undefined
    }
    const mpeg1 = version === 3
    const bitrate =
      (mpeg1 ? MPEG1_BITRATES : MPEG2_BITRATES)[bitrateIndex] * 1000
    const rate = MPEG_SAMPLE_RATES[version][rateIndex]
    const frameSamples = mpeg1 ? 1152 : 576
    const length =
      Math.floor(((frameSamples / 8) * bitrate) / rate) + ((b2 >> 1) & 0x01)

    // The encoder's Xing/Info frame carries the stream's details, not audio.
    const mono = bytes[offset + 3] >> 6 === 3
    const sideInfo = mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17
    const tagName = ascii(bytes, offset + 4 + sideInfo, 4)
    if (!(first && (tagName === 'Xing' || tagName === 'Info'))) {
      samples += frameSamples
    }
    first = false
    sampleRate = rate
    offset += length
  }
  return samples > 0 ? samples / sampleRate : undefined
}

/** Opus always counts its granule positions at 48 kHz. */
const OPUS_RATE = 48000

/** The last page's granule position less the OpusHead pre-skip. */
function oggOpusSeconds(bytes: Uint8Array): number | undefined {
  if (bytes.length < 28 || ascii(bytes, 0, 4) !== 'OggS') return undefined
  const head = 27 + bytes[26]
  if (ascii(bytes, head, 8) !== 'OpusHead' || head + 12 > bytes.length) {
    return undefined
  }
  const preSkip = bytes[head + 10] | (bytes[head + 11] << 8)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let page = bytes.length - 27; page >= 0; page--) {
    if (bytes[page] !== 0x4f || ascii(bytes, page, 4) !== 'OggS') continue
    if (bytes[page + 4] !== 0) continue
    const low = view.getUint32(page + 6, true)
    const high = view.getUint32(page + 10, true)
    // -1: no packet ends on this page.
    if (low === 0xffffffff && high === 0xffffffff) continue
    const granule = high * 2 ** 32 + low
    return granule > preSkip ? (granule - preSkip) / OPUS_RATE : undefined
  }
  return undefined
}

/** `undefined` for other formats or a file that doesn't parse. */
export function encodedAudioSeconds(
  bytes: Uint8Array,
  format: string,
): number | undefined {
  if (format === 'mp3') return mp3Seconds(bytes)
  if (format === 'opus') return oggOpusSeconds(bytes)
  return undefined
}
