// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AskField } from "@/components/kiosk/ask-field";
import { StepCard } from "@/components/kiosk/step-card";
import { answerData, hospitalAnswerOffline, hospitalFixed, type GroundedAnswer } from "@/hospital/answers";
import { DEPARTMENTS } from "@/hospital/data";
import { askHospital } from "@/lib/api/answers";
import { ChoiceChips, SectionLabel } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";
import { DISCOVERY_EXAMPLE, DISCOVERY_QUESTION, POPULAR_TOPICS } from "../discovery";

// Keep in sync with chain.ts: both answer through the same guide and checks.
export default function ServiceDiscoveryStep({ actions }: StepProps) {
  const [question, setQuestion] = useState("");
  const ask = useMutation({ mutationFn: askHospital, retry: false });

  const answer = (query: string) => {
    const finish = (result: GroundedAnswer) => actions.stepCompleted("application", { topic: query, ...answerData(result) });
    const fixed = hospitalFixed(query);
    if (fixed) return finish(fixed);
    ask.mutate(query, { onSuccess: finish, onError: () => finish(hospitalAnswerOffline(query)) });
  };

  return (
    <StepShell title="What would you like to know?" subtitle="Type your question, or tap a common topic or department." className="max-w-5xl">
      <StepCard>
        <AskField
          label={DISCOVERY_QUESTION}
          placeholder={DISCOVERY_EXAMPLE}
          value={question}
          onChange={setQuestion}
          onAsk={() => answer(question.trim())}
          pending={ask.isPending}
        />
        <SectionLabel className="mt-7">Common questions</SectionLabel>
        <ChoiceChips
          label="Common questions"
          options={POPULAR_TOPICS.map((t) => ({ id: t.id, label: t.question }))}
          value={null}
          onSelect={(id) => answer(`topic:${id}`)}
        />
        <SectionLabel className="mt-7">Departments</SectionLabel>
        <ChoiceChips
          label="Departments"
          options={DEPARTMENTS.map((d) => ({ id: d.id, label: d.name }))}
          value={null}
          onSelect={(id) => answer(`dept:${id}`)}
        />
      </StepCard>
    </StepShell>
  );
}
