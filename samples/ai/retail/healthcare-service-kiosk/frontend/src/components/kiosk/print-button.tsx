// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, Printer } from "lucide-react";
import { kioskKeys } from "@/hooks/use-kiosk-api";
import { getPrinterDriver, printCode } from "@/lib/api/kiosk";
import { publicBoolean } from "@/lib/public-config";
import { cn } from "@/lib/utils";
import { SecondaryButton } from "./secondary-button";

/** printer.enabled: false takes Print off every screen — the receipt printer's and the browser's. */
export const printingEnabled = () => publicBoolean("NEXT_PUBLIC_KIOSK_PRINTER_ENABLED", true);

/**
 * Prints the patient card or appointment slip `code` (its MRN or slip code)
 * resolves to on the kiosk's receipt printer. Without one — or without a code —
 * `fallback` hands Print to the browser, and with no fallback nothing shows.
 * With printing disabled nothing shows either way.
 */
export function PrintButton({
  code,
  label = "Print",
  fallback = false,
  className,
}: {
  code?: string;
  label?: string;
  fallback?: boolean;
  className?: string;
}) {
  const enabled = printingEnabled();
  const printer = useQuery({
    queryKey: kioskKeys.printer,
    queryFn: getPrinterDriver,
    staleTime: Infinity,
    retry: false,
    enabled,
  });
  const print = useMutation({ mutationFn: printCode });
  const driver = printer.data?.driver;
  const onPaper = Boolean(code) && driver !== undefined && driver !== "off";

  if (!enabled) return null;
  if (!onPaper) {
    if (!fallback) return null;
    return (
      <SecondaryButton className={className} onClick={() => window.print()}>
        <Printer />
        {label}
      </SecondaryButton>
    );
  }

  const taken = print.data?.printed === "patientCard" ? "card" : "slip";
  return (
    <div className={cn("flex flex-col items-center gap-2 print:hidden", className)}>
      <SecondaryButton disabled={print.isPending} onClick={() => print.mutate(code!)}>
        {print.isPending ? <LoaderCircle className="animate-spin" /> : print.isSuccess ? <Check /> : <Printer />}
        {print.isPending ? "Printing…" : print.isSuccess ? `Printed — take your ${taken}` : label}
      </SecondaryButton>
      {print.isError && (
        <p role="alert" className="max-w-sm text-center text-base text-pretty text-destructive">
          {print.error.message}
        </p>
      )}
    </div>
  );
}
