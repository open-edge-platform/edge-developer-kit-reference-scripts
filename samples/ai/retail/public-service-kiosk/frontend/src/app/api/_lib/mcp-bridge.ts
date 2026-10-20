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
  /** Called with the raw text content of every successful tool result. */
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

  const tools: ToolSet = {};
  for (const advertisedTool of wanted) {
    tools[advertisedTool.name] = dynamicTool({
      description: advertisedTool.description ?? advertisedTool.title ?? advertisedTool.name,
      inputSchema: jsonSchema(advertisedTool.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: async (input) => {
        const args = (input ?? {}) as Record<string, unknown>;
        const result = await client.callTool({
          name: advertisedTool.name,
          arguments: options.amendInput
            ? options.amendInput(advertisedTool.name, args)
            : args,
        });
        const text = resultText(result.content);
        // An MCP error is a normal result the model is expected to read and
        // recover from, not an exception — surface it as the tool's answer.
        if (result.isError) return { error: text || "the tool reported an error" };
        options.onResult?.(advertisedTool.name, text);
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      },
    });
  }

  return {
    tools,
    toolNames: wanted.map((tool) => tool.name),
    close: () => client.close(),
  };
}
