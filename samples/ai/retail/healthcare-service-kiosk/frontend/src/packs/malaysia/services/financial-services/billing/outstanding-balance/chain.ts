// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { formatMoney } from "@/lib/format";
import { findCitizenByDocument } from "@/app/api/_lib/citizens";
import { ledgerOf, liveRecord } from "@/app/api/_lib/ledger";
import { maskedEmail, notify } from "@/app/api/_lib/notify";
import { CURRENCY } from "@/app/api/_lib/registry";
import { ask, done, READY } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { invoicesAmount, outstandingBalance } from "@/hospital/records";

const money = (amount: number) => formatMoney(amount, CURRENCY);

export const chain: ChainSpec = {
  application: async (ctx) => {
    const record = await liveRecord(ctx.documentNumber);
    if (record.invoices.length === 0) {
      return done("You have no outstanding invoices — nothing to pay today.");
    }
    const lines =
      "Outstanding invoices:\n" +
      record.invoices.map((inv) => `• ${inv.id} (${inv.date}) ${inv.description}: ${money(inv.amount)}`).join("\n") +
      `\nTotal balance: ${money(outstandingBalance(record))}.`;
    if (ctx.data.payNow === "later") {
      return done(`${lines}\nYou can pay at any kiosk or at the cashier counter whenever you're ready.`);
    }
    if (ctx.data.payNow !== "now") {
      return ask(lines, [
        {
          id: "payNow",
          question: `Would you like to pay the ${money(outstandingBalance(record))} now?`,
          type: "options",
          options: [
            { value: "now", label: "Pay now" },
            { value: "later", label: "Not now" },
          ],
        },
      ]);
    }
    ctx.data.patientRef = ctx.documentNumber;
    ctx.data.invoiceIds = record.invoices.map((inv) => inv.id).join(",");
    return READY;
  },
  // The live record: a visit's consultation is billed by its check-in, not by the derived record.
  quote: async (data) => (data.patientRef ? invoicesAmount(await liveRecord(data.patientRef), data.invoiceIds ?? "") : 0),
  file: async ({ data }) => {
    const citizen = data.patientRef ? await findCitizenByDocument(data.patientRef) : null;
    const paid = citizen ? new Set((await ledgerOf(citizen)).paidInvoices) : new Set<string>();
    const again = (data.invoiceIds ?? "").split(",").filter((id) => paid.has(id));
    if (again.length > 0) return { hold: `${again.join(", ")} ${again.length === 1 ? "was" : "were"} already paid — the cashier will refund this payment.` };
    const total = invoicesAmount(await liveRecord(data.patientRef), data.invoiceIds ?? "");
    return { data: { paidTotal: money(total) }, complete: `Paid in full (${data.invoiceIds.split(",").join(", ")})` };
  },
  filed: async ({ caseId, status, data }) => {
    if (status !== "approved") return "";
    const citizen = await findCitizenByDocument(data.patientRef);
    const email = citizen?.email?.trim();
    const sent = email
      ? await notify({
          channel: "email",
          to: email,
          subject: `Payment receipt ${caseId}`,
          body: `We received ${data.paidTotal} for invoices ${data.invoiceIds.split(",").join(", ")}. Your balance is now ${money(0)}.`,
          serviceId: "bill",
          caseId,
        })
      : null;
    return `Your balance is now ${money(0)}.` + (sent ? ` A receipt was emailed to ${maskedEmail(email!)}.` : "");
  },
};
