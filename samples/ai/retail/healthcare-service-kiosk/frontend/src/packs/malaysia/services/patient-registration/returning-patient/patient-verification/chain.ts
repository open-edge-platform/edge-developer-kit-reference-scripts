// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { updateContact } from "@/app/api/_lib/citizens";
import { CURRENCY } from "@/app/api/_lib/registry";
import { liveRecord } from "@/app/api/_lib/ledger";
import { maskedPhone } from "@/app/api/_lib/notify";
import { nextQueueNumber, ticketStatus } from "@/app/api/_lib/queue";
import { ask, READY } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { departmentLocation } from "@/hospital/data";
import { displayMrn } from "@/hospital/patient-id";
import { formatMoney } from "@/lib/format";
import { statusNotes } from "./status";

/** Verification ends at the registration counter, so the patient leaves with its queue number. */
export const COUNTER = "registration";

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: async (ctx) => {
    const record = await liveRecord(ctx.documentNumber);

    if (!["yes", "update"].includes(ctx.data.detailsConfirmed)) {
      const { profile } = ctx;
      return ask(
        [
          `Your record (${displayMrn(record.mrn)}): ${profile.name}, born ${profile.dateOfBirth}, ` +
            `phone ${maskedPhone(profile.phone)}, address ${profile.address}.`,
          ...statusNotes(record, (amount) => formatMoney(amount, CURRENCY)),
        ].join("\n"),
        [
          {
            id: "detailsConfirmed",
            question: "Are your registered details still correct?",
            type: "options",
            options: [
              { value: "yes", label: "Yes, still correct" },
              { value: "update", label: "No, update my phone number" },
            ],
          },
        ],
      );
    }
    if (ctx.data.detailsConfirmed === "update" && !ctx.data.phone?.trim()) {
      return ask(undefined, [
        { id: "phone", question: "What is your new phone number?", type: "text", placeholder: "e.g. 012-3456789" },
      ]);
    }
    ctx.data.phone ||= ctx.profile.phone;
    ctx.data.mrn = record.mrn;
    return READY;
  },
  file: async ({ data, documentNumber }) => {
    const updated =
      data.detailsConfirmed === "update" && documentNumber
        ? await updateContact(documentNumber, { phone: data.phone }).catch(() => false)
        : false;
    return {
      data: {
        department: COUNTER,
        queueNumber: await nextQueueNumber(COUNTER),
        ...(updated ? { phoneUpdated: "yes" } : {}),
      },
    };
  },
  filed: async ({ status, data }) => {
    if (status === "on_hold" || !data.queueNumber) return "";
    const ticket = await ticketStatus(COUNTER, data.queueNumber);
    return (
      (data.phoneUpdated ? "Your new phone number is on your record. " : "") +
      `You're verified for this visit. Your number for ${departmentLocation(COUNTER)} is ${data.queueNumber}` +
      (ticket.ahead > 0 ? ` — ${ticket.ahead} ahead of you.` : " — you're next.")
    );
  },
};
