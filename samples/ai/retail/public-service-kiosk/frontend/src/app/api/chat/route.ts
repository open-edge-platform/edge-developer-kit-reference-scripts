// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type JSONValue,
  type ModelMessage,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import { services } from "@/services";
import {
  PHYSICAL_STEP_ANSWERS,
  REQUESTS_FLOW_ID,
  browserUploads,
  type Ask,
  type FlowResponse,
  type FlowUpload,
  type QueuedService,
} from "../_lib/flows/types";
import { badRequest } from "../_lib/http";
import { languageBriefing, languageInstruction, supportedLanguage } from "../_lib/languages";
import { llmConfig } from "../_lib/llm";
import { systemPrompt } from "../_lib/prompts";
import { kioskModel } from "../_lib/llm-provider";
import { connectKioskMcp } from "../_lib/mcp-bridge";
import { singleTurnServiceBriefing } from "../_lib/service-briefing";

/**
 * One chat turn, streamed as a Vercel AI SDK UI message stream. A
 * tool-calling model answers every turn — typed, spoken or tapped — through
 * the kiosk's own MCP server; each flow tool result also reaches the client
 * as a `data-flow` part, which the UI draws as buttons and step cards.
 */

export type ChatTurnMetadata = {
  /** Start this service (a tapped suggestion). */
  startServiceId?: string;
  /** Answers to pending asks (tapped options / modal confirms). */
  answers?: Record<string, string>;
  /** PDFs answering document asks. */
  uploads?: FlowUpload[];
  /** Language the citizen was last detected speaking — the reply follows it. On a reply, the
   *  language it was written in: the voice that reads it aloud. */
  language?: string;
};

export type KioskUIMessage = UIMessage<ChatTurnMetadata, { flow: FlowResponse }>;

/** How much of the flow the model knows upfront (`agent.turns` in config.yaml): everything, unless set to "multi". */
const TURNS = process.env.KIOSK_AGENT_TURNS === "multi" ? "multi" : "single";

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

const REQUESTS_LINE =
  `- ${REQUESTS_FLOW_ID}: My Requests — the status of an application already saved or ` +
  "submitted, or resuming a saved one";

const servicesBriefing = () =>
  [
    TURNS === "single"
      ? singleTurnServiceBriefing(services())
      : services()
          .map((service) => `- ${service.id}: ${service.label} — ${service.description}`)
          .join("\n"),
    REQUESTS_LINE,
  ].join("\n");

