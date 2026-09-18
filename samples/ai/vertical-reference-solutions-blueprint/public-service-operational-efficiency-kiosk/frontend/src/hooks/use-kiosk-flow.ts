// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useMemo, useReducer } from "react";
import type {
  ApplicationReceipt,
  CitizenProfile,
  IdentityVerification,
  PaymentReceipt,
  UploadedDocument,
} from "@/lib/api/kiosk";
import { STANDARD_FLOW } from "@/services/shared/flow";
import type { KioskStepId, ServiceDefinition, StepId } from "@/services/types";

export type KioskFlowState = {
  started: boolean;
  /** "requests" swaps the flow for the saved/pending requests list. */
  view: "flow" | "requests";
  categoryId: string | null;
  service: ServiceDefinition | null;
  /** Index into the step chain: 0 = service selection, 1.. = service.flow. */
  stepIndex: number;
  identity: IdentityVerification | null;
  profile: CitizenProfile | null;
  documents: Record<string, UploadedDocument>;
  /** Answers collected by service-specific steps, keyed by field name. */
  data: Record<string, string>;
  payment: PaymentReceipt | null;
  application: ApplicationReceipt | null;
  /**
   * Set while resuming a saved request: the step to jump to once identity is
   * re-verified, plus the ID number the draft belongs to. A different citizen
   * verifying starts a fresh flow instead of inheriting the saved answers.
   */
  resume: { stepIndex: number; documentNumber: string } | null;
};

type Action =
  | { type: "begin" }
  | { type: "select-category"; categoryId: string }
  | { type: "clear-category" }
  | { type: "select-service"; service: ServiceDefinition }
  | { type: "identity-verified"; identity: IdentityVerification }
  | { type: "document-uploaded"; document: UploadedDocument }
  | { type: "step-completed"; stepId: StepId; data?: Record<string, string> }
  | { type: "submitted"; payment: PaymentReceipt | null; application: ApplicationReceipt }
  | { type: "open-requests" }
  | { type: "close-requests" }
  | {
      type: "resume-request";
      service: ServiceDefinition;
      documentNumber: string;
      stepIndex: number;
      data: Record<string, string>;
      documents: Record<string, UploadedDocument>;
    }
  | { type: "next" }
  | { type: "back" }
  | { type: "reset" };

const INITIAL: KioskFlowState = {
  started: false,
  view: "flow",
  categoryId: null,
  service: null,
  stepIndex: 0,
  identity: null,
  profile: null,
  documents: {},
  data: {},
  payment: null,
  application: null,
  resume: null,
};

/** Step index right after `stepId` in the active service's chain. */
function indexAfter(state: KioskFlowState, stepId: StepId): number {
  const flow = state.service?.flow ?? STANDARD_FLOW;
  return flow.indexOf(stepId) + 2;
}

function reducer(state: KioskFlowState, action: Action): KioskFlowState {
  switch (action.type) {
    case "begin":
      return { ...INITIAL, started: true };
    case "select-category":
      return { ...state, categoryId: action.categoryId };
    case "clear-category":
      return { ...state, categoryId: null };
    case "select-service":
      return { ...state, service: action.service, stepIndex: 1 };
    case "identity-verified": {
      const afterIdentity = indexAfter(state, "identity");
      // Resume only holds if the verified citizen is the one who saved the
      // draft; anyone else continues as a fresh application.
      const resumed = state.resume?.documentNumber === action.identity.documentNumber;
      return {
        ...state,
        ...(state.resume && !resumed ? { data: {}, documents: {} } : {}),
        identity: action.identity,
        profile: action.identity.profile,
        stepIndex: resumed ? Math.max(state.resume!.stepIndex, afterIdentity) : afterIdentity,
        resume: null,
      };
    }
    case "document-uploaded":
      return {
        ...state,
        documents: { ...state.documents, [action.document.documentId]: action.document },
      };
    case "step-completed":
      return {
        ...state,
        data: { ...state.data, ...action.data },
        stepIndex: indexAfter(state, action.stepId),
      };
    case "submitted":
      return {
        ...state,
        payment: action.payment,
        application: action.application,
        stepIndex: indexAfter(state, "payment"),
      };
    case "open-requests":
      return { ...state, view: "requests" };
    case "close-requests":
      return { ...state, view: "flow" };
    case "resume-request": {
      // Land on the identity step first: the draft's answers are restored,
      // but the citizen must re-verify before continuing where they stopped.
      const identityAt = action.service.flow.indexOf("identity") + 1;
      return {
        ...INITIAL,
        started: true,
        service: action.service,
        data: action.data,
        documents: action.documents,
        stepIndex: identityAt > 0 ? identityAt : action.stepIndex,
        resume:
          identityAt > 0
            ? { stepIndex: action.stepIndex, documentNumber: action.documentNumber }
            : null,
      };
    }
    case "next": {
      const flow = state.service?.flow ?? STANDARD_FLOW;
      return { ...state, stepIndex: Math.min(state.stepIndex + 1, flow.length) };
    }
    case "back":
      if (state.stepIndex === 0) {
        return state.categoryId ? { ...state, categoryId: null } : state;
      }
      return { ...state, stepIndex: state.stepIndex - 1 };
    case "reset":
      return INITIAL;
  }
}

export type KioskFlowActions = {
  begin: () => void;
  selectCategory: (categoryId: string) => void;
  clearCategory: () => void;
  selectService: (service: ServiceDefinition) => void;
  identityVerified: (identity: IdentityVerification) => void;
  documentUploaded: (document: UploadedDocument) => void;
  stepCompleted: (stepId: StepId, data?: Record<string, string>) => void;
  submitted: (payment: PaymentReceipt | null, application: ApplicationReceipt) => void;
  openRequests: () => void;
  closeRequests: () => void;
  resumeRequest: (
    service: ServiceDefinition,
    request: {
      documentNumber: string;
      stepIndex: number;
      data: Record<string, string>;
      documents: Record<string, UploadedDocument>;
    },
  ) => void;
  next: () => void;
  back: () => void;
  reset: () => void;
};

export function useKioskFlow() {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  const steps = useMemo<KioskStepId[]>(
    () => ["service", ...(state.service?.flow ?? STANDARD_FLOW)],
    [state.service],
  );
  const currentStep = steps[state.stepIndex];

  const actions = useMemo<KioskFlowActions>(
    () => ({
      begin: () => dispatch({ type: "begin" }),
      selectCategory: (categoryId) => dispatch({ type: "select-category", categoryId }),
      clearCategory: () => dispatch({ type: "clear-category" }),
      selectService: (service) => dispatch({ type: "select-service", service }),
      identityVerified: (identity) => dispatch({ type: "identity-verified", identity }),
      documentUploaded: (document) => dispatch({ type: "document-uploaded", document }),
      stepCompleted: (stepId, data) => dispatch({ type: "step-completed", stepId, data }),
      submitted: (payment, application) => dispatch({ type: "submitted", payment, application }),
      openRequests: () => dispatch({ type: "open-requests" }),
      closeRequests: () => dispatch({ type: "close-requests" }),
      resumeRequest: (service, request) => dispatch({ type: "resume-request", service, ...request }),
      next: () => dispatch({ type: "next" }),
      back: () => dispatch({ type: "back" }),
      reset: () => dispatch({ type: "reset" }),
    }),
    [],
  );

  return { state, steps, currentStep, actions };
}
