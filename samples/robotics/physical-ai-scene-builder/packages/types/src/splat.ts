// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Gaussian-splat backdrop limits and PLY / SPZ header validation shared by the browser (file
 * select, scene save, scene archives) and the Payload `assets` collection. Payload imports this
 * file directly, so it depends on nothing but `fflate` (pure JS).
 */

import { Gunzip } from 'fflate';

/** Largest splat file accepted anywhere: client file select, asset upload, and scene archives. */
export const MAX_SPLAT_BYTES = 500 * 1024 * 1024;

/**
 * Most Gaussians a splat may declare: the native XPU renderer's hard ceiling (`MAX_GAUSSIANS` in
 * `robotic_studio/generation/backdrop.py`). Checked from the header, so an oversized scan fails at
 * upload rather than in a worker, and the editor never decodes more than this for collision.
 */
export const MAX_SPLAT_GAUSSIANS = 16_000_000;

/** Splat containers: a 3DGS PLY, or Niantic's gzipped, quantized SPZ. */
export type SplatFormat = 'ply' | 'spz';

const isGzip = (bytes: Uint8Array) => bytes[0] === 0x1f && bytes[1] === 0x8b;
/** Raw `NGSP` magic: SPZ v4+ is no longer one gzip stream. */
const isRawSpz = (bytes: Uint8Array) =>
  bytes[0] === 0x4e && bytes[1] === 0x47 && bytes[2] === 0x53 && bytes[3] === 0x50;

/** SPZ files are gzip streams (v2/v3) or start with `NGSP` (v4+); anything else is PLY. */
export function splatFormatOf(bytes: Uint8Array): SplatFormat {
  return isGzip(bytes) || isRawSpz(bytes) ? 'spz' : 'ply';
}

/** Whether `path` names a splat file by extension (`.ply` or `.spz`). */
export function isSplatPath(path: string): boolean {
  return /\.(ply|spz)$/i.test(path);
}

/** `filename` with the extension of `format`, replacing a splat extension it already has. */
export function splatFilename(filename: string, format: SplatFormat): string {
  return `${filename.replace(/\.(ply|spz)$/i, '') || 'backdrop'}.${format}`;
}

/** MJCF body that carries the splat backdrop pose and its collision heightfield. */
export const SPLAT_BACKDROP_BODY = 'rs_backdrop';

export type PlyFormat = 'ascii' | 'binary_little_endian' | 'binary_big_endian';

export interface PlyHeaderInfo {
  format: PlyFormat;
  elements: PlyElement[];
  /** Byte offset immediately after the `end_header` line terminator. */
  bodyStart: number;
}

export type PlyScalarType = 'i1' | 'u1' | 'i2' | 'u2' | 'i4' | 'u4' | 'f4' | 'f8';

export interface PlyProperty {
  name: string;
  type: PlyScalarType;
  countType?: PlyScalarType;
}

export interface PlyElement {
  name: string;
  count: number;
  properties: PlyProperty[];
}

export type PlyHeaderResult = { ok: true; header: PlyHeaderInfo } | { ok: false; error: string };

const MAX_PLY_HEADER_BYTES = 64 * 1024;
const PLY_FORMATS = new Set<string>(['ascii', 'binary_little_endian', 'binary_big_endian']);
const PLY_SCALARS: Record<string, PlyScalarType> = {
  char: 'i1',
  int8: 'i1',
  uchar: 'u1',
  uint8: 'u1',
  short: 'i2',
  int16: 'i2',
  ushort: 'u2',
  uint16: 'u2',
  int: 'i4',
  int32: 'i4',
  uint: 'u4',
  uint32: 'u4',
  float: 'f4',
  float32: 'f4',
  double: 'f8',
  float64: 'f8',
};

/**
 * Validates a PLY header: the file starts with `ply\n`, declares a supported `format`, a vertex
 * element with scalar columns required by native workers, and terminates the header.
 */