/** Filled per turn: the detected language rides in on the message metadata. */
const systemPromptFor = (language?: string) =>
  systemPrompt(TURNS === "single" ? "agent-single" : "agent", {
    services: servicesBriefing(),
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

/** The citizen's sign-in from the latest flow that carried one: it lives in the transcript, so Start over ends it. */
function lastSignIn(messages: KioskUIMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (let j = messages[i].parts.length - 1; j >= 0; j--) {
      const part = messages[i].parts[j];
      if (part.type === "data-flow" && (part.data as FlowResponse).signIn) {
        return (part.data as FlowResponse).signIn!.token;
      }
    }
  }
  return undefined;
}

// Earlier tool results come back into the history cut to their status and ask
// ids (`replayedCall`), so this is the model's only view of what the flow is
// waiting on and which values it accepts.
function askLine(ask: Ask): string {
  const head = `- ${ask.id} (${ask.type}${ask.optional ? ", optional" : ""}): ${ask.question}`;
  if (ask.type === "action") return `${head} — confirmed by the kiosk hardware, never by you`;
  if (ask.type === "document") return `${head} — the kiosk captures and attaches the PDF`;
  if (ask.options?.length) {
    return `${head} — allowed values: ${ask.options.map((o) => `"${o.value}" (${o.label})`).join(", ")}`;
  }
  return ask.placeholder ? `${head} — for example "${ask.placeholder}"` : head;
}

function turnBriefing(
  metadata: ChatTurnMetadata,
  flow: FlowResponse | null,
  uploads: FlowUpload[],
  signedIn: boolean,
  language: string,
): string[] {
  const lines: string[] = [];
  const pending = flow?.status === "need_input" ? flow.asks : [];

  if (metadata.startServiceId) {
    lines.push(`The citizen tapped the service "${metadata.startServiceId}" on screen.`);
  }
  // Only ask ids — a face frame rides in the same map and must not reach the model.
  const tapped = Object.fromEntries(
    Object.entries(metadata.answers ?? {}).filter(([id]) => pending.some((ask) => ask.id === id)),
  );
  if (Object.keys(tapped).length > 0) {
    lines.push(
      `The citizen answered on screen: ${JSON.stringify(tapped)}. Call continue_service_flow ` +
        "— these answers are attached to it for you.",
    );
  }
  if (uploads.length > 0) {
    const ids = uploads.map((upload) => upload.documentId).join(", ");
    lines.push(
      `The citizen supplied a document for ask id(s): ${ids}. The PDF bytes are attached ` +
        "to your next continue_service_flow call automatically — do not ask for them.",
    );
  }
  if (flow?.status === "need_input") {
    lines.push(
      [
        `Current flow: serviceId "${flow.serviceId}", sessionId ` +
          `${flow.sessionId === null ? "null (pass serviceId instead)" : `"${flow.sessionId}"`}. ` +
          "Waiting on:",
        ...pending.map(askLine),
      ].join("\n"),
    );
    if (flow.queued?.length) {
      lines.push(
        `Queued after it, as the citizen asked: ${flow.queued.map((queued) => queued.serviceId).join(", ")}. ` +
          "The kiosk starts each one itself when the one before it ends — do not start them.",
      );
    }
  } else if (!metadata.startServiceId) {
    // The history holds only the replies, never the calls behind them, so after a finished service a small model
    // can take "Starting Road Tax Renewal — insert your card" for something it may simply say.
    lines.push(
      "No service is open on the screen: only a start_service_flow call starts one — words alone change nothing." +
        (signedIn ? " The citizen is still signed in, so a new service needs no card." : ""),
    );
  }
  // Last, nearest the reply it governs.
  const spoken = languageBriefing(language);
  if (spoken) lines.push(spoken);

  return lines;
}

/**
 * What actually reaches continue_service_flow. Screen answers, face frames and
 * uploads come from the kiosk itself and are attached here; a physical step is
 * the hardware's to confirm, so the model's own answer to one is dropped —
 * otherwise "I've inserted my card" would stand in for a card nobody read.
 * A document ask is answered by its PDF alone: words the model puts against
 * one ("done", a relayed error) would be filed with the case as data. And the
 * flow on screen owns its ids: a small model left to copy the session's grant
 * token, or to remember to pass it at all, loses the session instead.
 */
function amendContinue(
  input: Record<string, unknown>,
  flow: FlowResponse | null,
  screen: Record<string, string>,
  uploads: FlowUpload[],
  signIn: string | undefined,
): Record<string, unknown> {
  // A call naming some other service is the model's own; leave its ids alone.
  const current =
    flow?.status === "need_input" && (!input.serviceId || input.serviceId === flow.serviceId)
      ? flow
      : null;
  const notSpoken = new Set(PHYSICAL_STEP_ANSWERS);
  for (const ask of flow?.asks ?? []) {
    if (ask.type === "action" || ask.type === "document") notSpoken.add(ask.id);
  }
  // Non-strings too: a null the model writes would fail the tool's schema and lose the whole call.
  const spoken = Object.entries((input.answers ?? {}) as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && !notSpoken.has(entry[0]),
  );
  return {
    ...input,
    ...(current ? { serviceId: current.serviceId, sessionId: current.sessionId ?? undefined } : {}),
    // What the citizen said up front waits on the flow until the card read puts it in the draft.
    answers: { ...current?.heldAnswers, ...Object.fromEntries(spoken), ...screen },
    // The screen's documents only: the model's own `uploads` can name any file path on this machine.
    uploads: uploads.length > 0 ? uploads : undefined,
    signIn,
    // The pre-verification cardholder is flow state, not something to trust the model to copy.
    ...(flow?.serviceId === REQUESTS_FLOW_ID
      ? { serviceId: REQUESTS_FLOW_ID, citizen: flow.citizen ?? undefined }
      : {}),
  };
}

/**
 * An earlier flow step as the tool call and result behind it: a start when the service changed or the last flow
 * had ended, else a continue. The result is cut to the status and the ask ids — the reply after it already says
 * the rest, and the current asks reach the model in full through the [kiosk] lines.
 */
function replayedCall(toolCallId: string, flow: FlowResponse, before: FlowResponse | null): ModelMessage[] {
  const starts = !before || before.serviceId !== flow.serviceId || before.status !== "need_input";
  const toolName = starts ? "start_service_flow" : "continue_service_flow";
  const output = {
    status: flow.status,
    serviceId: flow.serviceId,
    ...(flow.status === "need_input" ? { asks: flow.asks.map((ask) => ask.id) } : {}),
  };
  // A start that queued more services shows how it was asked for, so the model sees `then` used.
  const input = { serviceId: flow.serviceId, ...(starts && flow.queued?.length ? { then: flow.queued } : {}) };
  return [
    { role: "assistant", content: [{ type: "tool-call", toolCallId, toolName, input }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId, toolName, output: { type: "json", value: output } }] },
  ];
}

