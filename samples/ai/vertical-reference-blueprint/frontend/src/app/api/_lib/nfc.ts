// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Card, Client, Err, Reader, ReaderStatusFlags } from "pcsc-mini";
import { t } from "@/lib/i18n";
import { nfcSimulatePolicy } from "./peripherals/policy";
import { PeripheralError } from "./peripherals/types";

/** PC/SC pseudo-APDU for the card serial: FF CA 00 00 00 -> <UID> 90 00. */
const UID_COMMAND = process.env.KIOSK_NFC_UID_COMMAND ?? "FFCA000000";
const TIMEOUT_MS = Number(process.env.KIOSK_NFC_TIMEOUT_MS ?? 30_000);
/** Substring match against the driver's reader name; unset uses any reader. */
const READER_NAME = process.env.KIOSK_NFC_READER?.trim();

export type CardRead = {
  /** Uppercase hex, no separators (e.g. "04A2B3C4D5E6"). */
  uid: string;
  atr: string;
  reader: string;
  /** UID is the ATR, not a serial: identifies a card model, so never bind it to a citizen. */
  fromAtr: boolean;
};

/** The first three mean the read never ran; the last two mean the hardware answered. */
export type NfcFailure =
  | "unsupported"
  | "no_service"
  | "no_reader"
  | "timeout"
  | "read_failed";

const NOT_ATTEMPTED = new Set<NfcFailure>(["unsupported", "no_service", "no_reader"]);

export class NfcError extends PeripheralError<NfcFailure> {
  constructor(reason: NfcFailure, message: string) {
    super(reason, message, !NOT_ATTEMPTED.has(reason));
    this.name = "NfcError";
  }
}

export function shouldSimulate(reason: NfcFailure): boolean {
  const policy = nfcSimulatePolicy();
  if (policy === "never") return false;
  return policy === "always" || NOT_ATTEMPTED.has(reason);
}

export const nfcSimulatedAlways = () => nfcSimulatePolicy() === "always";

export const NFC_FAILURE_MESSAGE: Record<NfcFailure, string> = {
  unsupported: t("nfcFailure.unsupported"),
  no_service: t("nfcFailure.no_service"),
  no_reader: t("nfcFailure.no_reader"),
  timeout: t("nfcFailure.timeout"),
  read_failed: t("nfcFailure.read_failed"),
};

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();

