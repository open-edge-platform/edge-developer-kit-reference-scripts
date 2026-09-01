// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { activePack } from "@/packs";
import { readFile } from "fs/promises";
import path from "path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { CATEGORIES, getService } from "@/services";
import { continueFlow, startFlow } from "../_lib/flows/engine";
import { documentMimeType } from "../_lib/media";
import { callRoute, type RouteResult } from "../_lib/route-call";
import { POST as applicationsRoute } from "../applications/route";
import { POST as documentsRoute } from "../documents/route";
import { GET as feesRoute } from "../fees/route";
import { GET as finesRoute } from "../fines/route";
import { GET as healthRoute } from "../health/route";
import { GET as readIdDocumentRoute } from "../identity/document/route";
import { POST as verifyIdentityRoute } from "../identity/verify/route";
import { GET as licensesRoute } from "../licenses/route";
import { POST as paymentsRoute } from "../payments/route";
import {
  DELETE as requestsDeleteRoute,
  GET as requestsGetRoute,
  POST as requestsPostRoute,
} from "../requests/route";
import { GET as vehiclesRoute } from "../vehicles/route";

const ID_DOC = activePack().idDocuments.label;

// Every tool delegates to an exported route handler, so the routes stay the
// single source of truth for business rules.

function toolResult({ ok, body }: RouteResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
    isError: !ok,
  };
}

const failure = (error: string) => toolResult({ ok: false, body: { error } });

const documentNumberField = z
  .string()
  .describe(`The citizen's ID document number (${ID_DOC} IC number or passport number)`);

const dataField = z
  .record(z.string(), z.string())
  .describe(
    "Answers collected for the service, keyed by field id. Known keys — " +
      "fine: lookupBy + reference; roadtax: plate + period (months); " +
      "dl_renew: licenseClass + requestType (renewal|replacement) + duration (years); " +
      "dl_new: licenseClass; welfare: scheme; idcard: caseType; address: newAddress. " +
      "Use get_service_details to see the service's flow and priced fields.",
  );

function flowResult(flow: Awaited<ReturnType<typeof startFlow>>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(flow, null, 2) }],
    isError: flow.status === "failed",
  };
}

const answersField = z
  .record(z.string(), z.string())
  .describe("Answers to the previous response's asks, keyed by ask id");

const uploadsField = z
  .array(
    z.object({
      documentId: z.string().describe("The ask id of a document ask"),
      fileBase64: z.string().optional().describe("PDF bytes, base64-encoded"),
      filePath: z.string().optional().describe("Absolute PDF path on the kiosk machine"),
      fileName: z.string().optional(),
    }),
  )
  .describe("PDF uploads answering document asks");

