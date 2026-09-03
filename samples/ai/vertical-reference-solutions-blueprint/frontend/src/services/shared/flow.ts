// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { DocumentRequirement, HolderDetail, StepId } from "../types";

/** The default step chain; services insert custom steps or drop shared ones. */
export const STANDARD_FLOW: StepId[] = [
  "consent",
  "identity",
  "documents",
  "payment",
  "receipt",
];

/** An identity document prints both the name and the IC number, and they are
 *  what identifies its holder — the address on it is not checked, because a
 *  MyKad printed before the citizen moved still shows the old home. */
export const PROOF_OF_IDENTITY: DocumentRequirement = {
  id: "identity",
  label: "Proof of Identity",
  hint: "MyKad, MyTentera or Passport",
  accepts: ["A MyKad (photocopy or scan)", "A MyTentera", "A passport biodata page"],
  holderDetails: ["name", "nationalId"],
};

/**
 * A service's supporting document.
 *
 * `label` names the paperwork this service actually wants, because the label
 * is what the document check is told to expect: asked whether a scan is a
 * "Supporting Document", a model answers that a police report is a police
 * report and refuses it. It is also what the citizen reads on screen, and
 * "Income Proof" is a clearer instruction than "Supporting Document" there
 * too.
 *
 * `holderDetails` says which of the citizen's registry details the accepted
 * paperwork actually prints — the default suits documents carrying both a
 * name and an IC number (test-result slips, police reports, payslips, birth
 * certificates); a service whose paperwork carries less passes its own list.
 */
export function supportingDocument(
  label: string,
  hint: string,
  accepts: string[],
  { holderDetails = ["name", "nationalId"], holderRole }: SupportingOptions = {},
): DocumentRequirement {
  return { id: "supporting", label, hint, accepts, holderDetails, holderRole };
}

type SupportingOptions = {
  holderDetails?: HolderDetail[];
  /** Who the applicant is on paperwork that names several people. */
  holderRole?: string;
};