export function parsePlyHeader(bytes: Uint8Array): PlyHeaderResult {
  const limit = Math.min(bytes.byteLength, MAX_PLY_HEADER_BYTES);
  let text = '';
  for (let index = 0; index < limit; index++) text += String.fromCharCode(bytes[index]);
  if (!text.startsWith('ply\n') && !text.startsWith('ply\r\n')) {
    return { ok: false, error: 'The file is not a PLY file (it must start with "ply").' };
  }
  const end = /(^|\n)end_header\r?\n/.exec(text);
  if (!end) return { ok: false, error: 'The PLY header has no end_header line.' };
  const headerBytes = end.index + end[0].length;
  let format: PlyFormat | null = null;
  const elements: PlyElement[] = [];
  // Same rules as `robotic_studio.generation.ply`: exact word counts, plain decimal counts, and
  // unknown keywords rejected (the first line is the `ply` magic checked above).
  for (const rawLine of text.slice(0, end.index).split('\n').slice(1)) {
    const words = rawLine.trim().split(/\s+/);
    if (!words[0] || words[0] === 'comment' || words[0] === 'obj_info') continue;
    if (words[0] === 'format') {
      if (words.length !== 3)
        return { ok: false, error: 'The PLY header has an invalid format line.' };
      if (!PLY_FORMATS.has(words[1] ?? '')) {
        return { ok: false, error: `Unsupported PLY format "${words[1] ?? ''}".` };
      }
      format = words[1] as PlyFormat;
    } else if (words[0] === 'element') {
      const count = /^\d+$/.test(words[2] ?? '') ? Number(words[2]) : NaN;
      if (words.length !== 3 || !Number.isSafeInteger(count)) {
        return { ok: false, error: 'The PLY header has an invalid element declaration.' };
      }
      elements.push({ name: words[1], count, properties: [] });
    } else if (words[0] === 'property') {
      const element = elements.at(-1);
      if (!element)
        return { ok: false, error: 'The PLY header has a property before any element.' };
      if (words[1] === 'list') {
        const countType = PLY_SCALARS[words[2] ?? ''];
        const type = PLY_SCALARS[words[3] ?? ''];
        if (!countType || !type || words.length !== 5) {
          return { ok: false, error: 'The PLY header has an invalid list property.' };
        }
        element.properties.push({ name: words[4], type, countType });
      } else {
        const type = PLY_SCALARS[words[1] ?? ''];
        if (!type || words.length !== 3) {
          return { ok: false, error: 'The PLY header has an invalid scalar property.' };
        }
        element.properties.push({ name: words[2], type });
      }
    } else {
      return { ok: false, error: `Unknown PLY header keyword "${words[0]}".` };
    }
  }
  if (!format) return { ok: false, error: 'The PLY header has no format line.' };
  const vertex = elements.find((element) => element.name === 'vertex');
  if (!vertex || vertex.count <= 0) {
    return { ok: false, error: 'The PLY file declares no vertices.' };
  }
  // Skipping a list element means walking it row by row, so a hostile count would spin; splat
  // PLYs have none before the vertex table (faces, if any, come after and are not read).
  if (
    elements
      .slice(0, elements.indexOf(vertex))
      .some((element) => element.properties.some((property) => property.countType))
  ) {
    return { ok: false, error: 'PLY list elements before the vertex table are not supported.' };
  }
  if (
    new Set(vertex.properties.map((property) => property.name)).size !== vertex.properties.length
  ) {
    return { ok: false, error: 'The PLY vertex element has duplicated property names.' };
  }
  if (
    ['x', 'y', 'z'].some((name) => {
      const property = vertex.properties.find((item) => item.name === name);
      return !property || property.countType || (property.type !== 'f4' && property.type !== 'f8');
    })
  ) {
    return { ok: false, error: 'The PLY position columns x/y/z must be float or double scalars.' };
  }
  const rest = vertex.properties
    .map((property) => /^f_rest_(\d+)$/.exec(property.name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .sort((left, right) => left - right);
  if (
    rest.some((index, at) => index !== at) ||
    (rest.length > 0 && ![9, 24, 45].includes(rest.length))
  ) {
    return {
      ok: false,
      error: 'The PLY f_rest_* columns must be contiguous and number 9, 24, or 45.',
    };
  }
  const scalarNames = new Set(
    vertex.properties.filter((property) => !property.countType).map((property) => property.name),
  );
  const required = [
    'x',
    'y',
    'z',
    'opacity',
    'scale_0',
    'scale_1',
    'scale_2',
    'rot_0',
    'rot_1',
    'rot_2',
    'rot_3',
  ];
  const colors = ['f_dc_0', 'f_dc_1', 'f_dc_2'];
  const rgb = ['red', 'green', 'blue'];
  const missing = required.filter((name) => !scalarNames.has(name));
  if (
    !colors.every((name) => scalarNames.has(name)) &&
    !rgb.every((name) => scalarNames.has(name))
  ) {
    missing.push('f_dc_0..2 (or red/green/blue)');
  }
  if (missing.length) {
    return {
      ok: false,
      error: `The PLY vertex table is missing required scalar splat columns: ${missing.join(', ')}.`,
    };
  }
  return {
    ok: true,
    header: { format, elements, bodyStart: headerBytes },
  };
}

export interface SpzHeader {
  /** 2: 24-bit fixed-point positions; 3: adds smallest-three quaternions. */
  version: 2 | 3;
  numPoints: number;
  shDegree: number;
  fractionalBits: number;
}

export type SpzHeaderResult = { ok: true; header: SpzHeader } | { ok: false; error: string };

/** Bytes before the point data in a decompressed SPZ. */
export const SPZ_HEADER_BYTES = 16;
const SPZ_MAGIC = 0x5053474e; // "NGSP"

/** Parses the 16-byte header at the start of a *decompressed* SPZ stream. */
export function parseSpzHeader(bytes: Uint8Array): SpzHeaderResult {
  if (bytes.byteLength < SPZ_HEADER_BYTES)
    return { ok: false, error: 'The SPZ file is truncated.' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, SPZ_HEADER_BYTES);
  if (view.getUint32(0, true) !== SPZ_MAGIC) {
    return { ok: false, error: 'The file is gzip-compressed but not an SPZ splat.' };
  }
  const version = view.getUint32(4, true);
  if (version !== 2 && version !== 3) {
    return {
      ok: false,
      error: `SPZ version ${version} is not supported; re-export the splat as SPZ version 3 or PLY.`,
    };
  }
  const numPoints = view.getUint32(8, true);
  if (!numPoints) return { ok: false, error: 'The SPZ file contains no splats.' };
  const shDegree = view.getUint8(12);
  if (shDegree > 3) return { ok: false, error: `SPZ SH degree ${shDegree} is not supported.` };
  const fractionalBits = view.getUint8(13);
  // Positions are 24-bit fixed point; more fractional bits than that is a corrupt header.
  if (fractionalBits > 24) return { ok: false, error: 'The SPZ header is corrupt.' };
  return { ok: true, header: { version, numPoints, shDegree, fractionalBits } };
}

/** Byte offsets of each SPZ attribute block (after the header) and the total decoded length. */
export function spzLayout({ version, numPoints: n, shDegree }: SpzHeader) {
  const positions = SPZ_HEADER_BYTES;
  const alphas = positions + 9 * n;
  const colors = alphas + n;
  const scales = colors + 3 * n;
  const rotations = scales + 3 * n;
  const sh = rotations + (version === 3 ? 4 : 3) * n;
  const end = sh + ((shDegree + 1) ** 2 - 1) * 3 * n;
  return { positions, alphas, colors, scales, rotations, sh, end };
}

/** Inflates just enough of a gzip prefix to read the SPZ header, without the whole file. */
function spzPrefixHeader(prefixBytes: Uint8Array, complete: boolean): SpzHeaderResult {
  if (!isGzip(prefixBytes)) {
    // Raw `NGSP`: report the version problem; an uncompressed v2/v3 stream is not a valid file.
    const raw = parseSpzHeader(prefixBytes);
    return raw.ok ? { ok: false, error: 'The SPZ file is not gzip-compressed.' } : raw;
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    const gunzip = new Gunzip((chunk) => {
      chunks.push(chunk);
      length += chunk.byteLength;
    });
    gunzip.push(
      prefixBytes.subarray(0, MAX_PLY_HEADER_BYTES),
      complete && prefixBytes.byteLength <= MAX_PLY_HEADER_BYTES,
    );
  } catch {
    return { ok: false, error: 'The SPZ file is not valid gzip.' };
  }
  const head = new Uint8Array(Math.min(length, SPZ_HEADER_BYTES));
  let at = 0;
  for (const chunk of chunks) {
    if (at >= head.byteLength) break;
    const part = chunk.subarray(0, head.byteLength - at);
    head.set(part, at);
    at += part.byteLength;
  }
  return parseSpzHeader(head);
}

/** Size and header checks for a splat PLY or SPZ; returns a user-facing problem or null. */
export function splatFileProblem(
  prefixBytes: Uint8Array,
  totalBytes = prefixBytes.byteLength,
): string | null {
  if (!totalBytes) return 'The splat file is empty.';
  if (totalBytes > MAX_SPLAT_BYTES) {
    return `The splat file is larger than ${MAX_SPLAT_BYTES / (1024 * 1024)} MB.`;
  }
  let count: number;
  if (splatFormatOf(prefixBytes) === 'spz') {
    const spz = spzPrefixHeader(prefixBytes, totalBytes === prefixBytes.byteLength);
    if (!spz.ok) return spz.error;
    count = spz.header.numPoints;
  } else {
    const ply = parsePlyHeader(prefixBytes);
    if (!ply.ok) return ply.error;
    // parsePlyHeader guarantees a vertex element.
    count = ply.header.elements.find((element) => element.name === 'vertex')!.count;
  }
  if (count > MAX_SPLAT_GAUSSIANS) {
    const limit = MAX_SPLAT_GAUSSIANS.toLocaleString('en-US');
    return `The splat has ${count.toLocaleString('en-US')} Gaussians; at most ${limit} are supported.`;
  }
  return null;
}
