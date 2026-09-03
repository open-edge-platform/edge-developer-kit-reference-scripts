// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessageStreamWriter,
} from "ai";
import { SERVICES } from "@/services";
import { browserUploads, type FlowResponse } from "../../_lib/flows/types";
import { badRequest } from "../../_lib/http";
import { languageInstruction } from "../../_lib/languages";
import { llmConfig } from "../../_lib/llm";
import { systemPrompt } from "../../_lib/prompts";
import { kioskModel } from "../../_lib/llm-provider";
import { connectKioskMcp } from "../../_lib/mcp-bridge";
import { singleTurnServiceBriefing } from "../../_lib/service-briefing";
import type { ChatTurnMetadata, KioskUIMessage } from "../route";

/** How much of the flow the model knows upfront (`agent.turns` in config.yaml). */
const TURNS = process.env.KIOSK_AGENT_TURNS === "single" ? "single" : "multi";

const FLOW_TOOLS = new Set(["start_service_flow", "continue_service_flow"]);

// Guided flow tools only — the granular ones (payments, submissions) stay out on purpose.
const ALLOWED_TOOLS =
  TURNS === "single"
    ? [...FLOW_TOOLS]
    : [
        "get_service_catalog",
        "get_service_details",
        "start_service_flow",
        "continue_service_flow",
      ];

/** Tool round-trips allowed per turn before the loop is cut off. */
const MAX_STEPS = Number(process.env.KIOSK_AGENT_MAX_STEPS ?? 8);

// Chat-template markers that must end a turn — a gateway that applies the
// model's template improperly can let it run past its turn otherwise.
const STOP_SEQUENCES = (process.env.KIOSK_AGENT_STOP ?? "<|im_end|>,<|im_start|>,\nuser\n")
  .split(",")
  .map((sequence) => sequence.replace(/\\n/g, "\n"))
  .filter(Boolean);

const SERVICES_BRIEFING =
  TURNS === "single"
    ? singleTurnServiceBriefing(SERVICES)
    : SERVICES.map(
        (service) => `- ${service.id}: ${service.label} — ${service.description}`,
      ).join("\n");

/** Filled per turn: the detected language rides in on the message metadata. */
const systemPromptFor = (language?: string) =>
  systemPrompt(TURNS === "single" ? "agent-single" : "agent", {
    services: SERVICES_BRIEFING,
    ...languageInstruction(language),
  });

type Writer = UIMessageStreamWriter<KioskUIMessage>;

/** True once a flow tool answered or the model repeated a call — tools are
 *  withdrawn (not the turn ended) so it still has a step left to reply. */
function madeItsPoint(steps: { toolCalls: { toolName: string; input: unknown }[] }[]): boolean {
  const seen = new Set<string>();
  for (const step of steps) {
    for (const call of step.toolCalls) {
      if (FLOW_TOOLS.has(call.toolName)) return true;
      const signature = `${call.toolName}:${JSON.stringify(call.input ?? {})}`;
      if (seen.has(signature)) return true;
      seen.add(signature);
    }
  }
  return false;
}

function parseFlow(text: string): FlowResponse | null {
  try {
    const parsed = JSON.parse(text) as Partial<FlowResponse>;
    if (typeof parsed?.status !== "string" || !Array.isArray(parsed.asks)) return null;
    return parsed as FlowResponse;
  } catch {
    return null;
  }
}

function lastFlow(messages: KioskUIMessage[]): FlowResponse | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (let j = messages[i].parts.length - 1; j >= 0; j--) {
      const part = messages[i].parts[j];
      if (part.type === "data-flow") return part.data as FlowResponse;
    }
  }
  return null;
}

