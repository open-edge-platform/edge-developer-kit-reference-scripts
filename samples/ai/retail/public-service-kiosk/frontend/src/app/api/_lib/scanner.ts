// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "child_process";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";
import PDFDocument from "pdfkit";
import { delay } from "./http";
import { readMockDocument } from "./mock-documents";
import { scannerSimulatePolicy } from "./peripherals/policy";
import { scannerStatusProfile } from "./peripherals/scanner-profiles";
import { PeripheralError, shouldStandIn } from "./peripherals/types";
import type { Reporter } from "./progress";

/** Only binaries on this list are ever executed — the env can pick one of
 *  them by name (resolved via PATH), never point at an arbitrary path. */
const ALLOWED_BINS = ["scanimage"];
const BIN =
  ALLOWED_BINS.find(
    (allowed) => allowed === path.basename(process.env.KIOSK_SCANNER_BIN ?? ""),
  ) ?? "scanimage";
const DEVICE = process.env.KIOSK_SCANNER_DEVICE;
const RESOLUTION = process.env.KIOSK_SCANNER_RESOLUTION;
const MODE = process.env.KIOSK_SCANNER_MODE;
const SOURCE = process.env.KIOSK_SCANNER_SOURCE;
const EXTRA_ARGS = process.env.KIOSK_SCANNER_ARGS;
const TIMEOUT_MS = Number(process.env.KIOSK_SCANNER_TIMEOUT_MS ?? 120_000);
const STATUS_ARGS = (process.env.KIOSK_SCANNER_STATUS_ARGS ?? "").split(/\s+/).filter(Boolean);
/** How long the citizen has to feed a page in; 0 skips waiting entirely. */
const WAIT_MS = Number(process.env.KIOSK_SCANNER_WAIT_MS ?? 30_000);
/** Never below 1s: the driver manual warns more frequent status reads load the system heavily. */
const POLL_MS = Math.max(Number(process.env.KIOSK_SCANNER_POLL_MS ?? 2_000), 1_000);
const STATUS_TIMEOUT_MS = 5_000;

/** scanimage's batch pattern: %d is the page number, from 1 up. */
const PAGE_PATTERN = "page-%d.jpg";

/** Pixels scaled to points; unset resolution means the backend default of 300 dpi. */
const POINTS_PER_INCH = 72;
const SCAN_DPI = Number(RESOLUTION) || 300;

const exec = promisify(execFile);

export type ScannedDocument = {
  fileName: string;
  bytes: Buffer;
  simulated: boolean;
};

/** The scanner answered with no paper (empty feeder, open cover): never stood in for. */
class NothingToScanError extends PeripheralError<"nothing_to_scan"> {
  constructor(message: string) {
    super("nothing_to_scan", message, true);
    this.name = "NothingToScanError";
  }
}

export const scannerEnabled = () =>
  process.env.NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE === "scanner";

