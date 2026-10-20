// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Rescues tool calls from servers that do not emit them.
 *
 * Several OpenAI-compatible gateways — the OpenVINO/Edge AI Demo Studio one
 * this kiosk is built against among them — accept a `tools` parameter but
 * never parse what the model produces back into `tool_calls`. Qwen-style
 * models answer in their own markup, so the call arrives as ordinary
 * assistant text and `tool_calls` comes back empty. Any agent loop built on
 * the AI SDK then sees a model that simply narrates what it would do.
 *
 * This transform sits in the provider's `fetch` and repairs the SSE stream:
 * text is passed through untouched until a tool-call block starts, from
 * which point it is captured instead of streamed, and at the end of the
 * response it is re-emitted as the `tool_calls` delta the SDK expects.
 *
 * It is inert on a server that does its own tool parsing: without an opening
 * marker in the text nothing is ever captured, and a real `tool_calls` delta
 * passes straight through.
 *
 * At most one call is rescued per response. A server that leaves tool calls
 * in the text is typically one whose stop tokens are not being applied
 * either, so the model runs on and repeats the same block several times;
 * emitting each one would call the tool once per repetition. Taking the
 * first and dropping the rest of the response makes the turn behave the way
 * a server that ended it properly would.
 *
 * When no tools were offered for the step there is nothing to rescue the
 * markup into, so it is stripped instead: a model in this state tends to
 * write out the call, then a `<tool_response>` it invented, then the
 * citizen's next line for them. None of that may reach the screen, and it
 * all follows the same opening marker — so the response simply ends there.
 */

const OPEN = "<tool_call>";
const CLOSE = "</tool_call>";

/** Both shapes Qwen-family models emit inside the block. */
type ParsedCall = { name: string; args: Record<string, unknown> };

