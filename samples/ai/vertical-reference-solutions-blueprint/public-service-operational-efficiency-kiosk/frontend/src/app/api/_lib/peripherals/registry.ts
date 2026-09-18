// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceHealth } from "../health";
import { nfcReaders } from "../nfc";
import { readStatus, scannerBinaryAvailable, scannerEnabled } from "../scanner";
import { nfcDriverId, nfcSimulatePolicy, scannerDriverId, scannerSimulatePolicy } from "./policy";
import type { PeripheralDriver } from "./types";

/** Report-only: a dead peripheral shows up in diagnostics but never takes the kiosk out of service. */

const nfc: PeripheralDriver = {
  get id() {
    return nfcDriverId();
  },
  kind: "nfc",
  async health(): Promise<ServiceHealth> {
    if (nfcSimulatePolicy() === "always") return "off";
    try {
      return (await nfcReaders()).length > 0 ? "ok" : "unreachable";
    } catch {
      return "unreachable";
    }
  },
};

const scanner: PeripheralDriver = {
  get id() {
    return scannerDriverId();
  },
  kind: "scanner",
  async health(): Promise<ServiceHealth> {
    if (!scannerEnabled() || scannerSimulatePolicy() === "always") return "off";
    // The status tool answering proves a device is attached; without one, an installed
    // scanimage is the most this can honestly report.
    if ((await readStatus()) !== null) return "ok";
    return (await scannerBinaryAvailable()) ? "ok" : "unreachable";
  },
};

export const nfcPeripheral = () => nfc;
export const scannerPeripheral = () => scanner;
