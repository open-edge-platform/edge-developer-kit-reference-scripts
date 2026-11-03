// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMutation } from "@tanstack/react-query";
import { Mail, MailCheck } from "lucide-react";
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { emailLabResults } from "@/lib/api/labs";

/** "Offer print/email": the results, explained, to the address on the patient's record. */
export function EmailResults({ documentNumber }: { documentNumber: string }) {
  const send = useMutation({ mutationFn: () => emailLabResults(documentNumber), retry: false });
  if (send.isSuccess) {
    return (
      <p className="flex items-center gap-2 text-base font-semibold text-success" role="status">
        <MailCheck className="size-5" />
        Sent to {send.data}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <SecondaryButton onClick={() => send.mutate()} disabled={send.isPending}>
        <Mail />
        {send.isPending ? "Sending…" : "Email me a copy"}
      </SecondaryButton>
      {send.isError && <p className="text-base text-destructive">{send.error.message}</p>}
    </div>
  );
}
