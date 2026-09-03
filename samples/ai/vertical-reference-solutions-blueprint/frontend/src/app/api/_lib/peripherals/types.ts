// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceHealth } from "../health";

/** auto: stand in only for a failure the hardware never attempted; always: never touch it;
 *  never: no stand-in, the citizen is told what went wrong. */
export type SimulatePolicy = "auto" | "always" | "never";

/** `attempted` false means the read/scan never happened (no bindings, daemon or device), so a
 *  stand-in is honest under `auto`; true means the device answered. */
export class PeripheralError<R extends string = string> extends Error {
  constructor(
    readonly reason: R,
    message: string,
    readonly attempted: boolean,
  ) {
    super(message);
    this.name = "PeripheralError";
  }
}

/** Should this failure fall back to a stand-in, under this policy? */
export function shouldStandIn(policy: SimulatePolicy, error: PeripheralError): boolean {
  if (policy === "never") return false;
  return policy === "always" || !error.attempted;
}

export interface PeripheralDriver {
  /** Driver id as configured ("pcsc", "sane", "mock"). */
  readonly id: string;
  readonly kind: "nfc" | "scanner";
  /** Report-only: "off" when this terminal never touches the device. Never takes it out of service. */
  health(): Promise<ServiceHealth>;
}

/** One profile per supported scanner model; `documents.scanner.profile` picks it. */
export type ScannerStatusProfile = {
  id: string;
  /** Tool that prints the status word; "" means every capture scans immediately. */
  statusBin: string;
  /** Bit meaning in the status word. */
  bits: {
    chuteEmpty: number;
    coverOpen: number;
    adfDocumentLoaded: number;
    returnPathOccupied: number;
  };
  documentLoaded(status: number): boolean;
};
