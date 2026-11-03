// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { documentAsk, documentText } from "@/app/api/_lib/document-text";
import { ask, READY } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";
import { department } from "@/hospital/data";
import { displayDay, needsStaff } from "@/lib/document-fields";
import { readReferral } from "./read";
import {
  DATE_QUESTION,
  DEPARTMENT_OPTIONS,
  DEPARTMENT_QUESTION,
  checkFor,
  checkReferral,
  readBack,
  readingFromData,
  referralData,
  referralEscalation,
  typedDate,
} from "./referral";

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: async (ctx) => {
    const letter = ctx.service.documents[0];
    // The engine plans this step before its documents phase, so the letter is asked for here.
    const doc = await documentText({
      serviceId: ctx.service.id,
      documentId: letter.id,
      documentNumber: ctx.documentNumber,
    });
    if (!doc) return ask(undefined, [documentAsk(letter)]);
    if (doc.status !== "accepted") return READY;

    const patient = { name: ctx.profile.name, nationalId: ctx.profile.nationalId };
    const fresh = ctx.data.referralSource !== doc.uploadedAt;
    if (fresh) {
      const { reading, readBy } = await readReferral(doc);
      Object.assign(ctx.data, referralData(reading, checkReferral(reading, patient), readBy, doc.uploadedAt));
      ctx.notes.push(readBack(reading));
    }

    if (ctx.data.referralDate) ctx.data.referralDate = typedDate(ctx.data.referralDate);
    const reading = readingFromData(ctx.data);
    const checks = checkReferral(reading, patient);
    const asks: Ask[] = [];
    const say: string[] = [];

    const dept = checkFor(checks, "department");
    if (dept.status === "ask" || dept.status === "warning") {
      say.push(
        dept.status === "warning" && reading.department
          ? `Your letter mentions ${department(reading.department)?.name ?? reading.department}.`
          : `${dept.note}.`,
      );
      ctx.data.referralDepartment = "";
      ctx.data.referralDepartmentCue = "patient";
      asks.push({
        id: "referralDepartment",
        question: DEPARTMENT_QUESTION,
        type: "options",
        options: DEPARTMENT_OPTIONS.map((o) => ({ value: o.id, label: o.label })),
      });
    }

    const date = checkFor(checks, "referralDate");
    if (date.status === "ask") {
      say.push(`${date.note}.`);
      ctx.data.referralDate = "";
      ctx.data.referralDateFrom = "patient";
      asks.push({ id: "referralDate", question: DATE_QUESTION, type: "text", placeholder: "YYYY-MM-DD" });
    }

    if (asks.length > 0) return ask(say.join(" "), asks);

    ctx.data.referralChecks = JSON.stringify(checks);
    ctx.data.referralReview = needsStaff(checks) ? "staff" : "ok";
    const staff = checks.filter((c) => c.status === "staff").map((c) => c.note);
    const warned = checks.filter((c) => c.status === "warning").map((c) => c.note);
    if (staff.length > 0) ctx.notes.push(`A staff member will review this referral: ${staff.join("; ")}.`);
    if (warned.length > 0) ctx.notes.push(`To note: ${warned.join("; ")}.`);
    else if (!fresh) {
      const clinic = department(reading.department ?? "")?.name ?? "a specialist clinic";
      ctx.notes.push(`Referral to ${clinic}, dated ${displayDay(reading.referralDate)}.`);
    }
    return READY;
  },
  escalate: referralEscalation,
};