function turnBriefing(metadata: ChatTurnMetadata, flow: FlowResponse | null): string[] {
  const lines: string[] = [];

  if (metadata.startServiceId) {
    lines.push(`The citizen tapped the service "${metadata.startServiceId}" on screen.`);
  }
  if (metadata.answers && Object.keys(metadata.answers).length > 0) {
    lines.push(
      `The citizen answered on screen: ${JSON.stringify(metadata.answers)}. These are ` +
        "already ask ids and option values — pass them through unchanged.",
    );
  }
  if (metadata.uploads?.length) {
    const ids = metadata.uploads.map((upload) => upload.documentId).join(", ");
    lines.push(
      `The citizen supplied a document for ask id(s): ${ids}. The PDF bytes are attached ` +
        "to your next continue_service_flow call automatically — do not ask for them.",
    );
  }
  if (flow?.status === "need_input") {
    lines.push(
      `Current flow: serviceId "${flow.serviceId}", sessionId ` +
        `${flow.sessionId === null ? "null (pass serviceId instead)" : `"${flow.sessionId}"`}. ` +
        `Waiting on ask id(s): ${flow.asks.map((ask) => ask.id).join(", ") || "none"}.`,
    );
  }

  return lines;
}

async function streamSay(writer: Writer, text: string): Promise<void> {
  const id = "say";
  writer.write({ type: "text-start", id });
  for (const chunk of text.match(/\S+\s*/g) ?? []) {
    writer.write({ type: "text-delta", id, delta: chunk });
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 12));
  }
  writer.write({ type: "text-end", id });
}

const NO_MODEL_TEXT =
  "Agentic mode needs a real tool-calling model, and this kiosk has none configured. " +
  "Set KIOSK_LLM_MOCK=false and point KIOSK_LLM_BASE_URL at a server whose model " +
  "supports tool calling, then restart. The Chat Assistant mode works without one.";

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
  // A file path here is the visitor's choice, not the kiosk's — see `browserUploads`.
  const uploads = browserUploads(metadata.uploads);
  const mcpUrl = process.env.KIOSK_MCP_URL ?? new URL("/api/mcp", req.url).toString();

  const stream = createUIMessageStream<KioskUIMessage>({
    execute: async ({ writer }) => {
      if (llmConfig().mock) {
        await streamSay(writer, NO_MODEL_TEXT);
        return;
      }

      const session = await connectKioskMcp({
        url: mcpUrl,
        allow: ALLOWED_TOOLS,
        onResult: (toolName, text) => {
          if (!FLOW_TOOLS.has(toolName)) return;
          const next = parseFlow(text);
          if (next) writer.write({ type: "data-flow", data: next });
        },
        // Uploads are megabytes of base64 — they must never enter the model's context.
        amendInput: (toolName, input) =>
          toolName === "continue_service_flow" && uploads.length > 0
            ? { ...input, uploads }
            : input,
      });

      try {
        const briefing = turnBriefing(metadata, flow);
        const modelMessages = messages.map((message, index) => ({
          ...message,
          parts:
            index === messages.length - 1 && briefing.length > 0
              ? [
                  ...message.parts.filter((part) => part.type === "text"),
                  { type: "text" as const, text: `[kiosk] ${briefing.join("\n[kiosk] ")}` },
                ]
              : message.parts.filter((part) => part.type === "text"),
        }));

        const result = streamText({
          model: kioskModel(),
          system: systemPromptFor(metadata.language),
          messages: await convertToModelMessages(modelMessages),
          tools: session.tools,
          stopWhen: stepCountIs(MAX_STEPS),
          prepareStep: ({ steps }) => (madeItsPoint(steps) ? { activeTools: [] } : {}),
          stopSequences: STOP_SEQUENCES,
          maxOutputTokens: llmConfig().maxTokens,
          temperature: 0,
        });

        writer.merge(result.toUIMessageStream({ sendStart: false, sendFinish: false }));
        // Hold the MCP session open until the tool loop is actually done.
        await result.finishReason;
      } finally {
        await session.close().catch(() => {});
      }
    },
    onError: (error) =>
      `The kiosk hit a problem: ${error instanceof Error ? error.message : String(error)}`,
  });

  return createUIMessageStreamResponse({ stream });
}
