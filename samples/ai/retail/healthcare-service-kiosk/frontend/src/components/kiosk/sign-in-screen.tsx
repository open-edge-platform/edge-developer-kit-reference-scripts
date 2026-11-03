// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useRef } from "react";
import { useService } from "@/hooks/use-kiosk-api";
import type { KioskFlowActions } from "@/hooks/use-kiosk-flow";
import { IdentityGate } from "@/services/shared/steps/identity";

const CHECK_IN_SERVICE = "checkin";

/** Identify first, choose later: a scanned appointment slip goes straight on to check-in for that visit. */
export function SignInScreen({ actions }: { actions: KioskFlowActions }) {
  const slip = useRef<string | null>(null);
  const checkIn = useService(CHECK_IN_SERVICE);

  return (
    <IdentityGate
      consent="By signing in you agree to this kiosk using your ID card, face scan or date of birth to open your hospital record for the services you choose. Your data is handled under Malaysia's Personal Data Protection Act; a record of your consent is kept."
      onDocument={(document) => {
        slip.current = document.appointmentReference ?? null;
      }}
      onVerified={(identity) =>
        slip.current && checkIn
          ? actions.signedIn(identity, checkIn, { appointmentReference: slip.current })
          : actions.signedIn(identity)
      }
    />
  );
}
