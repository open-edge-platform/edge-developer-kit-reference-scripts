// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useService } from "@/hooks/use-kiosk-api";
import type { StepProps } from "@/services/shared/step-props";
import { Receipt } from "@/services/shared/steps/receipt";
import { PayBalanceOffer } from "@/components/kiosk/pay-balance-offer";
import { QueueTicket } from "@/components/queue/queue-ticket";

/** A checked-in patient walks away with their queue number, and can pay a bill still due before they sit down. */
export default function CheckInReceipt(props: StepProps) {
  const { data } = props.state;
  const directions = useService("directions");
  const bill = useService("bill");
  const documentNumber = props.state.identity?.documentNumber;
  const takeaway =
    data.queueNumber && data.department
      ? {
          title: "You're checked in!",
          detail:
            (data.clinicNotified ? "The clinic has been told you're here. " : "") +
            "Keep your number handy — tap Print or scan the QR to take it with you.",
          artifact: (
            <QueueTicket
              queueNumber={data.queueNumber}
              departmentId={data.department}
              doctor={data.doctor}
              time={data.time}
              onRoute={
                directions
                  ? () => props.actions.startService(directions, { destination: data.department, stepFree: "no" }, "result")
                  : undefined
              }
            />
          ),
        }
      : null;
  return (
    <Receipt
      {...props}
      takeaway={takeaway}
      next={
        takeaway && bill && documentNumber ? (
          <PayBalanceOffer documentNumber={documentNumber} onPay={() => props.actions.startService(bill, {})} />
        ) : null
      }
    />
  );
}
