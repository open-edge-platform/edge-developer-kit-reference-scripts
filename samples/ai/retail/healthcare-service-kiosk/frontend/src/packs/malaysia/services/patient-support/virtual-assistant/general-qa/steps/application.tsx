// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AskField } from "@/components/kiosk/ask-field";
import { Notice } from "@/components/kiosk/notice";
import { StepCard } from "@/components/kiosk/step-card";
import { answerData, healthAnswerOffline, healthFixed, type GroundedAnswer } from "@/hospital/answers";
import { HEALTH_DISCLAIMER } from "@/hospital/data";
import { askHealth } from "@/lib/api/answers";
import { ChoiceChips, SectionLabel } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";
import { HEALTH_EXAMPLE, HEALTH_QUESTION, POPULAR_HEALTH_TOPICS } from "../answer";

// Keep in sync with chain.ts: red flags, then the advice guard, then the guide.
export default function HealthQuestionStep({ actions }: StepProps) {
  const [question, setQuestion] = useState("");
  const ask = useMutation({ mutationFn: askHealth, retry: false });

  const answer = (query: string) => {
    const finish = (result: GroundedAnswer) => actions.stepCompleted("application", { question: query, ...answerData(result) });
    const fixed = healthFixed(query);
    if (fixed) return finish(fixed);
    ask.mutate(query, { onSuccess: finish, onError: () => finish(healthAnswerOffline(query)) });
  };

  return (
    <StepShell title="Ask a health question" subtitle="Type your own question, or tap a common topic." className="max-w-4xl">
      <StepCard>
        <AskField
          label={HEALTH_QUESTION}
          placeholder={HEALTH_EXAMPLE}
          value={question}
          onChange={setQuestion}
          onAsk={() => answer(question.trim())}
          pending={ask.isPending}
        />
        <SectionLabel className="mt-7">Common topics</SectionLabel>
        <ChoiceChips
          label="Common topics"
          options={POPULAR_HEALTH_TOPICS.map((t) => ({ id: t.id, label: t.question }))}
          value={null}
          onSelect={(id) => answer(POPULAR_HEALTH_TOPICS.find((t) => t.id === id)!.question)}
        />
        <Notice className="mt-7">{HEALTH_DISCLAIMER}</Notice>
      </StepCard>
    </StepShell>
  );
}
