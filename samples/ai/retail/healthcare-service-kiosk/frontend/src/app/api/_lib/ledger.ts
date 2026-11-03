// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { applyLedger, isoDate, patientRecord, type Ledger, type PatientRecord } from "@/hospital/records";
import { cmsFind } from "./cms";
import { findCitizenByDocument, type CitizenDoc } from "./citizens";

type CaseDoc = { caseId: string; serviceId: string; status: string; data?: Record<string, string> | null; submittedAt: string };

const LEDGER_SERVICES = ["checkin", "bill", "refill", "followup"];
const OPEN = ["in_review", "officer_review"];

/** The record changes the kiosk's own filings made: a held case changed nothing. */
export async function ledgerOf(citizen: CitizenDoc): Promise<Ledger> {
  const cases = (
    await cmsFind<CaseDoc>("applications", {
      where: { citizen: { equals: citizen.id }, serviceId: { in: LEDGER_SERVICES.join(",") } },
      limit: 500,
      sort: "submittedAt",
    })
  ).docs.filter((doc) => doc.status !== "on_hold");

  const ledger: Ledger = { paidInvoices: [], dispensed: {}, followUpBooked: null, visits: [] };
  const today = isoDate(new Date());
  for (const doc of cases) {
    const data = doc.data ?? {};
    if (doc.serviceId === "checkin") {
      // A check-in is the visit: its consultation is billed and its prescription waits at the pharmacy (records.ts).
      if (data.department) {
        ledger.visits.push({
          reference: doc.caseId,
          date: isoDate(new Date(doc.submittedAt)),
          department: data.department,
          doctor: data.doctor ?? "",
        });
      }
    } else if (doc.serviceId === "bill") {
      ledger.paidInvoices.push(...(data.invoiceIds ?? "").split(",").filter(Boolean));
    } else if (doc.serviceId === "refill") {
      const day = isoDate(new Date(doc.submittedAt));
      for (const id of (data.refillIds ?? "").split(",").filter(Boolean)) {
        const seen = ledger.dispensed[id];
        ledger.dispensed[id] = { count: (seen?.count ?? 0) + 1, last: seen && seen.last > day ? seen.last : day };
      }
    } else if (OPEN.includes(doc.status) && data.date >= today) {
      ledger.followUpBooked = { caseId: doc.caseId, date: data.date, time: data.time, doctorName: data.doctorName ?? "" };
    }
  }
  return ledger;
}

/** The patient's record as it stands now: the derived one with the kiosk's filings applied. */
export async function liveRecord(documentNumber: string): Promise<PatientRecord> {
  const record = patientRecord(documentNumber);
  const citizen = await findCitizenByDocument(documentNumber);
  return citizen ? applyLedger(record, await ledgerOf(citizen)) : record;
}
