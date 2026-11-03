// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { toSVG } from "bwip-js/node";
import { badRequest, oneOf, param } from "../_lib/http";

const SYMBOLOGIES = { qr: "qrcode", code128: "code128" } as const;
const KINDS = Object.keys(SYMBOLOGIES) as (keyof typeof SYMBOLOGIES)[];

/** A QR at error-correction M tops out near 2,300 bytes; leave room for multi-byte text. */
const MAX_TEXT = 1_200;

/** GET /api/barcode?type=qr|code128&text=… — an SVG the kiosk shows on screen and on print. */
export function GET(req: Request) {
  const kind = oneOf(param(req, "type"), KINDS, "type");
  if (!kind.ok) return kind.response;
  const text = new URL(req.url).searchParams.get("text") ?? "";
  if (!text || text.length > MAX_TEXT) return badRequest(`text must be 1–${MAX_TEXT} characters`);

  try {
    const svg = toSVG({
      bcid: SYMBOLOGIES[kind.value],
      text,
      scale: 3,
      ...(kind.value === "qr" ? { eclevel: "M" } : { height: 12 }),
      paddingwidth: kind.value === "qr" ? 2 : 6,
      paddingheight: 2,
      backgroundcolor: "FFFFFF",
    });
    return new Response(svg, {
      headers: { "content-type": "image/svg+xml", "cache-control": "private, max-age=600" },
    });
  } catch (error) {
    return badRequest(`cannot encode that text: ${(error as Error).message}`);
  }
}
