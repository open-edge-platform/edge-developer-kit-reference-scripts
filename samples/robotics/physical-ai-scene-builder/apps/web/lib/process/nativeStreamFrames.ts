// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Browser-side decoder for the framed HTTP stream produced by `nativeStreamProxy.ts`.
 *
 * Every proxied WebSocket message becomes `[kind: u8][payloadLength: u32 LE][payload]`, where kind
 * 0 marks the upstream socket opening, 1 a JSON text header, and 2 a binary attachment. Evaluate
 * and Attach share this transport; each validates its own header schema.
 */

export const NATIVE_STREAM_OPEN = 0;
export const NATIVE_STREAM_TEXT = 1;
export const NATIVE_STREAM_BINARY = 2;
/** Largest single message the browser accepts from a proxied native stream. */
export const NATIVE_STREAM_MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

export type NativeStreamMessage =
  { kind: 'open' } | { kind: 'text'; text: string } | { kind: 'binary'; data: ArrayBuffer };

const decoder = new TextDecoder();

/** Incrementally splits framed stream chunks into complete messages. */
export class NativeStreamDeframer {
  private pending = new Uint8Array();

  constructor(
    private readonly label: string,
    private readonly maxMessageBytes = NATIVE_STREAM_MAX_MESSAGE_BYTES,
  ) {}

  /** Appends a chunk and returns every message it completes, in order. */
  push(chunk: Uint8Array): NativeStreamMessage[] {
    const combined = new Uint8Array(this.pending.byteLength + chunk.byteLength);
    combined.set(this.pending);
    combined.set(chunk, this.pending.byteLength);
    const messages: NativeStreamMessage[] = [];
    let offset = 0;
    while (combined.byteLength - offset >= 5) {
      const kind = combined[offset];
      const payloadLength = new DataView(
        combined.buffer,
        combined.byteOffset + offset + 1,
        4,
      ).getUint32(0, true);
      if (payloadLength > this.maxMessageBytes) {
        throw new Error(`The ${this.label} stream message exceeds the browser limit.`);
      }
      const frameLength = 5 + payloadLength;
      if (combined.byteLength - offset < frameLength) break;
      const payload = combined.slice(offset + 5, offset + frameLength);
      offset += frameLength;
      if (kind === NATIVE_STREAM_OPEN) messages.push({ kind: 'open' });
      else if (kind === NATIVE_STREAM_TEXT)
        messages.push({ kind: 'text', text: decoder.decode(payload) });
      else if (kind === NATIVE_STREAM_BINARY)
        messages.push({ kind: 'binary', data: payload.buffer });
      else throw new Error(`The ${this.label} stream message type is invalid.`);
    }
    this.pending = combined.slice(offset);
    return messages;
  }
}

/** Decodes a little-endian float64 attachment. */
export function decodeFloat64LE(buffer: ArrayBuffer): Float64Array {
  if (buffer.byteLength % Float64Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('A float64 stream attachment has a partial element.');
  }
  const values = new Float64Array(buffer.byteLength / Float64Array.BYTES_PER_ELEMENT);
  const view = new DataView(buffer);
  for (let index = 0; index < values.length; index++) {
    values[index] = view.getFloat64(index * 8, true);
  }
  return values;
}
