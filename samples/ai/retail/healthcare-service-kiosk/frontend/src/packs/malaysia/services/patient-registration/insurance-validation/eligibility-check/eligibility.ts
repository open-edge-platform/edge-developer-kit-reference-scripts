// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { department } from "@/hospital/data";
import type { PatientRecord } from "@/hospital/records";
import type { ServiceResult } from "@/services/shared/result";
import { coverageRows } from "./card";

/** Malaysia has no real-time eligibility service: the kiosk only gets a case ready for the Guarantee Letter request. */
export type GlOutcome = "ready_for_gl" | "needs_desk";

export type EligibilityOutcome =
  | { kind: "no_policy" }
  | { kind: "expired"; expiry: string }
  | { kind: "limit_used" }
  | { kind: "on_file"; policyNumber: string; memberId: string; expiry: string; remainingLimit: number };

/** The patient's card isn't with them: what the hospital has on file for the payer they name. */
export function eligibility(record: PatientRecord, payerId: string, today: string): EligibilityOutcome {
  const policy = record.policy;
  if (!policy || policy.payer !== payerId) return { kind: "no_policy" };
  if (policy.expiry < today) return { kind: "expired", expiry: policy.expiry };
  if (policy.remainingLimit <= 0) return { kind: "limit_used" };
  return {
    kind: "on_file",
    policyNumber: policy.policyNumber,
    memberId: policy.memberId,
    expiry: policy.expiry,
    remainingLimit: policy.remainingLimit,
  };
}

export const manualOutcome = (outcome: EligibilityOutcome): GlOutcome =>
  outcome.kind === "on_file" ? "ready_for_gl" : "needs_desk";

export function glNote(): string {
  const counter = department("billing");
  const where = counter ? ` (${counter.building}, ${counter.floor})` : "";
  return `Coverage is confirmed only when your insurer or TPA issues a Guarantee Letter — the Billing & Insurance Counter${where} requests it for you.`;
}

export function eligibilityResult(
  outcome: EligibilityOutcome,
  payerName: string,
  payerId = "",
  money: (amount: number) => string = String,
): ServiceResult {
  const title = "Eligibility Check";
  switch (outcome.kind) {
    case "no_policy":
      return {
        title,
        intro: `We have no ${payerName} policy on file for you — please bring your card to the Billing & Insurance Counter.`,
        rows: [],
        note: glNote(),
      };
    case "expired":
      return {
        title,
        intro: `The ${payerName} policy on file expired on ${outcome.expiry} — please see the Billing & Insurance Counter.`,
        rows: [],
        note: glNote(),
      };
    case "limit_used":
      return {
        title,
        intro: `Our records show your ${payerName} annual limit may be used up — the counter will check with ${payerName}.`,
        rows: [],
        note: glNote(),
      };
    case "on_file":
      return {
        title,
        intro: `Your ${payerName} policy is on file and ready for a Guarantee Letter request.`,
        rows: [
          { label: "Insurer", value: payerName },
          { label: "Policy number", value: outcome.policyNumber },
          { label: "Member ID", value: outcome.memberId },
          { label: "Policy valid until", value: outcome.expiry },
          ...coverageRows(payerId, { payer: payerId, expiry: outcome.expiry, remainingLimit: outcome.remainingLimit }, money),
        ],
        note: glNote(),
      };
  }
}
