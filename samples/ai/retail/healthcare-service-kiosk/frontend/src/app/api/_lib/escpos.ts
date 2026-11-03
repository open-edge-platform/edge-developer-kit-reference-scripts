// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// The default export's `raw` returns the bar pattern; the ES build's named `raw` is the "raw" symbology.
import bwipjs from "bwip-js/node";

/**
 * Just enough ESC/POS for a ticket: text, alignment, emphasis, a Code 128
 * and the cut. Barcodes go out as raster images (GS v 0) rather than the
 * printer's own GS k: every ESC/POS printer takes a raster, and only a raster
 * can be turned along the paper when the code is too long to fit across it.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** Font A is 12 dots wide on every 203 dpi printer: 48 columns on 80 mm paper, 32 on 58 mm. */
const FONT_A_DOTS = 12;

/**
 * Bar widths at 203 dpi, widest first: 0.375 mm is the printers' default and
 * reads at any angle; 0.25 mm (the usual 10 mil) still reads on a laser
 * scanner, and lets a code fit across 58 mm paper.
 */
const MODULE_DOTS = [3, 2];
/** Code 128 asks for ten modules of white either side. */
const QUIET_MODULES = 10;
/** Bands of raster rows: cheap printers drop an image taller than their buffer. */
const BAND_ROWS = 128;

export type Align = "left" | "center";

/** The printer's built-in font is ASCII only: accents dropped, anything else a "?". */
export function printable(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e\n]/g, "?");
}

export class Ticket {
  private readonly parts: Buffer[] = [Buffer.from([ESC, 0x40])];

  /** `widthDots`: the printable width — 576 on 80 mm paper, 384 on 58 mm. */
  constructor(readonly widthDots: number) {}

  get columns(): number {
    return Math.floor(this.widthDots / FONT_A_DOTS);
  }

  private bytes(...values: number[]): this {
    this.parts.push(Buffer.from(values));
    return this;
  }

  align(align: Align): this {
    return this.bytes(ESC, 0x61, align === "center" ? 1 : 0);
  }

  /** One line, wrapped at the column count of its size; `large` doubles height and width. */
  line(text = "", { bold = false, large = false, tall = false }: { bold?: boolean; large?: boolean; tall?: boolean } = {}): this {
    const columns = large ? Math.floor(this.columns / 2) : this.columns;
    this.bytes(ESC, 0x45, bold ? 1 : 0, GS, 0x21, (large ? 0x10 : 0) | (large || tall ? 0x01 : 0));
    for (const row of wrap(printable(text), columns)) this.parts.push(Buffer.from(`${row}\n`, "ascii"));
    return this.bytes(ESC, 0x45, 0, GS, 0x21, 0);
  }

  /** A label and its value, the value wrapped under itself. */
  pair(label: string, value: string, labelColumns = 11): this {
    const rows = wrap(printable(value), this.columns - labelColumns);
    const lines = rows.map((row, index) => (index === 0 ? printable(label) : "").padEnd(labelColumns) + row);
    this.parts.push(Buffer.from(`${lines.join("\n")}\n`, "ascii"));
    return this;
  }

  /** A rule across the paper. */
  rule(): this {
    return this.line("-".repeat(this.columns));
  }

  feed(lines = 1): this {
    return this.bytes(ESC, 0x64, lines);
  }

  /**
   * A Code 128 across the paper at the widest bar width that fits it, else
   * turned to run down it. `barDots` is the bar length — its height when across.
   */
  code128(text: string, barDots: number): this {
    const modules = barcodeModules(text);
    const fit = MODULE_DOTS.find((dots) => modules.length * dots <= this.widthDots);
    const across = fit !== undefined;
    const moduleDots = fit ?? MODULE_DOTS[0];
    const length = modules.length * moduleDots;
    const width = across ? length : Math.min(barDots, this.widthDots);
    const height = across ? barDots : length;
    const rowBytes = Math.ceil(this.widthDots / 8);
    const left = Math.floor((this.widthDots - width) / 2);
    const image = Buffer.alloc(rowBytes * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!modules[Math.floor((across ? x : y) / moduleDots)]) continue;
        const dot = left + x;
        image[y * rowBytes + (dot >> 3)] |= 0x80 >> (dot & 7);
      }
    }
    // Full paper width, centred within: alignment cannot shift it.
    for (let top = 0; top < height; top += BAND_ROWS) {
      const rows = Math.min(BAND_ROWS, height - top);
      this.bytes(GS, 0x76, 0x30, 0, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8);
      this.parts.push(image.subarray(top * rowBytes, (top + rows) * rowBytes));
    }
    return this;
  }

  /** Feeds past the cutter and makes a partial cut (GS V 66). */
  cut(): this {
    return this.bytes(GS, 0x56, 66, 0);
  }

  build(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/** True for each black module, quiet zones included. */
function barcodeModules(text: string): boolean[] {
  const [symbol] = bwipjs.raw({ bcid: "code128", text });
  if (!symbol || !("sbs" in symbol)) throw new Error("bwip-js returned no Code 128 pattern");
  const modules: boolean[] = Array(QUIET_MODULES).fill(false);
  // Space-bar widths alternate bar, space, bar… in modules.
  symbol.sbs.forEach((width, index) => modules.push(...Array<boolean>(width).fill(index % 2 === 0)));
  return modules.concat(Array(QUIET_MODULES).fill(false));
}

function wrap(text: string, columns: number): string[] {
  const rows: string[] = [];
  for (const paragraph of text.split("\n")) {
    let row = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      for (let piece = word; piece; piece = piece.slice(columns)) {
        const chunk = piece.slice(0, columns);
        if (row && row.length + 1 + chunk.length > columns) {
          rows.push(row);
          row = "";
        }
        row = row ? `${row} ${chunk}` : chunk;
      }
    }
    rows.push(row);
  }
  return rows;
}
