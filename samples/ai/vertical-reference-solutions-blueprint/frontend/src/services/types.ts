// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Shared steps ("consent", "identity", "documents", "payment", "receipt") render from `shared/steps/`; any other id resolves from the service's own `steps/<id>.tsx`. */
export type StepId = string;

/** "service" (selection screen) followed by the selected service's flow. */
export type KioskStepId = StepId;

export type CategoryIconId =
  | "car"
  | "book"
  | "id-card"
  | "house"
  | "users"
  | "shield";

export type HolderDetail = "name" | "nationalId";

export type DocumentRequirement = {
  id: string;
  label: string;
  hint: string;
  /** Registry details this document prints and so are compared against it. Defaults to name and IC number; an empty list checks the document type only. Never the address — that is read via `addressField` instead. */
  holderDetails?: HolderDetail[];
  /** The kinds of paperwork that satisfy this requirement — the scan must be any ONE of them, not a compound document. */
  accepts?: string[];
  /** Who the citizen is on paperwork that names several people (e.g. the complainant on a police report), so the holder check compares the right name. */
  holderRole?: string;
  /** Flow-data key the address printed on the document is saved under (extracted, not compared against the registered address). */
  addressField?: string;
  /** Fallback requirement offered when the upload carries another person's name: prove a family link instead of being rejected. */
  relationshipProof?: DocumentRequirement;
};

/** Exported as `category` from `<level-1>/category.ts`. */
export type CategoryMeta = {
  id: string;
  label: string;
  description: string;
  icon: CategoryIconId;
  order?: number;
};

/** Exported as `group` from `<level-1>/<level-2>/group.ts`. */
export type GroupMeta = {
  label: string;
  order?: number;
};

/** One application-step field, for the agent briefing (api/_lib/service-briefing.ts); the runtime asks still come from the service's `chain.ts`. */
export type FieldSpec = {
  /** Flow-data key the answer is stored under ("plate", "period", …). */
  id: string;
  /** The briefing line's text after the id — what to collect, and the accepted values where they are fixed. */
  briefing: string;
};

/** Exported as `service` from `<level-1>/<level-2>/<level-3>/service.ts`. */
export type ServiceDefinition = {
  id: string;
  label: string;
  description: string;
  /** Service fee in whole currency units; 0 means the service is free. */
  fee: number;
  /** Fee override keyed on a flow answer: when `data[field]` matches a rate key, that rate replaces `fee`. e.g. { field: "duration", rates: { "1": 30, "3": 90, "5": 150 } } */
  pricing?: { field: string; rates: Record<string, number> };
  order?: number;
  /** Repeatable services (e.g. fine payment) may be submitted again while an earlier case is pending; others are blocked as duplicates. */
  repeatable?: boolean;
  documents: DocumentRequirement[];
  /** Application-step fields for the agent briefing. Absent (with "application" in the flow) means the fields depend on the citizen's records; an empty list means the service collects nothing itself. */
  fields?: FieldSpec[];
  /** Extra briefing lines about this service, rendered after the fields. */
  briefingNotes?: string[];
  /** Ordered chain of steps this service walks after selection. */
  flow: StepId[];
  /** Stepper label overrides for custom steps, e.g. { application: "Ceremony" }. */
  stepLabels?: Record<StepId, string>;
  /** Folder path within src/services — filled in by the catalog builder. */
  dir?: string;
};

export type ServiceGroup = GroupMeta & {
  services: ServiceDefinition[];
};

export type CategoryDefinition = CategoryMeta & {
  groups: ServiceGroup[];
};
