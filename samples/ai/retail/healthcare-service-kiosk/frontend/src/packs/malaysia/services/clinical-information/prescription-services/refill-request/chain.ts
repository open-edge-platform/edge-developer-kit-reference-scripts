// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { formatMoney } from "@/lib/format";
import { CURRENCY } from "@/app/api/_lib/registry";
import { findCitizenByDocument } from "@/app/api/_lib/citizens";
import { liveRecord } from "@/app/api/_lib/ledger";
import { maskedPhone, notify } from "@/app/api/_lib/notify";
import { ask, halt, READY } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";
import { departmentLocation } from "@/hospital/data";
import { refillAmount, type Prescription } from "@/hospital/records";
import { NONE_ELIGIBLE, refillOptions, refillPayer } from "./refill";

const money = (amount: number) => formatMoney(amount, CURRENCY);

const refillAsk = (eligible: Prescription[]): Ask => ({
  id: "refillIds",
  question: eligible.some((p) => p.lastFilled === null)
    ? "Which medicine would you like to collect?"
    : "Which prescription would you like to refill?",
  type: "options",
  options: [
    ...eligible.map((p) => ({
      value: p.id,
      label: `${p.name}${p.lastFilled === null ? " (new today)" : ""} — ${money(p.price)}`,
    })),
    ...(eligible.length > 1 ? [{ value: eligible.map((p) => p.id).join(","), label: "All of the above" }] : []),
  ],
});

export const chain: ChainSpec = {
  application: async (ctx) => {
    const record = await liveRecord(ctx.documentNumber);
    const options = refillOptions(record);
    const eligible = options.filter((o) => o.ok).map((o) => o.prescription);
    const waiting = options.filter((o) => !o.ok).map((o) => `${o.prescription.name}: ${o.why}`);
    if (eligible.length === 0) {
      return halt([NONE_ELIGIBLE, ...waiting.map((line) => `• ${line}`)].join("\n"));
    }

    const chosen = new Set((ctx.data.refillIds ?? "").split(",").filter(Boolean));
    const valid = eligible.filter((p) => chosen.has(p.id));
    if (valid.length === 0) {
      return ask(
        ctx.data.refillIds
          ? "I couldn't match that to a prescription that can be refilled today — please choose from the list."
          : waiting.length
            ? `Not refillable today:\n${waiting.map((line) => `• ${line}`).join("\n")}`
            : undefined,
        [refillAsk(eligible)],
      );
    }

    ctx.data.refillIds = valid.map((p) => p.id).join(",");
    ctx.data.patientRef = ctx.documentNumber;
    ctx.data.collectAt = departmentLocation("pharmacy");
    const covered = refillPayer(record, ctx.data.refillIds);
    if (covered) ctx.data.coveredBy = covered.name;
    ctx.notes.push(
      `Preparing ${valid.map((p) => p.name).join(", ")} (${money(refillAmount(record, ctx.data.refillIds))}).` +
        (covered ? ` It is billed to ${covered.name}, your insurer on file, so there is nothing to pay here.` : ""),
    );
    return READY;
  },
  // The live record: a prescription from today's visit is not in the derived one.
  quote: async (data) =>
    data.patientRef && !data.coveredBy ? refillAmount(await liveRecord(data.patientRef), data.refillIds ?? "") : 0,
  filed: async ({ caseId, status, data }) => {
    if (status === "on_hold") return "";
    const citizen = await findCitizenByDocument(data.patientRef);
    const phone = citizen?.phone?.trim();
    const sent = phone
      ? await notify({
          channel: "sms",
          to: phone,
          body: `Your refill ${caseId} is being prepared. Collect it from the ${data.collectAt} — bring your MyKad or patient card.`,
          serviceId: "refill",
          caseId,
        })
      : null;
    return (
      `Collect your medicine from the ${data.collectAt}.` +
      (sent ? ` We'll text ${maskedPhone(phone!)} when it's ready.` : "")
    );
  },
};
