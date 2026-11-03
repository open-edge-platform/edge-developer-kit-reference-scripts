// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { StepError } from "@/components/kiosk/status-block";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { useSubmitApplication } from "@/hooks/use-kiosk-api";
import { ChoiceChips, RatingScale, SectionLabel, TextField } from "@/services/shared/fields";
import { resultData } from "@/services/shared/result";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";
import { AREA_OPTIONS, RATING_OPTIONS, feedbackResult } from "../outcome";

export default function PatientSurveyStep({ service, actions }: StepProps) {
  const [rating, setRating] = useState("");
  const [area, setArea] = useState("");
  const [comment, setComment] = useState("");

  const answers = { rating, area, comment: comment.trim() };
  const submit = useSubmitApplication({ serviceId: service!.id, data: answers });
  const ready = Boolean(rating) && Boolean(area) && !submit.isPending;

  return (
    <StepShell title="How was your visit today?" subtitle="Your feedback helps the hospital improve." className="max-w-3xl">
      <StepCard>
        <SectionLabel>Overall rating</SectionLabel>
        <RatingScale labels={RATING_OPTIONS.map((r) => r.label)} value={rating} onSelect={setRating} />
        <SectionLabel>Which area is this about?</SectionLabel>
        <ChoiceChips
          label="Area"
          options={AREA_OPTIONS.map((a) => ({ id: a, label: a }))}
          value={area}
          onSelect={setArea}
        />
        <TextField
          id="comment"
          label="Comments (optional)"
          value={comment}
          onChange={setComment}
          placeholder="Tell us more about your visit"
          className="mt-6"
        />
        <StepActions
          ready={ready}
          idleLabel={submit.isPending ? "Sending your feedback…" : "Rate your visit and choose an area to continue"}
          label="Submit feedback"
          onContinue={() =>
            submit.mutate(null, {
              onSuccess: ({ application }) =>
                actions.stepCompleted("application", {
                  ...answers,
                  ...resultData(feedbackResult(Number(answers.rating), answers.area, answers.comment, application)),
                }),
            })
          }
        />
        {submit.isError && <StepError>We couldn&apos;t send your feedback — please try again.</StepError>}
      </StepCard>
    </StepShell>
  );
}
