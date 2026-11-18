// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Full-precision reader for 3D Gaussian Splatting PLY files, used to derive the backdrop collision
 * heightfield from the same float32 data the native workers render (`robotic_studio.generation.ply`)
 * instead of Spark's packed render buffer (float16 centers, 8-bit log scales).
 *
 * Supports `ascii`, `binary_little_endian` and `binary_big_endian`; scalar elements before
 * `vertex` are skipped (`parsePlyHeader` rejects list elements there). Returns null for PLYs it cannot read this way (no
 * vertex element or compressed layouts). SPZ files (`readSplatSpz`) are dequantized the same way
 * `robotic_studio.generation.ply` decodes them, so collision matches the native render for both.
 * Pure (plus `fflate`) so it runs in a Web Worker and in tests.
 */

import { gunzipSync } from 'fflate';

import { SPLAT_OPACITY_THRESHOLD, type SplatPoint } from './splatCollision';
import {
  parsePlyHeader,
  parseSpzHeader,
  splatFormatOf,
  spzLayout,
  type PlyElement,
  type PlyScalarType,
} from '@mujoco-studio/types';

/** Floats per point in `PackedSplatPoints.data`: x y z opacity sx sy sz qw qx qy qz. */
export const PACKED_SPLAT_STRIDE = 11;

/** Visible splats (opacity at or above `SPLAT_OPACITY_THRESHOLD`) in a transferable layout. */
export interface PackedSplatPoints {
  /** `PACKED_SPLAT_STRIDE` floats per point; scales are linear. */
  data: Float32Array;
  /** PLY vertex index of each point. */
  index: Uint32Array;
}

const SIZES: Record<PlyScalarType, number> = {
  i1: 1,
  u1: 1,
  i2: 2,
  u2: 2,
  i4: 4,
  u4: 4,
  f4: 4,
  f8: 8,
};

function readScalar(view: DataView, offset: number, type: PlyScalarType, little: boolean): number {
  switch (type) {
    case 'i1':
      return view.getInt8(offset);
    case 'u1':
      return view.getUint8(offset);
    case 'i2':
      return view.getInt16(offset, little);
    case 'u2':
      return view.getUint16(offset, little);
    case 'i4':
      return view.getInt32(offset, little);
    case 'u4':
      return view.getUint32(offset, little);
    case 'f4':
      return view.getFloat32(offset, little);
    case 'f8':
      return view.getFloat64(offset, little);
  }
}

/** Column indices of required splat attributes in the vertex element. */
interface Columns {
  x: number;
  y: number;
  z: number;
  opacity: number;
  scale: [number, number, number];
  rot: [number, number, number, number];
}

function columnsOf(vertex: PlyElement): Columns {
  const at = (name: string) => vertex.properties.findIndex((property) => property.name === name);
  const columns: Columns = {
    x: at('x'),
    y: at('y'),
    z: at('z'),
    opacity: at('opacity'),
    scale: [at('scale_0'), at('scale_1'), at('scale_2')],
    rot: [at('rot_0'), at('rot_1'), at('rot_2'), at('rot_3')],
  };
  return columns;
}

/** Output buffer sized for every vertex; `count` points are filled. */
interface PackedOutput {
  data: Float32Array;
  index: Uint32Array;
  count: number;
}

