// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { faceHealth, faceMatchRequired } from "../_lib/face";
import { type ServiceHealth } from "../_lib/health";
import { llmHealth, requireDocumentVerification } from "../_lib/llm";
import { ocrHealth } from "../_lib/ocr";
import { nfcPeripheral, scannerPeripheral } from "../_lib/peripherals/registry";
import { sttHealth, ttsHealth } from "../_lib/speech";

function verificationHealth(llm: ServiceHealth, ocr: ServiceHealth): ServiceHealth {
  if (llm === "ok" && ocr === "ok") return "ok";
  return llm === "unreachable" || ocr === "unreachable" ? "unreachable" : "off";
}

export async function GET() {
  const [llm, ocr, face, stt, tts, nfc, scanner] = await Promise.all([
    llmHealth(),
    ocrHealth(),
    faceHealth(),
    sttHealth(),
    ttsHealth(),
    // Peripherals are report-only, like stt/tts: a dead reader never flips `ok`.
    nfcPeripheral().health(),
    scannerPeripheral().health(),
  ]);
  const verification = verificationHealth(llm, ocr);
  const ok =
    (requireDocumentVerification()
      ? verification === "ok"
      : llm !== "unreachable" && ocr !== "unreachable") &&
    (!faceMatchRequired() || face === "ok");
  return Response.json(
    { ok, services: { llm, ocr, verification, face, stt, tts, nfc, scanner } },
    { headers: { "cache-control": "no-store" } },
  );
}
