// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { findCitizenByDocument, updateContact } from "@/app/api/_lib/citizens";
import { ask, halt, READY } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";
import { possibleDuplicates } from "@/app/api/_lib/patients";
import { findPriorCase } from "@/app/api/_lib/prior-case";
import { displayMrn } from "@/hospital/patient-id";
import { patientRecord } from "@/hospital/records";
import { alreadyRegistered, LANGUAGES, registrationEscalation } from "./registered";

// The MyKad read, its confirmation and the photo happen before this, at the enroll step
// (src/app/api/_lib/self-enrollment.ts); this is what the new record still needs.
// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: async (ctx) => {
    const record = patientRecord(ctx.documentNumber);
    const prior = await findPriorCase(ctx.service.id, ctx.documentNumber);
    if (prior) return halt(alreadyRegistered(record.mrn));

    ctx.data.mrn = record.mrn;
    ctx.data.phone ||= ctx.profile.phone;
    const asks: Ask[] = [];
    if (!ctx.data.phone?.trim()) {
      asks.push({
        id: "phone",
        question: "What is your mobile number?",
        type: "text",
        placeholder: "e.g. 012-3456789",
      });
    }
    if (!LANGUAGES.includes(ctx.data.language)) {
      asks.push({
        id: "language",
        question: "What is your preferred language?",
        type: "options",
        options: LANGUAGES.map((l) => ({ value: l, label: l })),
      });
    }
    if (!ctx.data.emergencyName?.trim()) {
      asks.push({
        id: "emergencyName",
        question: "Who should we contact in an emergency (full name)?",
        type: "text",
        placeholder: "Full name",
      });
    }
    if (!ctx.data.emergencyPhone?.trim()) {
      asks.push({
        id: "emergencyPhone",
        question: "What is their phone number?",
        type: "text",
        placeholder: "e.g. 012-3456789",
      });
    }
    if (asks.length > 0) {
      // The real MRN, said up front: a model with none to relay makes one up from whatever id it can see.
      return ask(`Your record number is ${displayMrn(record.mrn)}. A few more details for your record.`, asks);
    }
    ctx.notes.push(`Your patient record number is ${displayMrn(record.mrn)}.`);
    return READY;
  },
  // "Validate duplicate patient" and "Create MRN in HIS/ERP": a possible duplicate goes to staff, and the contact details land on the record.
  file: async ({ data, documentNumber }) => {
    const citizen = documentNumber ? await findCitizenByDocument(documentNumber) : null;
    const twins = citizen ? await possibleDuplicates(citizen) : [];
    if (documentNumber) {
      await updateContact(documentNumber, {
        phone: data.phone,
        emergencyContact: data.emergencyName ? { name: data.emergencyName, phone: data.emergencyPhone ?? "" } : undefined,
      }).catch(() => false);
    }
    return twins.length
      ? { data: { duplicateOf: twins.map((t) => `${t.name} (${displayMrn(patientRecord(t.citizenId).mrn)})`).join(", ") } }
      : {};
  },
  escalate: registrationEscalation,
  filed: ({ status, data }) =>
    status === "on_hold"
      ? ""
      : status === "officer_review"
        ? `Your record number ${displayMrn(data.mrn)} is reserved — please see the registration counter so they can finish your record and print your card.`
        : `Your patient card (${displayMrn(data.mrn)}) is on the screen — tap Print, or collect it at the registration counter. ` +
          "Next time, just tap your MyKad or scan this card at any kiosk.",
};
