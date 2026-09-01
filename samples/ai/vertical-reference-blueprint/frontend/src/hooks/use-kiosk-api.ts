// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  capturePayment,
  captureDocument,
  confirmCapture,
  discardCapture,
  discardRequest,
  getCatalog,
  getFeeQuote,
  getServiceHealth,
  listRequests,
  lookupFines,
  lookupLicenses,
  lookupVehicles,
  mockDocument,
  readCaptureProgress,
  readIdentityDocument,
  saveRequest,
  scanDocument,
  submitApplication,
  uploadDocument,
  verifyIdentity,
  type ApplicationReceipt,
  type DocumentCapture,
  type IdentityMethod,
  type IdentityVerification,
  type PaymentMethod,
  type PaymentReceipt,
  type UploadedDocument,
} from "@/lib/api/kiosk";

/** Query keys for every kiosk API read, so invalidation stays consistent. */
export const kioskKeys = {
  health: ["health"] as const,
  catalog: ["catalog"] as const,
  identityDocument: ["identity-document"] as const,
  fee: (serviceId: string, data: Record<string, string>) => ["fee", serviceId, data] as const,
  fines: (lookupBy: string, reference: string) => ["fines", lookupBy, reference] as const,
  vehicles: (documentNumber: string) => ["vehicles", documentNumber] as const,
  licenses: (documentNumber: string) => ["licenses", documentNumber] as const,
  requests: (documentNumber?: string, serviceId?: string) =>
    ["requests", documentNumber ?? "", serviceId ?? ""] as const,
};

/**
 * Poll AI-service availability. `unavailable` is true when a configured
 * service has stopped responding (or the kiosk backend itself is down), and
 * stays false while the very first check is still in flight so the kiosk
 * does not flash the out-of-service screen on load.
 */
export function useServiceHealth() {
  const query = useQuery({
    queryKey: kioskKeys.health,
    queryFn: getServiceHealth,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    staleTime: 0,
    retry: false,
  });
  return { unavailable: query.isError || query.data?.ok === false, services: query.data?.services };
}

export function useCatalog() {
  return useQuery({ queryKey: kioskKeys.catalog, queryFn: getCatalog });
}

/**
 * Wait for the reader peripheral to report the citizen's MyKad / passport.
 * Never cached: each visit to the identity step must wait for a fresh read.
 *
 * No retries. A real read already waits at the reader for as long as
 * `nfc.timeout_ms` allows, so a failure means that wait ran out or the reader
 * is unavailable — and retrying it silently three more times leaves somebody
 * watching "waiting for your document" for minutes with nothing to act on.
 * Failing once puts the Try Again button on screen, which re-arms the reader.
 */