/** Appends one vertex (its raw property values in `row`) when it is visible. */
function appendPoint(
  row: Float64Array,
  vertexIndex: number,
  columns: Columns,
  out: PackedOutput,
): void {
  const x = row[columns.x];
  const y = row[columns.y];
  const z = row[columns.z];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  const opacity = 1 / (1 + Math.exp(-row[columns.opacity]));
  if (!(opacity >= SPLAT_OPACITY_THRESHOLD)) return;
  const at = out.count * PACKED_SPLAT_STRIDE;
  const { data } = out;
  const { scale, rot } = columns;
  data[at] = x;
  data[at + 1] = y;
  data[at + 2] = z;
  data[at + 3] = opacity;
  for (let axis = 0; axis < 3; axis++) {
    const value = Math.exp(row[scale[axis]]);
    data[at + 4 + axis] = Number.isFinite(value) ? value : 0;
  }
  let w = 1;
  let qx = 0;
  let qy = 0;
  let qz = 0;
  const norm = Math.hypot(row[rot[0]], row[rot[1]], row[rot[2]], row[rot[3]]);
  if (norm > 0 && Number.isFinite(norm)) {
    w = row[rot[0]] / norm;
    qx = row[rot[1]] / norm;
    qy = row[rot[2]] / norm;
    qz = row[rot[3]] / norm;
  }
  data[at + 7] = w;
  data[at + 8] = qx;
  data[at + 9] = qy;
  data[at + 10] = qz;
  out.index[out.count++] = vertexIndex;
}

/** Reads the visible splats of a PLY at full precision, or null when it cannot (see above). */
export function readSplatPly(bytes: Uint8Array): PackedSplatPoints | null {
  const parsed = parsePlyHeader(bytes);
  if (!parsed.ok) return null;
  const { format, elements, bodyStart } = parsed.header;
  const vertex = elements.find((element) => element.name === 'vertex');
  if (!vertex) return null;
  const bodyLength = bytes.byteLength - bodyStart;
  if (
    elements.some((element) => element.count * Math.max(1, element.properties.length) > bodyLength)
  ) {
    return null;
  }
  let rowBytes = 0;
  for (const property of vertex.properties) {
    if (property.countType) return null;
    rowBytes += SIZES[property.type];
  }
  if (format !== 'ascii' && vertex.count * rowBytes > bodyLength) return null;
  const columns = columnsOf(vertex);
  const out: PackedOutput = {
    data: new Float32Array(vertex.count * PACKED_SPLAT_STRIDE),
    index: new Uint32Array(vertex.count),
    count: 0,
  };
  const row = new Float64Array(vertex.properties.length);

  if (format === 'ascii') {
    const text = new TextDecoder('ascii').decode(bytes.subarray(bodyStart));
    const tokens = text.split(/\s+/).filter(Boolean);
    let position = 0;
    for (const element of elements) {
      if (element === vertex) {
        if (position + element.count * element.properties.length > tokens.length) return null;
        for (let vertexIndex = 0; vertexIndex < element.count; vertexIndex++) {
          for (let column = 0; column < row.length; column++)
            row[column] = Number(tokens[position++]);
          appendPoint(row, vertexIndex, columns, out);
        }
        break;
      }
      position += element.count * element.properties.length;
    }
  } else {
    const little = format === 'binary_little_endian';
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = bodyStart;
    for (const element of elements) {
      if (element === vertex) {
        const offsets: number[] = [];
        let offsetWithinRow = 0;
        for (const property of element.properties) {
          offsets.push(offsetWithinRow);
          offsetWithinRow += SIZES[property.type];
        }
        if (offset + rowBytes * element.count > bytes.byteLength) return null;
        for (let vertexIndex = 0; vertexIndex < element.count; vertexIndex++) {
          const base = offset + vertexIndex * rowBytes;
          for (let column = 0; column < row.length; column++) {
            row[column] = readScalar(
              view,
              base + offsets[column],
              element.properties[column].type,
              little,
            );
          }
          appendPoint(row, vertexIndex, columns, out);
        }
        break;
      }
      for (const property of element.properties) offset += element.count * SIZES[property.type];
    }
  }
  if (!out.count) return null;
  return {
    data: out.data.slice(0, out.count * PACKED_SPLAT_STRIDE),
    index: out.index.slice(0, out.count),
  };
}

/** Reads the visible splats of a PLY or SPZ file, or null when it cannot. */
export function readSplatFile(bytes: Uint8Array): PackedSplatPoints | null {
  return splatFormatOf(bytes) === 'spz' ? readSplatSpz(bytes) : readSplatPly(bytes);
}

