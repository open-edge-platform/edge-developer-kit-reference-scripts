// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { dynamicTool, jsonSchema, type ToolSet } from "ai";

/**
 * A real MCP client onto the kiosk's own MCP server.
 *
 * The agentic chat mode does not import the flow engine; it connects to
 * `/api/mcp` over Streamable HTTP exactly as an external host (Claude, an
 * agent SDK) would, lists the tools the server advertises, and hands them to
 * the model. That keeps the agent honest — it can only do what the MCP
 * surface actually exposes — and makes the MCP server itself something the
 * kiosk exercises on every turn rather than a side door nothing opens.
 *
 * The AI SDK dropped its own MCP client in v7, so the tool adapter lives
 * here: MCP advertises JSON Schema, which `dynamicTool` takes as-is.
 */

/** Tool names the agent is allowed to see, or all of them when omitted. */
export type McpSessionOptions = {
  /** Absolute URL of the MCP endpoint. */
  url: string;
  allow?: string[];
  /** Called with the raw text content of every tool result, errors included —
   *  a failed flow comes back as an MCP error and the screen still has to see it end. */
  onResult?: (toolName: string, text: string) => void;
  /**
   * Last chance to amend a tool's arguments before the call. The uploads a
   * citizen supplies are megabytes of base64 that must never enter the
   * model's context, so the route splices them in here instead.
   */
  amendInput?: (toolName: string, input: Record<string, unknown>) => Record<string, unknown>;
};

export type McpSession = {
  tools: ToolSet;
  /** Names actually registered, in the order the server advertised them. */
  toolNames: string[];
  /** A call the kiosk makes itself rather than the model — through the same
   *  `amendInput` and `onResult` the model's calls go through, answered the same way. */
  call: (toolName: string, input: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
};

/** The text parts of an MCP tool result, joined — the kiosk's tools all
 *  answer with a single JSON text block. */
function resultText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

export async function connectKioskMcp(options: McpSessionOptions): Promise<McpSession> {
  const client = new Client(
    { name: "kiosk-chat-agent", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(options.url)));

  const { tools: advertised } = await client.listTools();
  const wanted = options.allow
    ? advertised.filter((tool) => options.allow!.includes(tool.name))
    : advertised;

  const toolNames = wanted.map((tool) => tool.name);
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (!toolNames.includes(name)) throw new Error(`tool ${name} is not open to this session`);
    const result = await client.callTool({
      name,
      arguments: options.amendInput ? options.amendInput(name, args) : args,
    });
    const text = resultText(result.content);
    options.onResult?.(name, text);
    // An MCP error is a normal result the model is expected to read and
    // recover from, not an exception — surface it as the tool's answer.
    if (result.isError) return { error: text || "the tool reported an error" };
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  };

  const tools: ToolSet = {};
  for (const advertisedTool of wanted) {
    tools[advertisedTool.name] = dynamicTool({
      description: advertisedTool.description ?? advertisedTool.title ?? advertisedTool.name,
      inputSchema: jsonSchema(advertisedTool.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: (input) => call(advertisedTool.name, (input ?? {}) as Record<string, unknown>),
    });
  }

  return {
    tools,
    toolNames,
    call,
    close: () => client.close(),
  };
}