export function useIdentityDocument() {
  return useQuery({
    queryKey: kioskKeys.identityDocument,
    queryFn: readIdentityDocument,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useVerifyIdentity(onSuccess?: (identity: IdentityVerification) => void) {
  return useMutation({
    mutationFn: (input: {
      method: IdentityMethod;
      documentNumber: string;
      /** JPEG data URL off the kiosk camera; null on a camera-free terminal. */
      image?: string | null;
    }) => verifyIdentity(input.method, input.documentNumber, input.image),
    onSuccess,
  });
}

export function useUploadDocument(
  serviceId: string,
  documentNumber: string | undefined,
  onSuccess?: (document: UploadedDocument) => void,
) {
  return useMutation({
    mutationFn: (input: { documentId: string; file: File; relatedName?: string }) =>
      uploadDocument(serviceId, input.documentId, input.file, documentNumber, input.relatedName),
    onSuccess,
  });
}

/**
 * Scanner-mode capture: the backend runs the attached scanner and the
 * mutation resolves once the citizen has fed the document into it, or fails
 * after the scanner timeout.
 */
export function useScanDocument(
  serviceId: string,
  documentNumber: string | undefined,
  onSuccess?: (document: UploadedDocument) => void,
) {
  return useMutation({
    mutationFn: (input: { documentId: string; relatedName?: string }) =>
      scanDocument(serviceId, input.documentId, documentNumber, input.relatedName),
    onSuccess,
  });
}

/** Mock-mode capture: resolves with the stand-in document for the requirement. */
export function useMockDocument(
  serviceId: string,
  documentNumber: string | undefined,
  onSuccess?: (document: UploadedDocument) => void,
) {
  return useMutation({
    mutationFn: (input: { documentId: string; relatedName?: string }) =>
      mockDocument(serviceId, input.documentId, documentNumber, input.relatedName),
    onSuccess,
  });
}

/** How often the screen asks the server which phase a long capture is in. */
const PROGRESS_POLL_MS = 800;

/**
 * The touch kiosk's two-phase document capture: get the paper, show it to the
 * citizen, and file it only once they confirm.
 *
 * The whole thing is one hook because the two phases are one act as far as
 * the screen is concerned — the same card is busy for both, the same trace id
 * carries progress for both, and a preview left unconfirmed has to be thrown
 * away whichever way the citizen leaves it. Splitting them left the step
 * juggling two mutations, a held id and a poll, and getting the busy state
 * wrong between them.
 *
 * `phase` is what the server reports it is actually doing, so the screen can
 * stop saying "feed the document into the scanner" the moment the scanner has
 * taken it.
 */
export function useDocumentCapture(
  serviceId: string,
  documentNumber: string | undefined,
  onConfirmed?: (document: UploadedDocument) => void,
) {
  const [trace, setTrace] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCapture | null>(null);

  const progress = useQuery({
    queryKey: ["document-progress", trace],
    queryFn: () => readCaptureProgress(trace!),
    enabled: Boolean(trace),
    refetchInterval: PROGRESS_POLL_MS,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const capture = useMutation({
    mutationFn: (input: { documentId: string; relatedName?: string; file?: File }) => {
      const traceId = newTraceId();
      setTrace(traceId);
      return captureDocument(serviceId, input.documentId, traceId, input.file);
    },
    onSuccess: (captured, input) =>
      setPending({ capture: captured, relatedName: input.relatedName }),
    onSettled: () => setTrace(null),
  });

  const confirm = useMutation({
    mutationFn: (input: { captureId: string; relatedName?: string }) => {
      const traceId = newTraceId();
      setTrace(traceId);
      return confirmCapture(input.captureId, traceId, documentNumber, input.relatedName);
    },
    onSuccess: (document) => {
      setPending(null);
      onConfirmed?.(document);
    },
    onSettled: () => setTrace(null),
  });

  /** Let go of a capture the citizen rejected; the server forgets the bytes. */
  const discard = useCallback(() => {
    const captureId = pending?.capture.captureId;
    setPending(null);
    confirm.reset();
    if (captureId) discardCapture(captureId).catch(() => {});
  }, [confirm, pending]);

  const busy = capture.isPending || confirm.isPending;
  return {
    /** Start a capture. Pass `file` only on an upload terminal. */
    start: capture.mutate,
    /** File the capture on show, once the citizen says it is the right one. */
    confirm: () =>
      pending &&
      confirm.mutate({
        captureId: pending.capture.captureId,
        relatedName: pending.relatedName,
      }),
    discard,
    /** The capture awaiting the citizen's yes or no, if any. */
    pending,
    /** Which document is busy right now — the card uses it to show the spinner. */
    busyId: capture.isPending ? capture.variables?.documentId : undefined,
    busy,
    confirming: confirm.isPending,
    phase: busy ? (progress.data?.phase ?? null) : null,
    page: progress.data?.page,
    pageCount: progress.data?.pages,
    error: capture.error ?? confirm.error,
    reset: () => {
      capture.reset();
      confirm.reset();
    },
  };
}

type PendingCapture = { capture: DocumentCapture; relatedName?: string };

/** Trace ids only correlate progress polls within this session, so a counter
 *  is enough when crypto.randomUUID is unavailable (non-HTTPS contexts). */
let traceSeq = 0;
const newTraceId = () =>
  globalThis.crypto?.randomUUID?.() ?? `trace-${Date.now()}-${++traceSeq}`;

export function useFeeQuote(serviceId: string, data: Record<string, string>) {
  return useQuery({
    queryKey: kioskKeys.fee(serviceId, data),
    queryFn: () => getFeeQuote(serviceId, data),
  });
}

/**
 * Outstanding summonses matching a summons number, plate, or IC number.
 * Pass `enabled: false` until the visitor explicitly triggers the search.
 */
export function useFineLookup(lookupBy: string, reference: string, enabled = true) {
  return useQuery({
    queryKey: kioskKeys.fines(lookupBy, reference),
    queryFn: () => lookupFines(lookupBy, reference),
    enabled,
  });
}

/**
 * Vehicles registered to the verified citizen. Pass the document number from
 * `state.identity`; the query stays idle until identity is verified.
 */
export function useVehicles(documentNumber: string | undefined) {
  return useQuery({
    queryKey: kioskKeys.vehicles(documentNumber ?? ""),
    queryFn: () => lookupVehicles(documentNumber ?? ""),
    enabled: Boolean(documentNumber),
  });
}

/**
 * Driving licenses held by the verified citizen. Pass the document number
 * from `state.identity`; the query stays idle until identity is verified.
 */
export function useLicenses(documentNumber: string | undefined) {
  return useQuery({
    queryKey: kioskKeys.licenses(documentNumber ?? ""),
    queryFn: () => lookupLicenses(documentNumber ?? ""),
    enabled: Boolean(documentNumber),
  });
}

/**
 * One citizen's unified requests list: saved drafts plus applications still
 * in review. Requests are only ever listed per citizen, so keep the query
 * disabled until identity is verified and a document number is known.
 */
export function useRequests(documentNumber?: string, serviceId?: string, enabled = true) {
  return useQuery({
    queryKey: kioskKeys.requests(documentNumber, serviceId),
    queryFn: () => listRequests({ documentNumber, serviceId }),
    enabled,
    staleTime: 0,
  });
}

/** Save (pause) the in-progress application so it can be resumed later. */
export function useSaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveRequest,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["requests"] }),
  });
}

export function useDiscardRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: discardRequest,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["requests"] }),
  });
}

export type SubmissionResult = {
  payment: PaymentReceipt | null;
  application: ApplicationReceipt;
};

/**
 * Capture payment (when a method is given) and submit the application in one
 * step. Pass `null` as the method for fee-free services.
 */
export function useSubmitApplication(input: {
  serviceId: string;
  data: Record<string, string>;
  documentNumber?: string;
}) {
  return useMutation({
    mutationFn: async (method: PaymentMethod | null): Promise<SubmissionResult> => {
      const payment = method
        ? await capturePayment(input.serviceId, method, input.data, input.documentNumber)
        : null;
      const application = await submitApplication({
        serviceId: input.serviceId,
        paymentId: payment?.paymentId,
        documentNumber: input.documentNumber,
        data: input.data,
      });
      return { payment, application };
    },
  });
}
