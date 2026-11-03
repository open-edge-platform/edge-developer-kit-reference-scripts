// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { barcodeDriverId, presentCode } from "../../../_lib/barcode";
import { badRequest, conflict, notFound, oneOf, readJson } from "../../../_lib/http";
import { mockSets, renderDocument, VARIANTS } from "../../../_lib/mock-document-sets";
import {
  clearFedMockDocument,
  fedMockDocument,
  feedMockDocument,
  mockDocumentsEnabled,
} from "../../../_lib/mock-documents";
import { nfcSimulatePolicy, scannerSimulatePolicy } from "../../../_lib/peripherals/policy";
import { scannerEnabled } from "../../../_lib/scanner";
import { tapSimulatedCard } from "../../../_lib/simulated-card";
import { notStaff, staffUser } from "../../../_lib/staff";

// Staff-only, on the CMS admin session — see ../../../_lib/staff.

/** What this terminal lets the bench stand in for: only peripherals that are simulated. */
function bench() {
  return {
    feed: mockDocumentsEnabled() || (scannerEnabled() && scannerSimulatePolicy() !== "never"),
    scan: barcodeDriverId() === "mock",
    tap: nfcSimulatePolicy() !== "never",
  };
}

/** GET — what the bench can do here, and the page waiting in the simulated feeder. */
export async function GET(req: Request) {
  if (!(await staffUser(req))) return notStaff();
  return Response.json({ ...bench(), fed: fedMockDocument() }, { headers: { "cache-control": "no-store" } });
}

const ACTIONS = ["feed", "scan-card", "scan-slip", "tap"] as const;

/**
 * POST — present a patient's paperwork to this kiosk's simulated peripherals:
 * `feed` puts one document (`variant` + `file`) in the scanner for the next
 * scan step, `scan-card` / `scan-slip` reads their patient card or today's
 * appointment slip at the barcode scanner, `tap` puts their MyKad or passport
 * on the card reader.
 */
export async function POST(req: Request) {
  if (!(await staffUser(req))) return notStaff();
  const body = await readJson<{ citizen: number; action: string; variant: string; file: string }>(req);
  const action = oneOf(body.action, ACTIONS, "action");
  if (!action.ok) return action.response;
  const id = Number(body.citizen);
  if (!Number.isInteger(id) || id <= 0) return badRequest("citizen must be a registry row id");

  const can = bench();
  const sets = await mockSets(id);
  if (!sets) return notFound("nobody on the register has that id");

  if (action.value === "feed") {
    if (!can.feed) return conflict("this kiosk's document scanner is not simulated — print the document and feed it in");
    const variant = oneOf(body.variant, VARIANTS, "variant");
    if (!variant.ok) return variant.response;
    if (variant.value === "false" && !sets.donor) return notFound("a tampered set needs a second patient on the register");
    const doc = await renderDocument(sets, variant.value, body.file ?? "");
    if (!doc) return notFound("this set has no such file");
    const label = `${variant.value === "good" ? "Genuine" : "Tampered"} ${doc.file} of ${sets.holder.name}`;
    feedMockDocument({ fileName: doc.file, bytes: Buffer.from(doc.bytes), label });
    return Response.json({ fed: fedMockDocument() });
  }

  if (action.value === "tap") {
    if (!can.tap) return conflict("this kiosk's card reader is not simulated — tap the real card");
    tapSimulatedCard(sets.citizen.citizenId);
    return Response.json({ tapped: sets.holder.name });
  }

  if (!can.scan) return conflict("a barcode scanner is fitted — print the card or slip and scan it");
  const code = action.value === "scan-card" ? sets.holder.mrn : sets.holder.slip?.code;
  if (!code) return notFound(`${sets.holder.name} has no appointment today, so there is no slip to scan`);
  presentCode(code);
  return Response.json({ scanned: action.value === "scan-card" ? "patient card" : "appointment slip" });
}

/** DELETE — take the page back out of the simulated feeder. */
export async function DELETE(req: Request) {
  if (!(await staffUser(req))) return notStaff();
  clearFedMockDocument();
  return Response.json({ fed: null });
}
