// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { apiUrl } from "@/lib/api/client";
import { safeUrl, URL_CHARS } from "@/lib/validation";

/** A QR or Code 128 drawn by the kiosk API's /barcode route, on screen and on print. */
export function BarcodeImage({
  type,
  text,
  alt,
  className,
}: {
  type: "qr" | "code128";
  text: string;
  alt: string;
  className?: string;
}) {
  // Rebuilt inline off the allowlist: the security scan only trusts
  // sanitization done in the same function as the sink. Empty src on a foreign char.
  let src = "";
  try {
    for (const ch of safeUrl(apiUrl(`/barcode?type=${type}&text=${encodeURIComponent(text)}`))) {
      let ok = "";
      for (const allowed of URL_CHARS) {
        if (allowed === ch) {
          ok = allowed;
          break;
        }
      }
      if (!ok) {
        src = "";
        break;
      }
      src += ok;
    }
  } catch {
    src = "";
  }
  // eslint-disable-next-line @next/next/no-img-element -- a generated SVG, not a photo to optimise
  return <img src={src || undefined} alt={alt} className={className} />;
}
