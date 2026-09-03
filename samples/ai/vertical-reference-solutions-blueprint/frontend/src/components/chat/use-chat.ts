// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useChat as useAIChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { KioskUIMessage } from "@/app/api/chat/route";
import type { Ask, FlowResponse, FlowUpload } from "@/app/api/_lib/flows/types";

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
 */
export function speakableText(message: KioskUIMessage): string {
  const flow = message.parts.findLast((part) => part.type === "data-flow")?.data as
    | FlowResponse
    | undefined;
  const spoken = [messageText(message)];

  for (const ask of flow?.status === "need_input" ? flow.asks : []) {
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

/**
 * @param api  Which brain answers the turn. `/api/chat` is the deterministic
 *   one — the flow engine decides, the LLM only does two tiny NLU tasks.
 *   `/api/chat/agent` is the agentic one, a tool-calling loop over the
 *   kiosk's MCP server. Both stream the same parts, so the UI is unchanged.
 */
export function useKioskChat({ api = "/api/chat" }: { api?: string } = {}) {
  const { messages, sendMessage, status, stop, setMessages, error, regenerate, clearError } =
    useAIChat<KioskUIMessage>({
      transport: new DefaultChatTransport({ api }),
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
    sendText: (text: string, language?: string) =>
      sendMessage({ text, ...(language ? { metadata: { language } } : {}) }),
    startService: (serviceId: string, label: string) =>
      sendMessage({ text: label, metadata: { startServiceId: serviceId } }),
    sendAnswers: (answers: Record<string, string>, shownAs: string) =>
      sendMessage({ text: shownAs, metadata: { answers } }),
    sendUpload: (upload: FlowUpload, shownAs: string) =>
      sendMessage({ text: shownAs, metadata: { uploads: [upload] } }),
  };
}