function apdu(command: string): Uint8Array {
  const clean = command.replace(/[^0-9a-fA-F]/g, "");
  const bytes = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** `MOCK` is not valid hex, which keeps a simulated UID out of the registry's `nfcUid`. */
export const simulatedUid = (citizenKey: number): string =>
  `MOCK${citizenKey.toString(16).padStart(8, "0").toUpperCase()}`;

/** Kept on globalThis: a second monitor over the same reader breaks reads after hot reload. */
type Monitor = {
  client: Client;
  readers: Map<string, Reader>;
  occupied: Set<string>;
  present: CardRead | null;
  waiting: Set<(card: CardRead) => void>;
};

const MONITOR = Symbol.for("kiosk.nfc.monitor");
const STARTING = Symbol.for("kiosk.nfc.starting");
type Global = { [MONITOR]?: Monitor; [STARTING]?: Promise<Monitor> };

async function bindings(): Promise<typeof import("pcsc-mini")> {
  try {
    return await import("pcsc-mini");
  } catch (error) {
    throw new NfcError(
      "unsupported",
      `pcsc-mini bindings are not available: ${(error as Error).message}`,
    );
  }
}

const wanted = (name: string) =>
  !READER_NAME || name.toLowerCase().includes(READER_NAME.toLowerCase());

async function readCard(
  reader: Reader,
  atr: Uint8Array,
  pcsc: typeof import("pcsc-mini"),
): Promise<CardRead> {
  let card: Card | undefined;
  try {
    card = await reader.connect(pcsc.CardMode.SHARED);
    const res = await card.transmit(apdu(UID_COMMAND));
    // Last two bytes are the status word: 90 00 is success, 6A 81 means no serial.
    const ok = res.length > 2 && res[res.length - 2] === 0x90 && res[res.length - 1] === 0x00;
    if (ok) {
      return { uid: hex(res.subarray(0, -2)), atr: hex(atr), reader: reader.name(), fromAtr: false };
    }
    if (atr.length === 0) {
      throw new NfcError("read_failed", `card answered ${hex(res)} and reported no ATR`);
    }
    return { uid: hex(atr), atr: hex(atr), reader: reader.name(), fromAtr: true };
  } catch (error) {
    if (error instanceof NfcError) throw error;
    throw new NfcError("read_failed", (error as Err).message);
  } finally {
    // LEAVE, not RESET: powering the card down under the citizen's hand fails the next read.
    if (card) await card.disconnect(pcsc.CardDisposition.LEAVE).catch(() => {});
  }
}

/** Answers waiting reads, but only remembers the card while it is still on the pad. */
function announce(monitor: Monitor, card: CardRead, stillThere: boolean): void {
  if (stillThere) monitor.present = card;
  const waiting = [...monitor.waiting];
  monitor.waiting.clear();
  for (const resolve of waiting) resolve(card);
}

function watch(monitor: Monitor, reader: Reader, pcsc: typeof import("pcsc-mini")): void {
  const { ReaderStatus } = pcsc;

  reader.on("change", (status: ReaderStatusFlags, atr: Uint8Array) => {
    const name = reader.name();
    if (!status.has(ReaderStatus.PRESENT)) {
      monitor.occupied.delete(name);
      if (monitor.present?.reader === name) monitor.present = null;
      return;
    }
    monitor.occupied.add(name);
    // MUTE is a card that will not talk; IN_USE is one another process holds.
    if (status.hasAny(ReaderStatus.MUTE, ReaderStatus.IN_USE)) return;

    readCard(reader, atr, pcsc)
      .then((card) => announce(monitor, card, monitor.occupied.has(name)))
      // A card half off the pad should not fail a waiting read; let it time out instead.
      .catch((error) => console.warn(`[nfc] ${name}: ${(error as Error).message}`));
  });

  reader.on("disconnect", () => {
    const name = reader.name();
    monitor.readers.delete(name);
    monitor.occupied.delete(name);
    if (monitor.present?.reader === name) monitor.present = null;
  });
}

/** The in-flight promise is kept too, so concurrent cold reads share one client. */
function monitor(): Promise<Monitor> {
  const globals = globalThis as Global;
  const existing = globals[MONITOR];
  if (existing?.client.running()) return Promise.resolve(existing);
  return (globals[STARTING] ??= start().finally(() => delete globals[STARTING]));
}

async function start(): Promise<Monitor> {
  const globals = globalThis as Global;
  const pcsc = await bindings();
  const started: Monitor = {
    client: new pcsc.Client(),
    readers: new Map(),
    occupied: new Set(),
    present: null,
    waiting: new Set(),
  };

  started.client.on("reader", (reader: Reader) => {
    if (!wanted(reader.name())) return;
    started.readers.set(reader.name(), reader);
    watch(started, reader, pcsc);
  });
  started.client.on("error", (error: Err) => {
    console.warn(`[nfc] reader monitoring stopped: ${error.message} (${error.code})`);
    started.client.stop();
  });

  try {
    started.client.start();
  } catch (error) {
    const code = (error as Err).code ?? "";
    throw new NfcError(
      /noservice/i.test(code) ? "no_service" : "unsupported",
      `could not attach to the PC/SC service: ${(error as Error).message}`,
    );
  }

  globals[MONITOR] = started;
  // Readers are reported on the monitoring thread; a just-started client has not seen them yet.
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 50));
  return started;
}

/** Resolves at once when a card is already on the reader, else waits up to `timeoutMs`.
 *  @throws {@link NfcError} */
export async function readCardUid({ timeoutMs = TIMEOUT_MS } = {}): Promise<CardRead> {
  if (nfcSimulatedAlways()) {
    throw new NfcError(
      "unsupported",
      "the card reader is switched off (nfc.driver: mock or nfc.simulate: always)",
    );
  }

  const running = await monitor();
  if (running.readers.size === 0) {
    throw new NfcError(
      "no_reader",
      READER_NAME
        ? `no card reader matching "${READER_NAME}" is connected`
        : "no card reader is connected",
    );
  }
  if (running.present) return running.present;

  return new Promise<CardRead>((resolve, reject) => {
    const done = (card: CardRead) => {
      clearTimeout(timer);
      resolve(card);
    };
    const timer = setTimeout(() => {
      running.waiting.delete(done);
      reject(new NfcError("timeout", `no card was presented within ${timeoutMs}ms`));
    }, timeoutMs);
    running.waiting.add(done);
  });
}

export async function nfcReaders(): Promise<string[]> {
  if (nfcSimulatedAlways()) return [];
  return [...(await monitor()).readers.keys()];
}
