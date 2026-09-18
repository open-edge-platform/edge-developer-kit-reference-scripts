// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// What the citizen is asked to do with their card — `nfc.gesture` in config.yaml.
// Read in the browser and on the server, so it goes through public-config.
import { t } from "@/lib/i18n";
import { publicEnv } from "@/lib/public-config";

export type IdGesture = "insert" | "tap";

export const idGesture = (): IdGesture =>
  publicEnv("NEXT_PUBLIC_KIOSK_ID_GESTURE") === "tap" ? "tap" : "insert";

export type IdReaderCopy = {
  /** Headline on the touch kiosk's reader screen. */
  title: string;
  /** The detail under it. */
  detail: string;
  /** The same instruction as the assistant says it. */
  spoken: string;
  /** Nothing reached the reader: put it there, and leave it there. */
  hold: string;
  /** A card was there and could not be read: seat it again. */
  reseat: string;
  /** The read succeeded — the card has done its job, take it back. */
  remove: string;
  /** The citizen's own confirmation, in the assistant's reply buttons. */
  confirm: string;
  /** Where the hardware is, for the "I can't find it" help text. */
  where: string;
};

const gestureCopy = (gesture: IdGesture): IdReaderCopy => ({
  title: t(`idReader.${gesture}.title`),
  detail: t(`idReader.${gesture}.detail`),
  spoken: t(`idReader.${gesture}.spoken`),
  hold: t(`idReader.${gesture}.hold`),
  reseat: t(`idReader.${gesture}.reseat`),
  remove: t(`idReader.${gesture}.remove`),
  confirm: t(`idReader.${gesture}.confirm`),
  where: t(`idReader.${gesture}.where`),
});

export const idReaderCopy = (): IdReaderCopy => gestureCopy(idGesture());

// Reader failures that are the kiosk's fault rather than the citizen's.
// `NfcFailure` codes, repeated rather than imported — keep in sync with
// src/app/api/_lib/nfc.ts, which must stay out of the browser bundle.
const READER_FAULTS = new Set(["unsupported", "no_service", "no_reader"]);

export const isReaderFault = (reason: string | undefined): boolean =>
  reason !== undefined && READER_FAULTS.has(reason);

export const readerFaultHelp = (): string => t("idReader.faultHelp");
