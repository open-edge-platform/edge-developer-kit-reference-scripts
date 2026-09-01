#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Draw the app icon Tauri needs, without pulling in an image library.
 *
 * Tauri wants a fixed set of sizes plus a .ico; the artwork is a kiosk
 * terminal — a screen on a stand. Replace the PNGs with real artwork whenever
 * there is some (`npx tauri icon path/to/icon.png` regenerates every size,
 * including the macOS .icns this script skips).
 */
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ICONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");

const BACKDROP = [0x12, 0x19, 0x2b, 0xff];
const SCREEN_TOP = [0x6f, 0x9b, 0xff, 0xff];
const SCREEN_BOTTOM = [0x4a, 0x6f, 0xe8, 0xff];
const GLYPH = [0xf5, 0xf8, 0xff, 0xff];

/** 3x3 supersampling — enough to keep the rounded corners from stepping. */
const SAMPLES = 3;

function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = (x + (sx + 0.5) / SAMPLES) / size;
          const v = (y + (sy + 0.5) / SAMPLES) / size;
          const sample = shade(u, v);
          r += sample[0]; g += sample[1]; b += sample[2]; a += sample[3];
        }
      }
      const n = SAMPLES * SAMPLES;
      pixels.set([r / n, g / n, b / n, a / n].map(Math.round), (y * size + x) * 4);
    }
  }
  return pixels;
}

/** Colour at one point of the icon, in 0..1 coordinates. */
function shade(u, v) {
  if (!inRoundedRect(u, v, 0.03, 0.03, 0.94, 0.94, 0.2)) return [0, 0, 0, 0];

  // The stand: a neck under the screen, widening into a foot.
  const neck = u > 0.45 && u < 0.55 && v > 0.68 && v < 0.8;
  const foot = inRoundedRect(u, v, 0.3, 0.78, 0.4, 0.055, 0.027);
  if (neck || foot) return GLYPH;

  if (inRoundedRect(u, v, 0.18, 0.2, 0.64, 0.48, 0.06)) {
    // Screen, lit from the top.
    const t = (v - 0.2) / 0.48;
    return SCREEN_TOP.map((channel, i) => channel + (SCREEN_BOTTOM[i] - channel) * t);
  }
  return BACKDROP;
}

function inRoundedRect(u, v, x, y, w, h, radius) {
  if (u < x || u > x + w || v < y || v > y + h) return false;
  const dx = Math.max(x + radius - u, u - (x + w - radius), 0);
  const dy = Math.max(y + radius - v, v - (y + h - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/* -- PNG ------------------------------------------------------------------ */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   // bit depth
  header[9] = 6;   // colour type: RGBA
  // 10..12: deflate, adaptive filtering, no interlace — all zero.

  // One filter byte per scanline; "none" is fine for artwork this flat.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An .ico is a directory of images; since Vista each may simply be a PNG. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[4] = 1;                       // colour planes
    entry.writeUInt16LE(32, 6);         // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

/* -- output --------------------------------------------------------------- */

const FILES = {
  "32x32.png": 32,
  "128x128.png": 128,
  "128x128@2x.png": 256,
  "icon.png": 512,
};

const cache = new Map();
const render = (size) => {
  if (!cache.has(size)) cache.set(size, png(size, draw(size)));
  return cache.get(size);
};

await fs.mkdir(ICONS, { recursive: true });

if (process.argv.includes("--force") || !(await exists(path.join(ICONS, "icon.png")))) {
  for (const [name, size] of Object.entries(FILES)) {
    await fs.writeFile(path.join(ICONS, name), render(size));
  }
  await fs.writeFile(
    path.join(ICONS, "icon.ico"),
    ico([16, 32, 48, 256].map((size) => ({ size, data: render(size) }))),
  );
  console.log(`  \x1b[2micons written to ${path.relative(process.cwd(), ICONS)}\x1b[0m`);
}

async function exists(file) {
  return fs.access(file).then(() => true, () => false);
}
