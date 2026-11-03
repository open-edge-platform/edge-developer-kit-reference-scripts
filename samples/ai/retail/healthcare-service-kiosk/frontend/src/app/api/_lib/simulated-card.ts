// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { handoff } from "./handoff";

/**
 * A MyKad or passport staff "tapped" from /mock-documents while the card
 * reader is simulated: the next stood-in read is that patient, and a screen
 * already waiting for a card gets it at once.
 */

/** A tap nobody collected within this window belonged to a demo that moved on. */
const PENDING_TTL_MS = 2 * 60_000;

const taps = handoff<string>("kiosk.simulatedCard.inbox", PENDING_TTL_MS);

export const tapSimulatedCard = taps.present;
export const takeTappedCard = taps.take;
/** The next tap, or null when `timeoutMs` passes or `signal` aborts first. */
export const waitForTappedCard = taps.wait;
