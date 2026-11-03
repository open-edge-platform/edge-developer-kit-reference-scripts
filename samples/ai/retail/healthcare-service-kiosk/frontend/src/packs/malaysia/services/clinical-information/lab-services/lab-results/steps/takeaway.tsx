// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { TakeawayProps } from "@/packs/malaysia/steps";
import { EmailResults } from "../email-results";

export default function LabResultsTakeaway({ documentNumber }: TakeawayProps) {
  return documentNumber ? <EmailResults documentNumber={documentNumber} /> : null;
}
