// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { AnswerResult } from "@/components/kiosk/answer-result";
import { readAnswer } from "@/hospital/answers";
import SharedResultStep from "@/services/shared/steps/result";
import type { StepProps } from "@/services/shared/step-props";

export default function AnswerResultStep(props: StepProps) {
  const answer = readAnswer(props.state.data);
  return answer ? <AnswerResult answer={answer} state={props.state} actions={props.actions} /> : <SharedResultStep {...props} />;
}