/** Only proves `scanimage` is installed — enumerating SANE devices is too slow for a poll. */
export async function scannerBinaryAvailable(): Promise<boolean> {
  try {
    await exec(BIN, ["--version"], { timeout: STATUS_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/** Only options actually set are passed: an option the backend never heard of fails the scan. */
function scanArgs(dir: string): string[] {
  const args = [...(DEVICE ? ["-d", DEVICE] : []), "--format=jpeg"];
  if (RESOLUTION) args.push("--resolution", RESOLUTION);
  if (MODE) args.push("--mode", MODE);
  if (SOURCE) args.push("--source", SOURCE);
  if (EXTRA_ARGS) args.push(...EXTRA_ARGS.split(/\s+/).filter(Boolean));
  return [...args, `--batch=${path.join(dir, PAGE_PATTERN)}`];
}

/** The status word out of the tool's output: "0x80000001" -> 2147483649. */
function parseStatus(output: string): number | null {
  const hex = output.match(/0x([0-9a-f]+)/i);
  if (hex) return Number.parseInt(hex[1], 16);
  const decimal = output.match(/\d+/);
  return decimal ? Number.parseInt(decimal[0], 10) : null;
}

/** The configured status tool, else the model profile's; "" means paper cannot be asked about. */
const statusBin = (): string =>
  process.env.KIOSK_SCANNER_STATUS_BIN ?? scannerStatusProfile().statusBin;

export async function readStatus(): Promise<number | null> {
  const bin = statusBin();
  if (!bin) return null;
  try {
    const { stdout } = await exec(bin, STATUS_ARGS, { timeout: STATUS_TIMEOUT_MS });
    return parseStatus(stdout);
  } catch {
    // No status tool installed, or it failed: the scan itself is the check.
    return null;
  }
}

/** Wait for paper before scanning; "unknown" means the scanner could not be asked. */
async function waitForDocument(
  report: Reporter,
): Promise<"loaded" | "empty" | "cover-open" | "unknown"> {
  if (!(WAIT_MS > 0)) return "unknown";
  const profile = scannerStatusProfile();
  report("waiting");
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const status = await readStatus();
    if (status === null) return "unknown";
    if (profile.documentLoaded(status)) return "loaded";
    if ((status & profile.bits.coverOpen) !== 0) return "cover-open";
    if (Date.now() >= deadline) return "empty";
    await delay(Math.min(POLL_MS, Math.max(deadline - Date.now(), 0)));
  }
}

/** A batch run ends in an "out of documents" error *after* writing every page, so pages win. */
function runScanimage(dir: string): Promise<Error | null> {
  return new Promise((resolve) => {
    execFile(BIN, scanArgs(dir), { timeout: TIMEOUT_MS }, (error, _stdout, stderr) => {
      if (!error) return resolve(null);
      const detail = String(stderr).trim().split("\n").pop() || error.message;
      resolve(new Error(`scanimage failed: ${detail}`));
    });
  });
}

/** `page-10.jpg` -> 10, so pages sort in feed order rather than as text. */
function pageNumber(name: string): number {
  return Number.parseInt(name.replace(/\D+/g, ""), 10) || 0;
}

async function scanPages(report: Reporter): Promise<Buffer[]> {
  const ready = await waitForDocument(report);
  if (ready === "empty") {
    throw new NothingToScanError(
      `nothing was fed into the scanner within ${Math.round(WAIT_MS / 1000)} seconds`,
    );
  }
  if (ready === "cover-open") {
    throw new NothingToScanError("the scanner's cover is open — close it and try again");
  }
  const dir = await mkdtemp(path.join(tmpdir(), "kiosk-scan-"));
  try {
    report("scanning");
    const failure = await runScanimage(dir);
    const names = (await readdir(dir))
      .filter((name) => name.endsWith(".jpg"))
      .sort((a, b) => pageNumber(a) - pageNumber(b));
    // A backend can also exit 0 having written nothing, e.g. an empty feeder.
    if (!names.length) throw failure ?? new Error("the scanner produced no page");
    return await Promise.all(names.map((name) => readFile(path.join(dir, name))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** `openImage` reads a JPEG's pixel size; @types/pdfkit does not declare it. */
type ImageReader = { openImage(src: Buffer): { width: number; height: number } };

/** Each page is cut to its JPEG's own size and embedded without re-encoding. */
function toPdf(pages: Buffer[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ autoFirstPage: false });
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    const scale = POINTS_PER_INCH / SCAN_DPI;
    for (const page of pages) {
      const image = (pdf as unknown as ImageReader).openImage(page);
      const width = image.width * scale;
      const height = image.height * scale;
      pdf.addPage({ size: [width, height], margin: 0 });
      pdf.image(page, 0, 0, { width, height });
    }
    pdf.end();
  });
}

async function simulateScan(
  serviceId: string,
  requirementId: string,
  report: Reporter,
): Promise<ScannedDocument> {
  const mock = await readMockDocument(serviceId, requirementId);
  if (!mock) throw new Error("no scanner is attached and no stand-in document is available");
  report("scanning");
  // Stand in for the seconds a real scan would take.
  await delay();
  return { fileName: mock.fileName, bytes: mock.bytes, simulated: true };
}

/** `report` drives the on-screen progress of a capture that can run for a minute. */
export async function captureDocument(
  serviceId: string,
  requirementId: string,
  report: Reporter = () => {},
): Promise<ScannedDocument> {
  const policy = scannerSimulatePolicy();
  if (policy === "always") return simulateScan(serviceId, requirementId, report);
  try {
    const pages = await scanPages(report);
    report("packing");
    return { fileName: `scan-${Date.now()}.pdf`, bytes: await toPdf(pages), simulated: false };
  } catch (error) {
    // A scanner that reported itself empty is working, so the citizen is asked again.
    const failure =
      error instanceof PeripheralError
        ? error
        : new PeripheralError("scan_failed", (error as Error).message, false);
    if (!shouldStandIn(policy, failure)) throw error;
    return simulateScan(serviceId, requirementId, report);
  }
}
