// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { QueueTicket } from "@/components/queue/queue-ticket";
import { useService } from "@/hooks/use-kiosk-api";
import type { StepProps } from "@/services/shared/step-props";
import { Receipt } from "@/services/shared/steps/receipt";

/** A verified patient leaves with a number for the registration counter, signed in for the rest of the visit. */
export default function VerificationReceipt(props: StepProps) {
  const { data } = props.state;
  const directions = useService("directions");
  const takeaway =
    data.queueNumber && data.department
      ? {
          title: "You're verified",
          detail:
            (data.phoneUpdated ? "Your new phone number is on your record. " : "") +
            "You stay signed in for your other services. Take your number to the registration counter.",
          artifact: (
            <QueueTicket
              queueNumber={data.queueNumber}
              departmentId={data.department}
              onRoute={
                directions
                  ? () => props.actions.startService(directions, { destination: data.department, stepFree: "no" }, "result")
                  : undefined
              }
            />
          ),
        }
      : null;
  return <Receipt {...props} takeaway={takeaway} />;
}
