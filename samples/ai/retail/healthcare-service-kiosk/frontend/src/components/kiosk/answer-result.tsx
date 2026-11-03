// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import {
  BookOpen,
  CircleQuestionMark,
  Info,
  MessageSquareText,
  Navigation,
  RotateCcw,
  Siren,
  Sparkles,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAutoRestart } from "@/hooks/use-auto-restart";
import type { GroundedAnswer } from "@/hospital/answers";
import { department } from "@/hospital/data";
import { cn } from "@/lib/utils";
import { getService } from "@/services";
import type { StepProps } from "@/services/shared/step-props";
import { ClosingActions } from "./closing-actions";
import { CtaButton } from "./cta-button";
import { IconCircle } from "./icon-circle";
import { SecondaryButton } from "./secondary-button";
import { StepCard } from "./step-card";
import type { Tone } from "./tone";

const LOOK: Record<GroundedAnswer["kind"], { icon: LucideIcon; tone: Tone; iconClass: string }> = {
  answer: { icon: MessageSquareText, tone: "info", iconClass: "text-primary" },
  unknown: { icon: CircleQuestionMark, tone: "warning", iconClass: "text-warning" },
  refusal: { icon: Stethoscope, tone: "warning", iconClass: "text-warning" },
  emergency: { icon: Siren, tone: "danger", iconClass: "text-destructive" },
};

/** The result screen of a question service: the answer, where it came from, and a way there when it is a place. */
export function AnswerResult({ answer, state, actions }: { answer: GroundedAnswer } & Pick<StepProps, "state" | "actions">) {
  const restart = useAutoRestart({ when: true, onRestart: actions.reset });
  const directions = getService("directions");
  const destination = answer.destination;
  const showWay =
    directions && destination
      ? () => actions.startService(directions, { destination, stepFree: "no" }, "result")
      : undefined;
  const look = LOOK[answer.kind];
  const Icon = look.icon;
  const asked = answer.question.trim() && answer.question !== answer.title ? answer.question.trim() : null;

  return (
    <div className="grid w-full max-w-6xl animate-ks-fade items-center gap-9 md:landscape:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] portrait:max-w-3xl">
      <div className="flex flex-col items-center gap-4 text-center">
        <IconCircle tone={look.tone} className="size-28">
          <Icon className={cn("size-14", look.iconClass)} strokeWidth={1.6} />
        </IconCircle>
        <h1 className="text-4xl font-bold tracking-tight text-balance">{answer.title}</h1>
        {asked && <p className="text-xl text-pretty text-muted-foreground">You asked: “{asked}”</p>}
        <ClosingActions
          restart={restart}
          signedIn={Boolean(state.identity)}
          onFinish={actions.reset}
          onAnother={actions.anotherService}
        />
      </div>

      <StepCard className="gap-5 p-8">
        {answer.kind === "emergency" ? (
          <EmergencyPanel answer={answer} onShowWay={showWay} />
        ) : (
          <>
            {answer.aiAssisted && (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-sm font-semibold text-primary">
                <Sparkles className="size-4" />
                AI-assisted answer
              </span>
            )}
            <p className="text-2xl leading-relaxed text-pretty">{answer.text}</p>
            {answer.sources.length > 0 && (
              <div className="flex items-start gap-2.5 text-base text-muted-foreground">
                <BookOpen className="mt-0.5 size-5 shrink-0" />
                <span>
                  Source: {answer.sources.map((s) => `${s.title} · ${s.source}`).join("; ")}
                </span>
              </div>
            )}
            {answer.related && (
              <div className="rounded-2xl bg-secondary p-5">
                <div className="text-base font-semibold text-muted-foreground">This may help</div>
                <div className="mt-1 text-lg font-semibold">{answer.related.title}</div>
                <p className="mt-1 text-lg text-pretty">{answer.related.text}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              {showWay && (
                <CtaButton className="h-14 px-7 text-lg" onClick={showWay}>
                  <Navigation className="size-5" />
                  Show me the way
                </CtaButton>
              )}
              <SecondaryButton onClick={actions.back}>
                <RotateCcw />
                Ask another question
              </SecondaryButton>
            </div>
          </>
        )}
        {answer.note && (
          <div className="flex items-start gap-2.5 border-t pt-4 text-base text-muted-foreground">
            <Info className="mt-0.5 size-5 shrink-0 text-warning" />
            {answer.note}
          </div>
        )}
      </StepCard>
    </div>
  );
}

function EmergencyPanel({ answer, onShowWay }: { answer: GroundedAnswer; onShowWay?: () => void }) {
  const ed = department("emergency");
  return (
    <>
      <div role="alert" className="flex items-start gap-4 rounded-2xl bg-destructive/10 p-5 text-destructive">
        <Siren className="mt-1 size-8 shrink-0" />
        <p className="text-2xl leading-snug font-semibold text-pretty">{answer.text}</p>
      </div>
      {ed && (
        <p className="text-lg">
          <span className="font-semibold">{ed.name}</span> · {ed.building}, {ed.floor} · {ed.hours}
        </p>
      )}
      {onShowWay && (
        <Button
          className="h-16 w-fit gap-2.5 rounded-2xl bg-destructive px-8 font-heading text-xl font-semibold text-white hover:bg-destructive/90"
          onClick={onShowWay}
        >
          <Navigation className="size-6" />
          Show the way to Emergency
        </Button>
      )}
      <p className="text-lg text-muted-foreground">If you cannot get there yourself, tell any staff member now.</p>
    </>
  );
}
