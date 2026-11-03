// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { t } from "@/lib/i18n";
import { idReaderCopy } from "@/lib/id-reader";

/** Recapturing hands over the same bytes forever, so fall back to the file picker after this. */
export const MAX_AUTO_CAPTURES = 3;

export type CaptureStatus = {
  askId: string;
  message: string;
  triesLeft?: number;
};

export type Refusal = { askId: string; secondsLeft: number };

export const deviceSteps = (): Record<
  string,
  { detected: string; receipt: string; confirm: string; help: string }
> => ({
  insertDocument: {
    detected: "Card detected — reading it now…",
    receipt: t("deviceStep.insertDocument.receipt"),
    confirm: idReaderCopy().confirm,
    help: t("deviceStep.insertDocument.help", { where: idReaderCopy().where }),
  },
  enrollCard: {
    detected: "MyKad detected — reading your details…",
    receipt: "MyKad read at the kiosk",
    confirm: idReaderCopy().confirm,
    help:
      `Your details are read off the chip in your MyKad, so it has to be ${idReaderCopy().where}. ` +
      "No MyKad with you? The registration counter can register you with your passport.",
  },
  portrait: {
    detected: "Photo taken — saving it…",
    receipt: "Photo taken for your record",
    confirm: "I'm looking at the camera",
    help:
      "The camera sits above the screen. If it cannot see you, carry on — the registration " +
      "counter will take your photo instead.",
  },
  biometric: {
    detected: "Face matched — continuing…",
    receipt: "Face check passed",
    confirm: "I'm looking at the camera",
    help:
      "The camera sits above the screen. If it cannot see you, a staff member at the " +
      "counter can verify you in person.",
  },
  payment: {
    detected: "Payment detected — completing…",
    receipt: "Payment taken at the terminal",
    confirm: "I've paid — continue",
    help:
      "Payment is taken at the terminal beside the screen. If your card will not read, " +
      "start the step again and choose QR or cash, or pay at the counter.",
  },
});