/**
 * Reads the visible splats of an SPZ (versions 2 and 3), or null when it cannot. Dequantization
 * follows the reference `nianticlabs/spz` loader with no coordinate-system conversion.
 */
export function readSplatSpz(bytes: Uint8Array): PackedSplatPoints | null {
  let raw: Uint8Array;
  try {
    raw = gunzipSync(bytes);
  } catch {
    return null;
  }
  const parsed = parseSpzHeader(raw);
  if (!parsed.ok) return null;
  const { header } = parsed;
  const layout = spzLayout(header);
  if (raw.byteLength < layout.end) return null;
  const n = header.numPoints;
  const positionScale = 1 / (1 << header.fractionalBits);
  const smallestThree = header.version === 3;
  const out: PackedOutput = {
    data: new Float32Array(n * PACKED_SPLAT_STRIDE),
    index: new Uint32Array(n),
    count: 0,
  };
  const q = [0, 0, 0, 0]; // x y z w
  for (let point = 0; point < n; point++) {
    const opacity = raw[layout.alphas + point] / 255;
    if (!(opacity >= SPLAT_OPACITY_THRESHOLD)) continue;
    const at = out.count * PACKED_SPLAT_STRIDE;
    const { data } = out;
    for (let axis = 0; axis < 3; axis++) {
      const p = layout.positions + 9 * point + 3 * axis;
      // 24-bit two's-complement fixed point.
      const fixed = ((raw[p] | (raw[p + 1] << 8) | (raw[p + 2] << 16)) << 8) >> 8;
      data[at + axis] = fixed * positionScale;
      data[at + 4 + axis] = Math.exp(raw[layout.scales + 3 * point + axis] / 16 - 10);
    }
    data[at + 3] = opacity;
    if (smallestThree) {
      const r = layout.rotations + 4 * point;
      let comp = (raw[r] | (raw[r + 1] << 8) | (raw[r + 2] << 16) | (raw[r + 3] << 24)) >>> 0;
      const largest = comp >>> 30;
      let sumSquares = 0;
      for (let i = 3; i >= 0; i--) {
        if (i === largest) continue;
        const magnitude = (Math.SQRT1_2 * (comp & 511)) / 511;
        q[i] = (comp >>> 9) & 1 ? -magnitude : magnitude;
        sumSquares += q[i] * q[i];
        comp >>>= 10;
      }
      q[largest] = Math.sqrt(Math.max(0, 1 - sumSquares));
    } else {
      const r = layout.rotations + 3 * point;
      for (let i = 0; i < 3; i++) q[i] = raw[r + i] / 127.5 - 1;
      q[3] = Math.sqrt(Math.max(0, 1 - q[0] * q[0] - q[1] * q[1] - q[2] * q[2]));
    }
    const norm = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    data[at + 7] = q[3] / norm;
    data[at + 8] = q[0] / norm;
    data[at + 9] = q[1] / norm;
    data[at + 10] = q[2] / norm;
    out.index[out.count++] = point;
  }
  if (!out.count) return null;
  return {
    data: out.data.slice(0, out.count * PACKED_SPLAT_STRIDE),
    index: out.index.slice(0, out.count),
  };
}

/** Expands packed points into the objects the collision derivation consumes. */
export function unpackSplatPoints({ data, index }: PackedSplatPoints): SplatPoint[] {
  const points: SplatPoint[] = new Array(index.length);
  for (let point = 0; point < index.length; point++) {
    const at = point * PACKED_SPLAT_STRIDE;
    points[point] = {
      index: index[point],
      x: data[at],
      y: data[at + 1],
      z: data[at + 2],
      opacity: data[at + 3],
      sx: data[at + 4],
      sy: data[at + 5],
      sz: data[at + 6],
      qw: data[at + 7],
      qx: data[at + 8],
      qy: data[at + 9],
      qz: data[at + 10],
    };
  }
  return points;
}
