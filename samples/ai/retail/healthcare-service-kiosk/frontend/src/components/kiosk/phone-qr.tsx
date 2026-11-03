// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { BarcodeImage } from "./barcode-image";

/**
 * A QR the visitor's phone camera reads as plain text — directions, a ticket, a slip.
 * Text rather than a link: phones on mobile data can't reach a kiosk on the hospital LAN,
 * and text needs no app or account. Never put a name, IC or MRN in it.
 */
export function PhoneQr({
  text,
  title = "Take it on your phone",
  hint = "Point your phone camera here — no app needed.",
  className,
}: {
  text: string;
  title?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-5 rounded-2xl border bg-card p-4", className)}>
      <BarcodeImage type="qr" text={text} alt="" className="size-24 shrink-0 rounded-lg bg-white" />
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Smartphone className="size-5 text-primary" aria-hidden />
          {title}
        </div>
        <p className="mt-1 text-base text-pretty text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
