// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// This copy is pinned byte-identically by the Playwright API specs; the
// catalog is the canonical key set for all packs (see ../index.ts).
export const messages = {
  // See src/lib/id-reader.ts for what each idReader slot means.
  "idReader.insert.title": "Insert your MyKad below the screen",
  "idReader.insert.detail":
    "Slide it into the reader chip-first and leave it there until the kiosk says it has " +
    "read it — or place your passport photo page face-down on the scanner.",
  "idReader.insert.spoken":
    "Please insert your MyKad into the document reader below the screen and leave it in " +
    "the reader (foreign citizens: place your passport photo page on the scanner). I'll " +
    "continue automatically once it's detected.",
  "idReader.insert.hold":
    "Push your MyKad all the way into the slot, chip-first, and leave it there — take " +
    "your hand away and wait. The reader needs it to stay in the slot while it reads.",
  "idReader.insert.reseat":
    "Take your MyKad or passport out of the reader, wait a second, then slide it back in " +
    "and leave it there.",
  "idReader.insert.remove": "Your MyKad has been read — please take it out of the reader now.",
  "idReader.insert.confirm": "I've inserted it — read it now",
  "idReader.insert.where": "in the reader below the screen",

  "idReader.tap.title": "Tap your MyKad on the reader",
  "idReader.tap.detail":
    "Hold it flat against the pad below the screen and keep it there until the light " +
    "turns green.",
  "idReader.tap.spoken":
    "Please hold your MyKad against the card pad below the screen and keep it there. " +
    "I'll continue automatically once it's read.",
  "idReader.tap.hold":
    "Lay your MyKad flat on the pad and keep it there — don't lift it off until the " +
    "kiosk says it has read it. A quick tap is not long enough.",
  "idReader.tap.reseat":
    "Take your MyKad off the pad, wait a second, then lay it flat on the pad again and " +
    "keep it there.",
  "idReader.tap.remove": "Your MyKad has been read — you can take it off the pad now.",
  "idReader.tap.confirm": "I'm holding it on the pad",
  "idReader.tap.where": "on the card pad below the screen",

  "idReader.faultHelp": "Please ask a staff member at the counter for help.",

  // Card-reader failures (see _lib/nfc.ts).
  "nfcFailure.unsupported": "the card reader is not available on this kiosk",
  "nfcFailure.no_service": "the card reader service is not running",
  "nfcFailure.no_reader": "no card reader is connected to this kiosk",
  "nfcFailure.timeout": "no card was detected at the reader",
  "nfcFailure.read_failed": "your card was detected but could not be read",

  "identityDocument.mykad": "MyKad",
  "identityDocument.passport": "Passport",
  // "spoken" variants are used mid-sentence ("I've read your passport").
  "identityDocument.spoken.mykad": "MyKad",
  "identityDocument.spoken.passport": "passport",

  "deviceStep.insertDocument.receipt": "MyKad read at the card reader",
  "deviceStep.insertDocument.help":
    "There is nothing to verify until your MyKad (or passport) is {{where}} — " +
    "the kiosk cannot take your word for it. A staff member at the counter can help, or " +
    "tap Restart at the top to start again.",

  "details.nationalIdLabel": "IC / Passport No.",
} as const;