/** `{"name": "x", "arguments": {...}}` — the JSON dialect. */
function parseJsonCall(block: string): ParsedCall | null {
  const start = block.indexOf("{");
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(block.slice(start, block.lastIndexOf("}") + 1)) as {
      name?: unknown;
      arguments?: unknown;
      parameters?: unknown;
    };
    if (typeof parsed.name !== "string") return null;
    const args = parsed.arguments ?? parsed.parameters ?? {};
    return {
      name: parsed.name,
      args: (typeof args === "string" ? JSON.parse(args) : args) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/**
 * `<function=name><parameter=key>value</parameter></function>` — the XML
 * dialect. Values arrive as text, so anything that looks like JSON is parsed
 * back into the object or number the tool's schema is expecting.
 */
function parseXmlCall(block: string): ParsedCall | null {
  const name = /<function=([^>\s]+)>/.exec(block)?.[1];
  if (!name) return null;
  const args: Record<string, unknown> = {};
  const param = /<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/g;
  for (let m = param.exec(block); m !== null; m = param.exec(block)) {
    const raw = m[2].trim();
    try {
      args[m[1]] = JSON.parse(raw);
    } catch {
      args[m[1]] = raw;
    }
  }
  return { name, args };
}

function parseCall(block: string): ParsedCall | null {
  return parseJsonCall(block) ?? parseXmlCall(block);
}

/** How much of `text`'s tail could still grow into `marker`. */
function danglingPrefix(text: string, marker: string): number {
  const max = Math.min(text.length, marker.length - 1);
  for (let len = max; len > 0; len--) {
    if (text.endsWith(marker.slice(0, len))) return len;
  }
  return 0;
}

type Chunk = {
  choices?: { index?: number; delta?: { content?: string | null }; finish_reason?: string | null }[];
};

/**
 * Wraps an SSE chat-completions response so emitted tool-call markup becomes
 * real `tool_calls` deltas. Returns the response unchanged when there is no
 * body to transform.
 */
export function repairToolCallStream(
  response: Response,
  /** "convert" when the step offered tools, "strip" when it did not. */
  mode: "convert" | "strip" = "convert",
): Response {
  if (!response.body) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let carry = ""; // Incomplete SSE line held between reads.
  let held = ""; // Text withheld because it may open a tool-call block.
  let captured = ""; // The tool-call block being collected.
  let capturing = false;
  let stopped = false; // The response is finished; everything after is noise.
  let template: Chunk | null = null; // Shape to model synthetic chunks on.

  const send = (controller: TransformStreamDefaultController<Uint8Array>, payload: unknown) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

  /** Emit whatever was captured as a tool_calls delta, if it parses. The
   *  matching finish chunk is sent separately, so exactly one closes the
   *  response however it ends. */
  const flushCall = (controller: TransformStreamDefaultController<Uint8Array>) => {
    const call = capturing ? parseCall(captured) : null;
    capturing = false;
    captured = "";
    if (!call) return false;
    send(controller, {
      ...template,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `call_${call.name}_${JSON.stringify(call.args).length}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    stopped = true;
    return true;
  };

  /** The single finish chunk closing a response this shim ended itself. */
  const sendFinish = (
    controller: TransformStreamDefaultController<Uint8Array>,
    reason: "tool_calls" | "stop",
  ) => send(controller, { ...template, choices: [{ index: 0, delta: {}, finish_reason: reason }] });

  const handleLine = (line: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!line.startsWith("data:")) {
      // Comments and blank separators are structural — pass them along.
      if (line.trim()) controller.enqueue(encoder.encode(`${line}\n\n`));
      return;
    }
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      return;
    }
    // The response has been closed out; whatever the model keeps generating
    // is the runaway this shim exists to absorb.
    if (stopped) return;

    let chunk: Chunk;
    try {
      chunk = JSON.parse(payload) as Chunk;
    } catch {
      controller.enqueue(encoder.encode(`${line}\n\n`));
      return;
    }

    const choice = chunk.choices?.[0];
    const content = choice?.delta?.content;
    // Remember the envelope (id, model, created…) for synthetic chunks.
    if (!template) template = { ...chunk, choices: undefined };

    // The turn ended: close out any captured call before the final chunk.
    if (choice?.finish_reason) {
      if (capturing) {
        if (flushCall(controller)) {
          // The server would have said "tool_calls" had it parsed the call.
          sendFinish(controller, "tool_calls");
          return;
        }
        // Unparseable after all — let the citizen see what the model said.
        held += captured;
        captured = "";
        capturing = false;
      }
      if (held) {
        send(controller, { ...chunk, choices: [{ ...choice, delta: { content: held }, finish_reason: null }] });
        held = "";
      }
      controller.enqueue(encoder.encode(`${line}\n\n`));
      return;
    }

    if (typeof content !== "string" || content === "") {
      controller.enqueue(encoder.encode(`${line}\n\n`));
      return;
    }

    if (capturing) {
      captured += content;
      const end = captured.indexOf(CLOSE);
      if (end !== -1) {
        const block = captured.slice(0, end);
        const rest = captured.slice(end + CLOSE.length);
        captured = block;
        if (flushCall(controller)) {
          // Anything after the block belongs to a call already made.
          held = "";
          sendFinish(controller, "tool_calls");
          return;
        }
        held += block + CLOSE + rest;
      }
      return;
    }

    held += content;
    const open = held.indexOf(OPEN);
    if (open !== -1) {
      const before = held.slice(0, open);
      const after = held.slice(open + OPEN.length);
      held = "";
      if (before) {
        send(controller, { ...chunk, choices: [{ ...choice, delta: { content: before } }] });
      }
      if (mode === "strip") {
        // Nothing to rescue the call into, and everything the model writes
        // from here on is its own invention. End the turn at the marker.
        stopped = true;
        sendFinish(controller, "stop");
        return;
      }
      capturing = true;
      captured = after;
      return;
    }

    // Hold back only the tail that could still become an opening marker.
    const dangling = danglingPrefix(held, OPEN);
    const emit = held.slice(0, held.length - dangling);
    held = held.slice(held.length - dangling);
    if (emit) {
      send(controller, { ...chunk, choices: [{ ...choice, delta: { content: emit } }] });
    }
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(bytes, controller) {
      carry += decoder.decode(bytes, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) handleLine(line, controller);
    },
    flush(controller) {
      if (carry.trim()) handleLine(carry, controller);
      if (capturing && flushCall(controller)) sendFinish(controller, "tool_calls");
    },
  });

  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
