// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { execFile } from "child_process";
import { createReadStream, existsSync } from "fs";
import { promisify } from "util";
import type { ServiceHealth } from "./health";

/** hid: a keyboard-wedge scanner typing into the kiosk page; serial: a USB-CDC scanner the server reads; mock: no scanner. */
export type BarcodeDriverId = "hid" | "serial" | "mock";

export function barcodeDriverId(): BarcodeDriverId {
  const id = process.env.KIOSK_BARCODE_DRIVER?.trim().toLowerCase();
  return id === "serial" || id === "mock" ? id : "hid";
}

const device = () => process.env.KIOSK_BARCODE_DEVICE?.trim() || "/dev/ttyACM0";

/** A scan nobody collected within this window belonged to someone who walked away. */
const PENDING_TTL_MS = 60_000;

type Inbox = {
  pending: { code: string; at: number } | null;
  waiting: Set<(code: string) => void>;
  serial: { device: string; retryAt: number } | null;
};

const INBOX = Symbol.for("kiosk.barcode.inbox");
type Global = { [INBOX]?: Inbox };

function inbox(): Inbox {
  const globals = globalThis as Global;
  return (globals[INBOX] ??= { pending: null, waiting: new Set(), serial: null });
}

/** Hands a scanned code to whoever is waiting, or holds it briefly for the next reader. */
export function presentCode(code: string): void {
  const box = inbox();
  const waiting = [...box.waiting];
  box.waiting.clear();
  if (waiting.length === 0) {
    box.pending = { code, at: Date.now() };
    return;
  }
  box.pending = null;
  for (const resolve of waiting) resolve(code);
}

export function takePendingCode(): string | null {
  const box = inbox();
  const pending = box.pending;
  box.pending = null;
  return pending && Date.now() - pending.at < PENDING_TTL_MS ? pending.code : null;
}

/** The next scan, or null when `timeoutMs` passes or `signal` aborts first. */
export function waitForCode(timeoutMs: number, signal?: AbortSignal): Promise<string | null> {
  ensureSerialReader();
  const ready = takePendingCode();
  if (ready) return Promise.resolve(ready);
  const box = inbox();
  return new Promise((resolve) => {
    const finish = (code: string | null) => {
      clearTimeout(timer);
      box.waiting.delete(onCode);
      signal?.removeEventListener("abort", onAbort);
      resolve(code);
    };
    const onCode = (code: string) => finish(code);
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    box.waiting.add(onCode);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

const exec = promisify(execFile);
const SERIAL_RETRY_MS = 5_000;

/** Starts reading a USB-CDC scanner once; a missing device is retried on the next wait. */
function ensureSerialReader(): void {
  if (barcodeDriverId() !== "serial") return;
  const box = inbox();
  const path = device();
  if (box.serial && (box.serial.device === path || Date.now() < box.serial.retryAt)) return;
  box.serial = { device: path, retryAt: Date.now() + SERIAL_RETRY_MS };
  if (!existsSync(path)) {
    console.warn(`[barcode] ${path} is not present`);
    box.serial = { device: "", retryAt: Date.now() + SERIAL_RETRY_MS };
    return;
  }
  // Raw mode: a cooked tty holds bytes back until a newline and echoes them to the scanner.
  exec("stty", ["-F", path, "raw", "-echo"])
    .catch((error) => console.warn(`[barcode] stty ${path}: ${(error as Error).message}`))
    .finally(() => {
      let buffer = "";
      const stream = createReadStream(path, { encoding: "latin1" });
      stream.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/[\r\n]+/);
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) presentCode(line.trim());
      });
      stream.on("error", (error) => {
        console.warn(`[barcode] ${path}: ${error.message}`);
        box.serial = { device: "", retryAt: Date.now() + SERIAL_RETRY_MS };
      });
      stream.on("close", () => {
        box.serial = { device: "", retryAt: Date.now() + SERIAL_RETRY_MS };
      });
    });
}

/** Report-only, like the card reader. A keyboard-wedge scanner is invisible to the server. */
export async function barcodeHealth(): Promise<ServiceHealth> {
  switch (barcodeDriverId()) {
    case "mock":
      return "off";
    case "serial":
      return existsSync(device()) ? "ok" : "unreachable";
    default:
      return "ok";
  }
}
