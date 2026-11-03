// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import type { StepProps } from "@/services/shared/step-props";
import { Result } from "@/services/shared/steps/result";
import { EmailResults } from "../email-results";

/** The results with "Email me a copy" beside Print. */
export default function LabResultsResult(props: StepProps) {
  const documentNumber = props.state.identity?.documentNumber;
  return <Result {...props} extra={documentNumber ? <EmailResults documentNumber={documentNumber} /> : null} />;
}
