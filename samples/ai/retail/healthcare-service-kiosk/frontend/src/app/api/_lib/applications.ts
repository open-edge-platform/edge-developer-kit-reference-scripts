// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDefinition } from "@/services";
import { cmsCreate, cmsDelete, cmsFindOne } from "./cms";
import { findCitizenByDocument, type CitizenDoc } from "./citizens";
import { findPriorCase } from "./prior-case";
import { chainFor } from "@/packs/index.server";
import { escalationFor, newCaseId } from "./registry";

type ApplicationStatus = "in_review" | "officer_review" | "on_hold" | "approved";

type DuplicateOutcome = { status: ApplicationStatus; statusReason: string };

export type FiledApplication = {
  caseId: string;
  serviceId: string;
  status: ApplicationStatus;
  statusReason: string | null;
  submittedAt: string;
  /** What filing added to the answers (queue number, slip code), for the receipt. */
  data: Record<string, string>;
};

/**
 * A citizen with a case for the same service still under review cannot file
 * it again — the duplicate is held with a pointer to the existing case.
 * Repeatable services are exempt.
 */
async function duplicateOutcome(
  service: ServiceDefinition,
  citizen: CitizenDoc | null,
): Promise<DuplicateOutcome | null> {
  if (!citizen || service.repeatable) return null;
  if (service.oncePerCitizen && citizen.citizenId) {
    const prior = await findPriorCase(service.id, citizen.citizenId);
    if (prior) {
      return {
        status: "on_hold",
        statusReason: `Already on file under case ${prior.caseId} — ${service.label} is done once per patient.`,
      };
    }
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pending = await cmsFindOne<{ caseId: string }>("applications", {
    serviceId: { equals: service.id },
    citizen: { equals: citizen.id },
    status: { in: "in_review,officer_review" },
    ...(service.oncePerDay ? { submittedAt: { greater_than_equal: today.toISOString() } } : {}),
  });
  if (!pending) return null;
  return {
    status: "on_hold",
    statusReason: `Case ${pending.caseId} for this service is already pending review — track it under Requests on the home screen instead of submitting again.`,
  };
}

export async function fileApplication(
  service: ServiceDefinition,
  input: { paymentId?: string; documentNumber?: string; data?: Record<string, string> },
): Promise<FiledApplication> {
  const { paymentId, documentNumber, data = {} } = input;
  const citizen = documentNumber ? await findCitizenByDocument(documentNumber) : null;
  const duplicate = await duplicateOutcome(service, citizen);
  const caseId = newCaseId();
  const filing = duplicate
    ? {}
    : ((await (await chainFor(service.id))?.file?.({ caseId, data: { ...data }, documentNumber })) ?? {});
  const filed = { ...data, ...filing.data };
  const escalation = duplicate || filing.hold || filing.complete ? null : await escalationFor(service.id, filed);
  const status: ApplicationStatus =
    duplicate?.status ??
    (filing.hold ? "on_hold" : filing.complete ? "approved" : escalation ? "officer_review" : "in_review");
  const statusReason = duplicate?.statusReason ?? filing.hold ?? filing.complete ?? escalation;

  const submittedAt = new Date().toISOString();

  await cmsCreate("applications", {
    caseId,
    serviceId: service.id,
    serviceLabel: service.label,
    citizen: citizen?.id ?? null,
    status,
    statusReason,
    data: filed,
    paymentId: paymentId ?? null,
    submittedAt,
  });

  // The submission supersedes any draft saved mid-flow for this service.
  if (documentNumber) {
    const draft = await cmsFindOne<{ id: number }>("requests", {
      serviceId: { equals: service.id },
      documentNumber: { equals: documentNumber.trim().toUpperCase() },
    });
    if (draft) await cmsDelete("requests", draft.id).catch(() => {});
  }

  return { caseId, serviceId: service.id, status, statusReason, submittedAt, data: filing.data ?? {} };
}
