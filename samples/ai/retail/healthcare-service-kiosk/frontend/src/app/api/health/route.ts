// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { avatarHealth } from "../_lib/avatar";
import { barcodeHealth } from "../_lib/barcode";
import { faceHealth, faceMatchRequired } from "../_lib/face";
import { type ServiceHealth } from "../_lib/health";
import { llmHealth, requireDocumentVerification } from "../_lib/llm";
import { ocrHealth } from "../_lib/ocr";
import { nfcPeripheral, scannerPeripheral } from "../_lib/peripherals/registry";
import { printerHealth } from "../_lib/printer";
import { sttHealth, ttsHealth } from "../_lib/speech";
import { services } from "@/services";

function verificationHealth(llm: ServiceHealth, ocr: ServiceHealth): ServiceHealth {
  if (llm === "ok" && ocr === "ok") return "ok";
  return llm === "unreachable" || ocr === "unreachable" ? "unreachable" : "off";
}

export async function GET() {
  const [llm, ocr, face, stt, tts, avatar, nfc, scanner, barcode, printer] = await Promise.all([
    llmHealth(),
    ocrHealth(),
    faceHealth(),
    sttHealth(),
    ttsHealth(),
    // Report-only too: without it the chat's avatar tile says it is not connected.
    avatarHealth(),
    // Peripherals are report-only, like stt/tts: a dead reader never flips `ok`.
    nfcPeripheral().health(),
    scannerPeripheral().health(),
    barcodeHealth(),
    printerHealth(),
  ]);
  const verification = verificationHealth(llm, ocr);
  // Only paperwork goes through OCR and the model: a kiosk offering none never waits on them.
  const checksDocuments = services().some((service) => service.documents.length > 0);
  const ok =
    (!checksDocuments ||
      (requireDocumentVerification()
        ? verification === "ok"
        : llm !== "unreachable" && ocr !== "unreachable")) &&
    (!faceMatchRequired() || face === "ok");
  return Response.json(
    { ok, services: { llm, ocr, verification, face, stt, tts, avatar, nfc, scanner, barcode, printer } },
    { headers: { "cache-control": "no-store" } },
  );
}
