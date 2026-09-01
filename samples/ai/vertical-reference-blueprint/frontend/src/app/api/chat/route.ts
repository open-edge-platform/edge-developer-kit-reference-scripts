// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import { SERVICES } from "@/services";
import {
  continueFlow,
  continueRequestsFlow,
  startFlow,
  startRequestsFlow,
} from "../_lib/flows/engine";
import { classifyService, extractAnswers } from "../_lib/flows/nlu";
import { DEVICE_STEP_REPLY, REQUESTS_FLOW_ID, browserUploads } from "../_lib/flows/types";
import type { Ask, FlowResponse, FlowUpload } from "../_lib/flows/types";
import { languageInstruction } from "../_lib/languages";
import { llmConfig } from "../_lib/llm";
import { systemPrompt } from "../_lib/prompts";
import { kioskModel } from "../_lib/llm-provider";
import { badRequest } from "../_lib/http";

/**
 * One chat turn for the assistant kiosk, streamed as a Vercel AI SDK UI
 * message stream. The flow engine owns all orchestration; each turn ships the
 * FlowResponse to the client as a `data-flow` part (the UI renders asks as
 * buttons and step modals from it) and streams the reply text. Structured
 * turns (tapped options, modal confirms, uploads) ride in on the user
 * message's metadata and involve no LLM; free text goes through the two
 * single-task NLU prompts, and off-topic questions fall back to a streamed
 * LLM reply when a real model is configured.
 */

export type ChatTurnMetadata = {
  /** Start this service (a tapped suggestion). */
  startServiceId?: string;
  /** Answers to pending asks (tapped options / modal confirms / typed text). */
  answers?: Record<string, string>;
  /** PDFs answering document asks. */
  uploads?: FlowUpload[];
  /** Language the citizen was last detected speaking — the reply follows it. */
  language?: string;
};

export type KioskUIMessage = UIMessage<ChatTurnMetadata, { flow: FlowResponse }>;

/** The flow state this conversation is in — the last data-flow part wins. */
function lastFlow(messages: KioskUIMessage[]): FlowResponse | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (let j = messages[i].parts.length - 1; j >= 0; j--) {
      const part = messages[i].parts[j];
      if (part.type === "data-flow") return part.data as FlowResponse;
    }
  }
  return null;
}

function lastUserText(messages: KioskUIMessage[]): string {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return "";
  return last.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}

type Writer = UIMessageStreamWriter<KioskUIMessage>;

/** Stream fixed text word by word, so deterministic replies read like the
 *  LLM ones instead of appearing in one block. */
async function streamSay(writer: Writer, text: string): Promise<void> {
  const id = "say";
  writer.write({ type: "text-start", id });
  for (const chunk of text.match(/\S+\s*/g) ?? []) {
    writer.write({ type: "text-delta", id, delta: chunk });
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 12));
  }
  writer.write({ type: "text-end", id });
}

async function streamFlow(writer: Writer, flow: FlowResponse): Promise<void> {
  writer.write({ type: "data-flow", data: flow });
  await streamSay(writer, flow.say);
}

const HELP_TEXT =
  "I can help you with these services — tap one below or tell me what you need:\n" +
  SERVICES.map((s) => `• ${s.label}`).join("\n");

/** Streamed LLM reply for anything outside a flow; canned help when mocked. */
async function streamAssistantReply(
  writer: Writer,
  messages: KioskUIMessage[],
  language?: string,
): Promise<void> {
  const config = llmConfig();
  if (config.mock) {
    await streamSay(writer, HELP_TEXT);
    return;
  }
  const result = streamText({
    model: kioskModel(),
    system: systemPrompt("assistant", {
      services: SERVICES.map((s) => `- ${s.label}: ${s.description}`).join("\n"),
      ...languageInstruction(language),
    }),
    messages: await convertToModelMessages(
      // Data parts and metadata are ours; the model only needs the words.
      messages.map((m) => ({
        ...m,
        parts: m.parts.filter((p) => p.type === "text"),
      })),
    ),
    maxOutputTokens: config.maxTokens,
    temperature: 0.3,
  });
  writer.merge(result.toUIMessageStream({ sendStart: false, sendFinish: false }));
}

