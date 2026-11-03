// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useChat as useAIChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { KioskUIMessage } from "@/app/api/chat/route";
import type { Ask, FlowResponse, FlowUpload } from "@/app/api/_lib/flows/types";
import { activePack } from "@/packs";

/**
 * Chat session state for the assistant kiosk, on the Vercel AI SDK. Replies
 * stream in as UI message parts; the flow engine's state arrives as a
 * `data-flow` part on each assistant message, and the server re-derives the
 * active session from the echoed history — the client only ships structured
 * turns (tapped options, modal confirms, uploads) as message metadata.
 *
 * This hook is the whole client side of the conversation; the UI around it
 * only renders. A voice version wraps the same hook: speech-to-text feeds
 * `sendText`, text-to-speech reads the streamed bot text back.
 */
/** Plain text of a message — every text part joined, trimmed. */
export function messageText(message: KioskUIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

/**
 * What the kiosk should read aloud for a message.
 *
 * The streamed reply is only half of what the screen says: the flow's asks —
 * the question, the choices, the prices printed on them, the instruction to
 * insert a MyKad — arrive as a `data-flow` part and are drawn as buttons and
 * dialogs. Someone who is not looking at the screen would hear "the last step
 * is payment" and never learn what the options were, so narration reads the
 * asks too. The visible UI is unchanged; this is the spoken version of it.
 *
 * The asks are the pack's own copy, though, so they are read only after a
 * reply in the pack's language. A reply in another language already asks the
 * question and names the options in the citizen's words — the model relays
 * every ask — and the pack's wording after it would be read out in that
 * language's voice.
 */
export function speakableText(message: KioskUIMessage): string {
  const flow = message.parts.findLast((part) => part.type === "data-flow")?.data as
    | FlowResponse
    | undefined;
  const spoken = [messageText(message)];
  const language = message.metadata?.language;
  const inPackLanguage = !language || language === activePack().locale.language;

  for (const ask of flow?.status === "need_input" && inPackLanguage ? flow.asks : []) {
    spoken.push(ask.question);
    if (ask.options?.length) {
      // The labels carry the detail that matters aloud — "1 year — MYR 30.00".
      spoken.push(
        ask.options.length === 1
          ? `Just say ${ask.options[0].label}.`
          : `You can say: ${ask.options.map((option) => option.label).join("; ")}.`,
      );
    } else if (ask.type === "text" && ask.placeholder) {
      spoken.push(`For example: ${ask.placeholder}.`);
    }
  }

  return spoken.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function useKioskChat() {
  const { messages, sendMessage, status, stop, setMessages, error, regenerate, clearError } =
    useAIChat<KioskUIMessage>({
      transport: new DefaultChatTransport({ api: "/api/chat" }),
    });

  const busy = status === "submitted" || status === "streaming";

  let flow: FlowResponse | null = null;
  outer: for (let i = messages.length - 1; i >= 0; i--) {
    for (let j = messages[i].parts.length - 1; j >= 0; j--) {
      const part = messages[i].parts[j];
      if (part.type === "data-flow") {
        flow = part.data as FlowResponse;
        break outer;
      }
    }
  }

  /** Asks currently waiting on the citizen. */
  const pendingAsks: Ask[] = flow?.status === "need_input" ? flow.asks : [];

  return {
    messages,
    status,
    busy,
    /** The turn that never arrived. A transport failure — network drop, the
     *  server erroring, a stream cut off — otherwise ends with the spinner
     *  disappearing and nothing else changing, which reads as the kiosk
     *  having ignored the citizen. The UI shows this and offers the retry. */
    failed: status === "error" ? (error ?? new Error("request failed")) : null,
    /** Re-run the turn that failed, leaving the transcript as it is. */
    retry: () => {
      regenerate();
    },
    flow,
    pendingAsks,
    /** Wipe the conversation (and any streaming turn) — a fresh start keeps
     *  the small model's context clean; server flow state lives in the
     *  message history, so clearing it ends the active flow too. Any saved
     *  draft remains resumable at the touch kiosk. */
    reset: () => {
      stop();
      clearError();
      setMessages([]);
    },
    // Every turn names the session's language — a tap or an upload as much as words — and the reply is written in it.
    /** `answers` are options already tapped this round, so words finishing it don't drop them. */
    sendText: (text: string, language: string, answers?: Record<string, string>) =>
      sendMessage({
        text,
        metadata: {
          language,
          ...(answers && Object.keys(answers).length > 0 ? { answers } : {}),
        },
      }),
    startService: (serviceId: string, label: string, language: string) =>
      sendMessage({ text: label, metadata: { startServiceId: serviceId, language } }),
    sendAnswers: (answers: Record<string, string>, shownAs: string, language: string) =>
      sendMessage({ text: shownAs, metadata: { answers, language } }),
    sendUpload: (upload: FlowUpload, shownAs: string, language: string) =>
      sendMessage({ text: shownAs, metadata: { uploads: [upload], language } }),
  };
}
