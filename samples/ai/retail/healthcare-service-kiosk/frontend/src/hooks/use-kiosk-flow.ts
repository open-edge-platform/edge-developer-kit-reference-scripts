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
  /** "requests" swaps the flow for the saved/pending requests list; "signin" identifies the visitor before any service. */
  view: "flow" | "requests" | "signin";
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
  | { type: "start-service"; service: ServiceDefinition; data: Record<string, string>; at?: StepId }
  | { type: "identity-verified"; identity: IdentityVerification; data?: Record<string, string> }
  | { type: "open-signin" }
  | { type: "signed-in"; identity: IdentityVerification; service?: ServiceDefinition; data?: Record<string, string> }
  | { type: "another-service" }
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
      identity?: IdentityVerification;
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

/** A verification this old is asked for again: the person at the screen may have changed. */
const SESSION_REUSE_MS = 10 * 60_000;

function stillVerified(identity: IdentityVerification | null): IdentityVerification | null {
  if (!identity) return null;
  return Date.now() - Date.parse(identity.verifiedAt) < SESSION_REUSE_MS ? identity : null;
}

/** Where a service opens: past consent and identity when the visitor already signed in this session. */
function entryIndex(service: ServiceDefinition, identity: IdentityVerification | null, at?: StepId): number {
  const requested = at ? service.flow.indexOf(at) + 1 : 1;
  const identityAt = service.flow.indexOf("identity") + 1;
  if (!identity || identityAt <= 0) return Math.max(requested, 1);
  return Math.max(requested, identityAt + 1);
}

/** Consent and identity are behind a signed-in visitor: Back from the first step after them returns to the menu. */
function skippedBefore(state: KioskFlowState): boolean {
  if (!state.identity || !state.service) return false;
  const identityAt = state.service.flow.indexOf("identity") + 1;
  return identityAt > 0 && state.stepIndex - 1 <= identityAt;
}

function reducer(state: KioskFlowState, action: Action): KioskFlowState {
  switch (action.type) {
    case "begin":
      return { ...INITIAL, started: true };
    case "select-category":
      return { ...state, categoryId: action.categoryId };
    case "clear-category":
      return { ...state, categoryId: null };
    case "select-service": {
      const identity = stillVerified(state.identity);
      return {
        ...state,
        identity,
        profile: identity ? state.profile : null,
        service: action.service,
        // Signed in, the service skips its consent step: the consent given at sign-in is the one on record.
        data: identity ? { consentAt: identity.verifiedAt, ...state.data } : state.data,
        stepIndex: entryIndex(action.service, identity),
      };
    }
    case "start-service": {
      const identity = stillVerified(state.identity);
      return {
        ...INITIAL,
        started: true,
        identity,
        profile: identity ? state.profile : null,
        service: action.service,
        data: identity ? { consentAt: identity.verifiedAt, ...action.data } : action.data,
        stepIndex: entryIndex(action.service, identity, action.at),
      };
    }
    case "open-signin":
      return { ...state, view: "signin" };
    case "signed-in":
      return {
        ...state,
        view: "flow",
        identity: action.identity,
        profile: action.identity.profile,
        categoryId: null,
        service: action.service ?? null,
        data: { consentAt: action.identity.verifiedAt, ...action.data },
        documents: {},
        stepIndex: action.service ? entryIndex(action.service, action.identity) : 0,
      };
    case "another-service":
      return {
        ...INITIAL,
        started: true,
        identity: stillVerified(state.identity),
        profile: stillVerified(state.identity) ? state.profile : null,
      };
    case "identity-verified": {
      // Registering verifies at its own step (enroll), with no identity step to move past.
      const afterIdentity = state.service?.flow.includes("identity") === false
        ? state.stepIndex + 1
        : indexAfter(state, "identity");
      // Resume only holds if the verified citizen is the one who saved the
      // draft; anyone else continues as a fresh application.
      const resumed = state.resume?.documentNumber === action.identity.documentNumber;
      return {
        ...state,
        ...(state.resume && !resumed ? { data: {}, documents: {} } : {}),
        ...(action.data ? { data: { ...(state.resume && !resumed ? {} : state.data), ...action.data } } : {}),
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
        data: { ...state.data, ...action.application.data },
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
      // A registration has no identity step to land on: the patient it made was just verified to see it.
      if (identityAt === 0 && action.identity?.documentNumber === action.documentNumber) {
        return {
          ...INITIAL,
          started: true,
          service: action.service,
          data: action.data,
          documents: action.documents,
          identity: action.identity,
          profile: action.identity.profile,
          stepIndex: action.stepIndex,
        };
      }
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
      if (state.view === "signin") return { ...state, view: "flow" };
      if (state.stepIndex === 0) {
        return state.categoryId ? { ...state, categoryId: null } : state;
      }
      if (skippedBefore(state)) return { ...state, stepIndex: 0 };
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
  /** Opens a service with answers already chosen elsewhere (a destination tile, a doctor's slot), at `at` or its first step. */
  startService: (service: ServiceDefinition, data: Record<string, string>, at?: StepId) => void;
  /** `data` carries what the identity step learned for the service, e.g. a scanned slip's appointment. */
  identityVerified: (identity: IdentityVerification, data?: Record<string, string>) => void;
  openSignIn: () => void;
  signedIn: (identity: IdentityVerification, service?: ServiceDefinition, data?: Record<string, string>) => void;
  /** Back to the menu after a finished request, still signed in. */
  anotherService: () => void;
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
      /** Who the Requests screen just verified — what a service with no identity step resumes as. */
      identity?: IdentityVerification;
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
      startService: (service, data, at) => dispatch({ type: "start-service", service, data, at }),
      identityVerified: (identity, data) => dispatch({ type: "identity-verified", identity, data }),
      openSignIn: () => dispatch({ type: "open-signin" }),
      signedIn: (identity, service, data) => dispatch({ type: "signed-in", identity, service, data }),
      anotherService: () => dispatch({ type: "another-service" }),
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
