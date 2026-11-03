// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { ArrowDown, Check, MousePointerClick, PenLine } from "lucide-react";
import type { Ask } from "@/app/api/_lib/flows/types";
import { ActionHint } from "@/components/kiosk/action-hint";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const chip = cn(
  "flex min-h-14 items-center gap-2.5 rounded-xl border px-6 py-3 text-left text-lg font-medium",
  "transition-[transform,background-color,border-color] duration-200",
  "hover:border-ring focus-visible:outline-2 focus-visible:outline-ring",
);

export function AnswerChips({
  asks,
  picked,
  activeTextAsk,
  canListen = false,
  onPick,
  onContinue,
  onOther,
}: {
  asks: Ask[];
  picked: Record<string, string>;
  activeTextAsk?: Ask;
  canListen?: boolean;
  onPick: (ask: Ask, value: string) => void;
  onContinue: () => void;
  /** Answering off the list: hands over to the composer, where the words go to the assistant. */
  onOther?: () => void;
}) {
  const choiceAsks = asks.filter((a) => a.type === "options");
  const textAsks = asks.filter((a) => a.type === "text");
  const requiredDone = asks
    .filter((a) => a.type !== "document" && !a.optional)
    .every((a) => picked[a.id]);
  // With a text field open the composer belongs to it, so it cannot also take a free answer.
  const offerOther = onOther && textAsks.length === 0;

  return (
    <div className="flex animate-ks-fade flex-col gap-5 rounded-2xl border border-primary/25 bg-card p-4 sm:p-5">
      <ActionHint
        icon={MousePointerClick}
        direction={choiceAsks.length > 0 ? "none" : "down"}
        className="mx-0 mb-0 self-start"
      >
        {choiceAsks.length > 0 && textAsks.length > 0
          ? "Tap an answer below, then type the rest"
          : choiceAsks.length > 0
            ? "Tap an answer below"
            : "Type your answer below"}
        {canListen ? " — or say it out loud" : "."}
      </ActionHint>
      {choiceAsks.map((ask, index) => (
        <div key={ask.id} role="group" aria-labelledby={`ask-${ask.id}`}>
          <div id={`ask-${ask.id}`} className="mb-3 text-lg font-semibold text-pretty">
            {ask.question}
          </div>
          <div className="ks-stagger flex flex-wrap gap-3">
            {ask.options?.map((option) => {
              const chosen = picked[ask.id] === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => onPick(ask, option.value)}
                  className={cn(
                    chip,
                    chosen ? "border-primary bg-primary/10 text-primary" : "bg-field",
                  )}
                >
                  {chosen && <Check className="size-5 animate-ks-pop" strokeWidth={3} />}
                  {option.label}
                </button>
              );
            })}
            {offerOther && index === choiceAsks.length - 1 && (
              <button
                type="button"
                onClick={onOther}
                className={cn(chip, "border-dashed text-muted-foreground hover:text-foreground")}
              >
                <PenLine className="size-5" />
                Other
              </button>
            )}
          </div>
        </div>
      ))}
      {textAsks.map((ask) => (
        <div key={ask.id} className="text-lg">
          <span className="font-semibold">{ask.question}</span>{" "}
          {picked[ask.id] ? (
            <span className="inline-flex items-center gap-1.5 text-primary">
              <Check className="size-5" strokeWidth={3} />
              {picked[ask.id]}
            </span>
          ) : ask === activeTextAsk ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
              <ArrowDown className="size-5 animate-ks-nudge text-primary" />
              type your answer below
              <span className="inline-block h-5 w-0.5 animate-ks-caret bg-primary align-middle" />
            </span>
          ) : null}
        </div>
      ))}
      {asks.length > 1 && requiredDone && (
        <Button
          className="ks-attention-ring h-14 animate-ks-pop self-start rounded-2xl px-7 text-lg font-semibold"
          onClick={onContinue}
        >
          <Check className="size-6" />
          Continue
        </Button>
      )}
    </div>
  );
}