const plainWords = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

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
  "Chat mode needs a tool-calling model, and this kiosk has none configured. Set " +
  "llm.mock to false and point llm.base_url at a server whose model supports tool " +
  "calling, then restart — or switch to touch mode, which works without one.";

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
  // Advanced by every flow result, so a call later in the turn amends against the flow it continues.
  let flow = lastFlow(messages);
  // Spliced into every flow call, never the model's to choose: a sign-in is the kiosk's record of a check that passed.
  let signIn = lastSignIn(messages);
  // What the citizen asked for besides the service on screen; it rides on every flow the route writes, like the sign-in.
  let queue: QueuedService[] = flow?.queued ?? [];
  // A file path here is the visitor's choice, not the kiosk's — see `browserUploads`.
  const uploads = browserUploads(metadata.uploads);
  const screen = metadata.answers ?? {};
  // A round the screen settled leaves nothing to decide, and a small model left to choose may narrate instead of calling.
  const pending = flow?.status === "need_input" ? flow.asks : [];
  const onScreen = (ask: Ask) => screen[ask.id] !== undefined;
  // Words that are exactly one of the offered choices ("Card", "12 months") answer the flow as surely as a tap;
  // which ask they answer is still the model's call.
  const said = plainWords(last?.parts.map((part) => (part.type === "text" ? part.text : "")).join(" ") ?? "");
  const namedOption =
    Boolean(said) &&
    pending.some((ask) =>
      ask.options?.some((o) => [o.value, o.label, o.label.split(" — ")[0]].some((text) => plainWords(text) === said)),
    );
  const roundTapped = pending.some(onScreen) && pending.every((ask) => ask.optional || onScreen(ask));
  // What a tapped round arrives saying is the screen's echo of the labels tapped; more than that is the citizen's own.
  const echo = plainWords(
    pending
      .filter(onScreen)
      .map((ask) => ask.options?.find((o) => o.value === screen[ask.id])?.label ?? screen[ask.id])
      .join(" "),
  );
  // Settled by the kiosk alone — the hardware reported, a PDF arrived, or every ask was tapped and nothing
  // said besides: the route makes that call itself, and the model only has the reply to write.
  const screenOnly =
    uploads.length > 0 ||
    pending.some((ask) => ask.type === "action" && onScreen(ask)) ||
    (roundTapped && said === echo);
  const screenSettled = screenOnly || namedOption || roundTapped;
  const mcpUrl = process.env.KIOSK_MCP_URL ?? new URL("/api/mcp", req.url).toString();

  const stream = createUIMessageStream<KioskUIMessage>({
    execute: async ({ writer }) => {
      if (llmConfig().mock) {
        await streamSay(writer, NO_MODEL_TEXT);
        return;
      }

      // Every reply — a step of a service as much as small talk — is the model's, written in this language;
      // stamped on the reply, it picks the voice that reads it, and whether the pack's own ask text is read too.
      const language = supportedLanguage(metadata.language);
      writer.write({ type: "message-metadata", messageMetadata: { language } });

      const session = await connectKioskMcp({
        url: mcpUrl,
        allow: ALLOWED_TOOLS,
        onResult: (toolName, text) => {
          if (!FLOW_TOOLS.has(toolName)) return;
          const next = parseFlow(text);
          if (!next) return;
          // A start is the citizen's plan afresh; a continue only adds to it. The model, seeing the queue in its
          // briefing, tends to pass it back on every continue — so only services not already waiting, and not the
          // one in progress, are new, or the road tax queued behind a fine would come round twice.
          const added = (next.queued ?? []).filter(
            (queued) => queued.serviceId !== next.serviceId && !queue.some((held) => held.serviceId === queued.serviceId),
          );
          queue = toolName === "start_service_flow" ? (next.queued ?? []) : [...queue, ...added];
          flow = { ...next, queued: queue.length > 0 ? queue : undefined };
          if (next.signIn) signIn = next.signIn.token;
          writer.write({ type: "data-flow", data: flow });
        },
        // Uploads are megabytes of base64 — they must never enter the model's context.
        amendInput: (toolName, input) =>
          toolName === "continue_service_flow"
            ? amendContinue(input, flow, screen, uploads, signIn)
            : toolName === "start_service_flow"
              ? { ...input, signIn }
              : input,
      });

      /**
       * A flow call, and — when it ends the flow with services still queued — the starts of the
       * ones after it, answered as one result under `next`: a single call serves "pay my saman,
       * then renew my road tax", and the model relays it all in one reply. Each start goes out
       * with the sign-in the last one earned, so the citizen shows their card once.
       */
      const runFlow = async (toolName: string, input: Record<string, unknown>): Promise<unknown> => {
        const output = await session.call(toolName, input);
        const next: unknown[] = [];
        while (flow?.status !== "need_input" && queue.length > 0) {
          const [{ serviceId, answers }, ...rest] = queue;
          // Taken off before the call, so a start that fails outright cannot stall the rest.
          queue = rest;
          next.push(
            await session.call("start_service_flow", {
              serviceId,
              ...(answers ? { answers } : {}),
              ...(rest.length > 0 ? { then: rest } : {}),
            }),
          );
        }
        if (next.length === 0) return output;
        return typeof output === "object" && output !== null ? { ...output, next } : { result: output, next };
      };
      const tools = Object.fromEntries(
        Object.entries(session.tools).map(([name, tool]) => [
          name,
          FLOW_TOOLS.has(name)
            ? { ...tool, execute: (input: unknown) => runFlow(name, (input ?? {}) as Record<string, unknown>) }
            : tool,
        ]),
      ) as typeof session.tools;

      try {
        const briefing = turnBriefing(metadata, flow, uploads, Boolean(signIn), language);
        // One text part: chat templates join a message's parts with no separator.
        const modelMessages = messages.map((message, index) => {
          const texts = message.parts.filter((part) => part.type === "text");
          if (index !== messages.length - 1 || briefing.length === 0) {
            return { ...message, parts: texts };
          }
          const text = [...texts.map((part) => part.text), `[kiosk] ${briefing.join("\n[kiosk] ")}`]
            .filter(Boolean)
            .join("\n");
          return { ...message, parts: [{ type: "text" as const, text }] };
        });
        // Each earlier flow step goes back in as the call that made it, ahead of the reply that relayed it: a
        // transcript of replies alone teaches a small model that saying "Starting Road Tax Renewal" is enough.
        const history: ModelMessage[] = [];
        let shown: FlowResponse | null = null;
        for (const [index, message] of modelMessages.entries()) {
          const flows = messages[index].parts
            .filter((part) => part.type === "data-flow")
            .map((part) => part.data as FlowResponse);
          if (message.role === "assistant") {
            for (const [step, next] of flows.entries()) {
              history.push(...replayedCall(`replay-${message.id}-${step}`, next, shown));
              shown = next;
            }
          }
          history.push(...(await convertToModelMessages([message])));
        }

        if (screenOnly && flow) {
          // Written into the transcript as the model's own call, so the reply it writes reads the same as after one.
          const toolCallId = `kiosk-${crypto.randomUUID()}`;
          const input = flow.sessionId ? { sessionId: flow.sessionId } : { serviceId: flow.serviceId };
          const output = await runFlow("continue_service_flow", input);
          history.push(
            {
              role: "assistant",
              content: [{ type: "tool-call", toolCallId, toolName: "continue_service_flow", input }],
            },
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId,
                  toolName: "continue_service_flow",
                  output:
                    typeof output === "string"
                      ? { type: "text", value: output }
                      : { type: "json", value: output as JSONValue },
                },
              ],
            },
          );
        }

        // Thinking is for working out what the citizen meant; relaying a flow's answer, or making a call the
        // screen already settled, decides nothing. (Gemma 4 marks thinking at the top of the prompt, so a switch
        // re-reads it from the start — still quicker than thinking through every relay.)
        const relaying = kioskModel({ thinking: false });
        const result = streamText({
          model: kioskModel(),
          system: systemPromptFor(language),
          messages: history,
          tools,
          stopWhen: stepCountIs(MAX_STEPS),
          prepareStep: ({ stepNumber, steps }) =>
            screenOnly || madeItsPoint(steps)
              ? { activeTools: [], model: relaying }
              : stepNumber === 0 && screenSettled
                ? { activeTools: ["continue_service_flow"], toolChoice: "required", model: relaying }
                : {},
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
    // A turn that throws mid-stream otherwise dies silently: the SDK masks
    // errors to "" by default, the stream just ends, and the client is left
    // deciding what nothing means.
    onError: (error) =>
      `The kiosk hit a problem: ${error instanceof Error ? error.message : String(error)}`,
  });

  return createUIMessageStreamResponse({ stream });
}
