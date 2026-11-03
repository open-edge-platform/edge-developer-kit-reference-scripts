// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Check } from "lucide-react";
import type { FlowResponse } from "@/app/api/_lib/flows/types";
import type { KioskUIMessage } from "@/app/api/chat/route";
import { slotsOf } from "@/modules/slots";
import { cn } from "@/lib/utils";
import { deviceSteps } from "./device-steps";
import { ReceiptCard, ResultCard } from "./receipt-card";
import { messageText, speakableText } from "./use-chat";
import { narrationLanguage, type ChatVoice } from "./use-chat-voice";
import { SpeakButton } from "./voice-controls";

/** A device confirm or a self-captured document is something the machine did, so it renders
 *  as a completed step rather than as the citizen saying "done". */
function stepReceipt(message: KioskUIMessage): string | null {
  const metadata = message.metadata;
  if (!metadata) return null;
  if (metadata.uploads?.length) {
    return messageText(message).replace(/^[📄📎]\s*/u, "") || "Document captured";
  }
  const answers = metadata.answers ?? {};
  // Only device-step confirms count — extras like `faceFrame` ride along in the same map.
  const steps = deviceSteps();
  const ids = Object.keys(answers).filter((id) => id in steps && answers[id] === "done");
  if (ids.length === 0) return null;
  return ids.map((id) => steps[id].receipt).join(" · ");
}

export function Message({
  message,
  beingRead,
  voice,
}: {
  message: KioskUIMessage;
  beingRead?: boolean;
  /** Set when text-to-speech is up and this reply is complete. */
  voice?: ChatVoice;
}) {
  const text = messageText(message);
  if (message.role === "user") {
    const receipt = stepReceipt(message);
    if (receipt) return <StepReceipt>{receipt}</StepReceipt>;
    return text ? <Bubble role="user">{text}</Bubble> : null;
  }
  const route = message.parts
    .map((part) => (part.type === "data-flow" ? (part.data as FlowResponse).route : undefined))
    .findLast(Boolean);
  return (
    <>
      {message.parts.map((part, index) => {
        if (part.type === "text" && part.text) {
          return (
            <Bubble key={index} role="bot" dimmed={beingRead}>
              {part.text}
            </Bubble>
          );
        }
        if (part.type === "data-flow") {
          const flow = part.data as FlowResponse;
          // A check-in keeps its ticket over the map to the clinic; a plain route's map is its result.
          if (flow.receipt) return <ReceiptCard key={index} flow={flow} />;
          if (flow.route) return null;
          return flow.status === "completed" && flow.say ? <ResultCard key={index} flow={flow} /> : null;
        }
        return null;
      })}
      {voice && text && (
        <SpeakButton
          voice={voice}
          messageId={message.id}
          text={speakableText(message)}
          language={narrationLanguage(message)}
        />
      )}
      {route && slotsOf("routeCards").map((RouteCard, index) => <RouteCard key={index} route={route} />)}
    </>
  );
}

function StepReceipt({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex animate-ks-fade items-center gap-2.5 self-center rounded-full border border-success/40 bg-success/10 px-4 py-2 text-sm font-semibold text-success">
      <Check className="size-4 shrink-0" strokeWidth={3} />
      {children}
    </div>
  );
}

export function Bubble({
  role,
  dimmed,
  children,
}: {
  role: "user" | "bot";
  dimmed?: boolean;
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div
      className={cn(
        "flex",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "min-w-0 max-w-[92%] rounded-2xl px-4 py-3 text-base leading-relaxed whitespace-pre-line [overflow-wrap:anywhere] sm:max-w-[85%] sm:px-5 sm:text-lg",
          isUser ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border bg-field",
          dimmed && "border-primary/40 ring-2 ring-primary/10",
        )}
      >
        <span className="mb-1 block text-xs font-semibold opacity-75">{isUser ? "You" : "Patient assistant"}</span>
        <div>{children}</div>
      </div>
    </div>
  );
}