export async function POST(req: Request) {
  let messages: KioskUIMessage[];
  try {
    ({ messages } = (await req.json()) as { messages: KioskUIMessage[] });
    if (!Array.isArray(messages)) throw new Error();
  } catch {
    return badRequest("expected { messages: UIMessage[] }");
  }

  const last = messages[messages.length - 1];
  const metadata = (last?.metadata ?? {}) as ChatTurnMetadata;
  const flow = lastFlow(messages);
  const active = flow?.status === "need_input" ? flow : null;
  const text = lastUserText(messages);
  // Everything below this line came out of the client's own message
  // metadata — see `browserUploads` for what that means for a file path.
  const uploads = browserUploads(metadata.uploads);

  // The My Requests pseudo-flow never has a draft session; its state (the
  // read-but-unverified cardholder) rides in the echoed flow's `citizen`.
  const continueActive = (answers?: Record<string, string>, uploads?: FlowUpload[]) =>
    active?.serviceId === REQUESTS_FLOW_ID
      ? continueRequestsFlow({
          answers,
          citizen: active?.citizen,
          // Carries the verification grant, without which the cardholder in
          // `citizen` is only a claim the client made.
          sessionId: active?.sessionId,
        })
      : continueFlow({
          sessionId: active?.sessionId,
          serviceId: active?.serviceId,
          answers,
          uploads,
        });

  const stream = createUIMessageStream<KioskUIMessage>({
    execute: async ({ writer }) => {
      // Structured turns — no language understanding involved.
      if (metadata.startServiceId) {
        await streamFlow(
          writer,
          metadata.startServiceId === REQUESTS_FLOW_ID
            ? await startRequestsFlow()
            : await startFlow(metadata.startServiceId),
        );
        return;
      }
      if (Object.keys(metadata.answers ?? {}).length > 0 || uploads.length > 0) {
        await streamFlow(writer, await continueActive(metadata.answers, uploads));
        return;
      }
      if (!text) {
        await streamSay(writer, "I didn't receive anything — how can I help?");
        return;
      }

      // Free text while a flow is waiting: map it onto the pending asks.
      if (active) {
        const askable = active.asks.filter((a: Ask) => a.type === "options" || a.type === "text");
        const extracted = askable.length > 0 ? await extractAnswers(text, askable) : {};
        if (Object.keys(extracted).length > 0) {
          await streamFlow(writer, await continueActive(extracted));
          return;
        }
        const needsDevice = active.asks.some((a: Ask) => a.type !== "options" && a.type !== "text");
        await streamSay(
          writer,
          needsDevice
            ? DEVICE_STEP_REPLY
            : "Sorry, I didn't catch an answer in that — please pick one of the options " +
                "shown, or rephrase.",
        );
        return;
      }

      // Free text with no active flow: route to a service (or the identity-
      // gated My Requests flow), else chat.
      const serviceId = await classifyService(text);
      if (serviceId === REQUESTS_FLOW_ID) {
        await streamFlow(writer, await startRequestsFlow());
        return;
      }
      if (serviceId) {
        await streamFlow(writer, await startFlow(serviceId));
        return;
      }
      await streamAssistantReply(writer, messages, metadata.language);
    },
    // A turn that throws mid-stream otherwise dies silently: the SDK masks
    // errors to "" by default, the stream just ends, and the client is left
    // deciding what nothing means. Same wording as the agent route.
    onError: (error) =>
      `The kiosk hit a problem: ${error instanceof Error ? error.message : String(error)}`,
  });

  return createUIMessageStreamResponse({ stream });
}
