// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getService } from "@/services";
import { badRequest, notFound } from "../_lib/http";
import type { CmsWhere } from "../_lib/cms";
import { cmsCreate, cmsDelete, cmsFind, cmsFindOne, cmsUpdate } from "../_lib/cms";
import { findCitizenByDocument } from "../_lib/citizens";
import { newRequestId } from "../_lib/registry";

/**
 * The kiosk's unified "requests" view: saved (paused) drafts from the
 * `requests` collection merged with submitted applications that are still
 * pending review. Drafts carry the flow state needed to resume; pending
 * applications exist so a citizen can spot a duplicate before re-applying.
 * Always scoped to one citizen: every caller verifies identity first, so the
 * list is never available globally.
 */

/** Populated `citizen` relationship at depth 1; a bare id at depth 0. */
type CitizenRef = { citizenId?: string; name?: string } | number | null | undefined;

type RequestDoc = {
  id: number;
  requestId: string;
  serviceId: string;
  serviceLabel: string;
  documentNumber: string;
  citizen?: CitizenRef;
  stepId: string;
  stepIndex: number;
  data?: Record<string, string> | null;
  documents?: Record<string, unknown> | null;
  savedAt: string;
};

type ApplicationDoc = {
  id: number;
  caseId: string;
  serviceId: string;
  serviceLabel: string;
  citizen?: CitizenRef;
  status: "in_review" | "officer_review" | "on_hold" | "approved";
  statusReason?: string | null;
  submittedAt: string;
};

function holderOf(citizen: CitizenRef): { documentNumber: string | null; name: string | null } {
  if (!citizen || typeof citizen === "number") return { documentNumber: null, name: null };
  return { documentNumber: citizen.citizenId ?? null, name: citizen.name ?? null };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const documentNumber = url.searchParams.get("documentNumber")?.trim().toUpperCase();
  const serviceId = url.searchParams.get("serviceId") ?? undefined;
  if (!documentNumber) {
    return badRequest("documentNumber is required — requests are only listed per citizen");
  }

  const draftWhere: CmsWhere = { documentNumber: { equals: documentNumber } };
  const pendingWhere: CmsWhere = { status: { not_equals: "approved" } };
  if (serviceId) {
    draftWhere.serviceId = { equals: serviceId };
    pendingWhere.serviceId = { equals: serviceId };
  }

  // Applications link to citizens by relationship, so the document-number
  // filter resolves the citizen first; an unknown number matches nothing.
  let skipPending = false;
  const citizen = await findCitizenByDocument(documentNumber);
  if (citizen) pendingWhere.citizen = { equals: citizen.id };
  else skipPending = true;

  const [drafts, pending] = await Promise.all([
    cmsFind<RequestDoc>("requests", { where: draftWhere, sort: "-savedAt", limit: 100, depth: 1 }),
    skipPending
      ? Promise.resolve({ docs: [] as ApplicationDoc[] })
      : cmsFind<ApplicationDoc>("applications", {
          where: pendingWhere,
          sort: "-submittedAt",
          limit: 100,
          depth: 1,
        }),
  ]);

  const requests = [
    ...drafts.docs.map((doc) => ({
      kind: "saved" as const,
      reference: doc.requestId,
      serviceId: doc.serviceId,
      serviceLabel: doc.serviceLabel,
      documentNumber: doc.documentNumber,
      holderName: holderOf(doc.citizen).name,
      status: "saved" as const,
      statusReason: null,
      stepId: doc.stepId,
      stepIndex: doc.stepIndex,
      data: doc.data ?? {},
      documents: doc.documents ?? {},
      updatedAt: doc.savedAt,
    })),
    ...pending.docs.map((doc) => {
      const holder = holderOf(doc.citizen);
      return {
        kind: "pending" as const,
        reference: doc.caseId,
        serviceId: doc.serviceId,
        serviceLabel: doc.serviceLabel,
        documentNumber: holder.documentNumber,
        holderName: holder.name,
        status: doc.status,
        statusReason: doc.statusReason ?? null,
        stepId: null,
        stepIndex: null,
        data: null,
        documents: null,
        updatedAt: doc.submittedAt,
      };
    }),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return Response.json({ requests });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    serviceId?: string;
    documentNumber?: string;
    stepId?: string;
    stepIndex?: number;
    data?: Record<string, string>;
    documents?: Record<string, unknown>;
  };
  const service = body.serviceId ? getService(body.serviceId) : null;
  if (!service) return badRequest("unknown serviceId");
  if (!body.documentNumber) return badRequest("documentNumber is required to save a request");
  if (!body.stepId || typeof body.stepIndex !== "number") {
    return badRequest("stepId and stepIndex are required");
  }

  const documentNumber = body.documentNumber.trim().toUpperCase();
  const citizen = await findCitizenByDocument(documentNumber);
  const savedAt = new Date().toISOString();
  const fields = {
    serviceLabel: service.label,
    citizen: citizen?.id ?? null,
    stepId: body.stepId,
    stepIndex: body.stepIndex,
    data: body.data ?? {},
    documents: body.documents ?? {},
    savedAt,
  };

  // One draft per citizen + service: saving again resumes the same request
  // id instead of piling up duplicates.
  const existing = await cmsFindOne<RequestDoc>("requests", {
    serviceId: { equals: service.id },
    documentNumber: { equals: documentNumber },
  });
  const doc = existing
    ? await cmsUpdate<RequestDoc>("requests", existing.id, fields)
    : await cmsCreate<RequestDoc>("requests", {
        ...fields,
        requestId: newRequestId(),
        serviceId: service.id,
        documentNumber,
      });

  return Response.json({
    requestId: doc.requestId,
    serviceId: service.id,
    serviceLabel: service.label,
    stepId: doc.stepId,
    savedAt,
  });
}

export async function DELETE(req: Request) {
  const requestId = new URL(req.url).searchParams.get("requestId");
  if (!requestId) return badRequest("requestId is required");

  const doc = await cmsFindOne<RequestDoc>("requests", { requestId: { equals: requestId } });
  if (!doc) return notFound("no saved request with that id");

  await cmsDelete("requests", doc.id);
  return Response.json({ ok: true });
}
