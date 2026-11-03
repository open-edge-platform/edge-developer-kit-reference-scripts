// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cmsFindOne } from "./cms";
import { findCitizenByDocument } from "./citizens";

export type PriorCase = { caseId: string; status: string; submittedAt: string };

/** The citizen's earlier live case for a service, approved included — held duplicates don't count. */
export async function findPriorCase(serviceId: string, documentNumber: string): Promise<PriorCase | null> {
  const citizen = await findCitizenByDocument(documentNumber);
  if (!citizen) return null;
  return cmsFindOne<PriorCase>("applications", {
    serviceId: { equals: serviceId },
    citizen: { equals: citizen.id },
    status: { in: "in_review,officer_review,approved" },
  });
}