export function registerKioskTools(server: McpServer): void {
  server.registerTool(
    "start_service_flow",
    {
      title: "Start a guided service flow",
      description:
        "PREFERRED way to serve a citizen: runs the whole service server-side — identity " +
        "verification, registry lookups, eligibility checks, fee quote, payment and " +
        "submission — stopping at every point that needs the citizen. The response carries " +
        "ready-to-relay text (`say`) and `asks`: \"options\"/\"text\" asks are questions to " +
        "answer, \"document\" asks want a PDF upload, and \"action\" asks are physical " +
        `steps at the kiosk (insert ${ID_DOC}, tap card) the citizen performs and then confirms ` +
        "with the answer \"done\". Relay each ask, then call continue_service_flow. No " +
        "other tools are needed for a standard application.",
      inputSchema: z.object({
        serviceId: z.string().describe("Service id from get_service_catalog"),
      }),
    },
    async ({ serviceId }) => flowResult(await startFlow(serviceId)),
  );

  server.registerTool(
    "continue_service_flow",
    {
      title: "Continue a guided service flow",
      description:
        "Feeds the citizen's answers (and any document PDFs) into a flow started with " +
        "start_service_flow. Answer an \"action\" ask with the string \"done\" once the " +
        "citizen confirms the physical step. Repeat until status is \"completed\" or " +
        "\"failed\". Pass the previous response's sessionId once it is non-null; before " +
        "that (during the identity hand-off) pass its serviceId instead. A need_input flow " +
        "is saved as a draft the citizen can also resume at the kiosk touch UI.",
      inputSchema: z.object({
        sessionId: z
          .string()
          .optional()
          .describe("sessionId from the previous flow response, once non-null"),
        serviceId: z
          .string()
          .optional()
          .describe("The flow's serviceId — required while sessionId is still null"),
        answers: answersField.optional(),
        uploads: uploadsField.optional(),
      }),
    },
    async ({ sessionId, serviceId, answers, uploads }) =>
      flowResult(await continueFlow({ sessionId, serviceId, answers, uploads })),
  );

  server.registerTool(
    "get_service_catalog",
    {
      title: "List kiosk services",
      description:
        "All government services this kiosk offers, grouped by category. Returns each " +
        "service's id, label, description, and base fee. Call get_service_details for a " +
        "service's full flow and document requirements.",
      inputSchema: z.object({}),
    },
    async () =>
      toolResult({
        ok: true,
        body: {
          categories: CATEGORIES.map((category) => ({
            id: category.id,
            label: category.label,
            description: category.description,
            groups: category.groups.map((group) => ({
              label: group.label,
              services: group.services.map((service) => ({
                id: service.id,
                label: service.label,
                description: service.description,
                fee: service.fee,
              })),
            })),
          })),
        },
      }),
  );

  server.registerTool(
    "get_service_details",
    {
      title: "Service details",
      description:
        "Full definition of one service: the ordered step flow, required supporting " +
        "documents (with fallback relationship proofs), fee and per-answer pricing. Use it " +
        "to learn which inputs to collect from the citizen before quoting, paying, or " +
        "submitting.",
      inputSchema: z.object({
        serviceId: z.string().describe("Service id from get_service_catalog"),
      }),
    },
    async ({ serviceId }) => {
      const service = getService(serviceId);
      if (!service) return failure(`unknown serviceId "${serviceId}"`);
      const details = { ...service };
      delete details.dir;
      return toolResult({ ok: true, body: details });
    },
  );

  server.registerTool(
    "read_id_document",
    {
      title: "Read inserted ID document",
      description:
        `Reads the ${ID_DOC} or passport currently inserted in the kiosk's document reader and ` +
        "returns its type, number, and holder name. This is the first step of identity " +
        "verification; follow it with verify_identity.",
      inputSchema: z.object({}),
    },
    async () => toolResult(await callRoute(readIdDocumentRoute)),
  );

  server.registerTool(
    "verify_identity",
    {
      title: "Verify identity",
      description:
        "Matches a biometric (face scan at the kiosk) against the citizen " +
        "record for the ID document read by read_id_document. Returns the citizen's " +
        "profile on success. Identity must be verified before paying or submitting on a " +
        "citizen's behalf. The thumbprint scanner is not supported for now.",
      inputSchema: z.object({
        method: z
          .enum(["face", "fingerprint"])
          .describe("Biometric capture method (fingerprint is not supported for now)"),
        documentNumber: documentNumberField,
      }),
    },
    async ({ method, documentNumber }) =>
      toolResult(await callRoute(verifyIdentityRoute, { json: { method, documentNumber } })),
  );

  server.registerTool(
    "lookup_fines",
    {
      title: "Look up traffic fines",
      description:
        "Outstanding (unpaid) traffic summonses looked up by summons number, vehicle plate, " +
        `or ${ID_DOC} IC number, with the total amount owed.`,
      inputSchema: z.object({
        lookupBy: z
          .enum(["summons", "plate", "mykad"])
          .describe("Which reference the citizen provided"),
        reference: z.string().describe("The summons number, plate number, or IC number"),
      }),
    },
    async ({ lookupBy, reference }) =>
      toolResult(await callRoute(finesRoute, { params: { lookupBy, reference } })),
  );

  server.registerTool(
    "list_vehicles",
    {
      title: "List registered vehicles",
      description:
        "Vehicles registered to a citizen in the JPJ ownership records, including each " +
        "vehicle's road tax expiry — needed to pick the plate for a road tax renewal.",
      inputSchema: z.object({ documentNumber: documentNumberField }),
    },
    async ({ documentNumber }) =>
      toolResult(await callRoute(vehiclesRoute, { params: { documentNumber } })),
  );

  server.registerTool(
    "list_licenses",
    {
      title: "List driving licenses",
      description:
        "Driving licenses held by a citizen in the JPJ records. A license expired more than " +
        "3 years is cancelled under the Road Transport Act and cannot be renewed.",
      inputSchema: z.object({ documentNumber: documentNumberField }),
    },
    async ({ documentNumber }) =>
      toolResult(await callRoute(licensesRoute, { params: { documentNumber } })),
  );

  server.registerTool(
    "get_fee_quote",
    {
      title: "Quote service fee",
      description:
        "Fee breakdown (service fee, processing fee, total) for a service given the answers " +
        "collected so far. Registry-priced services need their answers to quote correctly: " +
        "the fine service totals the citizen's actual unpaid summonses, road tax is computed " +
        "from the vehicle's engine capacity and the chosen period. Always quote before " +
        "pay_service_fee.",
      inputSchema: z.object({
        serviceId: z.string().describe("Service id from get_service_catalog"),
        data: dataField.optional(),
      }),
    },
    async ({ serviceId, data }) =>
      toolResult(await callRoute(feesRoute, { params: { serviceId, ...data } })),
  );

  server.registerTool(
    "verify_document",
    {
      title: "Upload and verify a supporting document",
      description:
        "Uploads a supporting PDF for a service requirement and runs OCR + AI verification " +
        "that it is the right kind of document and belongs to the expected holder. Provide " +
        "the PDF either as an absolute file path on the kiosk machine or as base64 bytes. " +
        "Get documentId from get_service_details (documents[].id, or a nested " +
        "relationshipProof.id when proving a family link).",
      inputSchema: z.object({
        serviceId: z.string().describe("Service id from get_service_catalog"),
        documentId: z.string().describe("Requirement id from get_service_details"),
        documentNumber: documentNumberField
          .optional()
          .describe("Verified citizen's ID number — enables the holder-match check"),
        relatedName: z
          .string()
          .optional()
          .describe("For relationship proofs: the other party's name as it appears on the proof"),
        filePath: z
          .string()
          .optional()
          .describe("Absolute path of the PDF on the kiosk machine"),
        fileBase64: z
          .string()
          .optional()
          .describe("PDF file content, base64-encoded — alternative to filePath"),
        fileName: z.string().optional().describe("Original file name, for display"),
      }),
    },
    async ({ serviceId, documentId, documentNumber, relatedName, filePath, fileBase64, fileName }) => {
      let bytes: Buffer;
      let name: string;
      if (filePath) {
        try {
          bytes = await readFile(filePath);
        } catch {
          return failure(`could not read a document at "${filePath}"`);
        }
        name = fileName ?? path.basename(filePath);
      } else if (fileBase64) {
        bytes = Buffer.from(fileBase64, "base64");
        name = fileName ?? `${documentId}.pdf`;
      } else {
        return failure("provide the document via filePath or fileBase64");
      }
      const form = new FormData();
      form.set("serviceId", serviceId);
      form.set("documentId", documentId);
      if (documentNumber) form.set("documentNumber", documentNumber);
      if (relatedName) form.set("relatedName", relatedName);
      form.set("file", new File([new Uint8Array(bytes)], name, {
        type: documentMimeType(name) ?? "application/octet-stream",
      }));
      return toolResult(await callRoute(documentsRoute, { form }));
    },
  );

  server.registerTool(
    "pay_service_fee",
    {
      title: "Pay service fee",
      description:
        "Captures payment for a service at the kiosk terminal and returns the payment id " +
        "and receipt details. Include the same data used for the quote — paying the fine " +
        "service settles the quoted summonses. Free services cannot be paid; pass the " +
        "resulting paymentId to submit_application for fee-bearing services.",
      inputSchema: z.object({
        serviceId: z.string().describe("Service id from get_service_catalog"),
        method: z.enum(["card", "qr", "cash"]).describe("Payment method chosen by the citizen"),
        data: dataField.optional(),
        documentNumber: documentNumberField
          .optional()
          .describe("Verified citizen's ID number, to link the payment to their record"),
      }),
    },
    async ({ serviceId, method, data, documentNumber }) =>
      toolResult(
        await callRoute(paymentsRoute, {
          json: { serviceId, method, data: data ?? {}, documentNumber },
        }),
      ),
  );

  server.registerTool(
    "submit_application",
    {
      title: "Submit application",
      description:
        "Files the service application for review and returns a case id with the review " +
        "status. Eligibility is checked against the citizen's real records — outstanding " +
        "summonses, existing licenses, vehicle ownership, JKM scheme rules, pending " +
        "duplicate cases — and an ineligible application is put on hold with the reason. " +
        "Accepted applications update the registry (license renewed, road tax extended, " +
        "address changed). Verify identity first, and pay before submitting when the " +
        "service has a fee.",
      inputSchema: z.object({
        serviceId: z.string().describe("Service id from get_service_catalog"),
        documentNumber: documentNumberField.optional(),
        paymentId: z
          .string()
          .optional()
          .describe("Payment id from pay_service_fee, for fee-bearing services"),
        data: dataField.optional(),
      }),
    },
    async ({ serviceId, documentNumber, paymentId, data }) =>
      toolResult(
        await callRoute(applicationsRoute, {
          json: { serviceId, documentNumber, paymentId, data: data ?? {} },
        }),
      ),
  );

  server.registerTool(
    "list_requests",
    {
      title: "List saved and pending requests",
      description:
        "One citizen's saved (paused) drafts and submitted applications still pending " +
        "review — always scoped to a document number, never listed globally. Drafts " +
        "include the step and answers needed to resume; pending cases show their review " +
        "status. Check this before re-applying to avoid duplicates.",
      inputSchema: z.object({
        documentNumber: documentNumberField,
        serviceId: z.string().optional().describe("Filter by service"),
      }),
    },
    async ({ documentNumber, serviceId }) =>
      toolResult(await callRoute(requestsGetRoute, { params: { documentNumber, serviceId } })),
  );

  server.registerTool(
    "save_request_draft",
    {
      title: "Save request draft",
      description:
        "Saves an in-progress service request so the citizen can resume later. One draft " +
        "per citizen and service — saving again updates the existing draft.",
      inputSchema: z.object({
        serviceId: z.string().describe("Service id from get_service_catalog"),
        documentNumber: documentNumberField,
        stepId: z.string().describe("Flow step id the citizen paused at (see the service's flow)"),
        stepIndex: z.number().int().min(0).describe("Index of that step in the service's flow"),
        data: dataField.optional(),
        documents: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Document upload state collected so far, keyed by requirement id"),
      }),
    },
    async ({ serviceId, documentNumber, stepId, stepIndex, data, documents }) =>
      toolResult(
        await callRoute(requestsPostRoute, {
          json: { serviceId, documentNumber, stepId, stepIndex, data, documents },
        }),
      ),
  );

  server.registerTool(
    "delete_request_draft",
    {
      title: "Delete request draft",
      description: "Discards a saved draft by its request id (REQ-…).",
      inputSchema: z.object({
        requestId: z.string().describe("Request id from list_requests (kind \"saved\")"),
      }),
    },
    async ({ requestId }) =>
      toolResult(await callRoute(requestsDeleteRoute, { method: "DELETE", params: { requestId } })),
  );

  server.registerTool(
    "check_ai_health",
    {
      title: "Check AI service health",
      description:
        "Availability of the kiosk's document-understanding services (LLM and OCR). A " +
        "service that is \"off\" is intentionally not configured; only \"unreachable\" " +
        "means something is down. Document verification degrades gracefully without them.",
      inputSchema: z.object({}),
    },
    async () => toolResult(await callRoute(healthRoute)),
  );
}
