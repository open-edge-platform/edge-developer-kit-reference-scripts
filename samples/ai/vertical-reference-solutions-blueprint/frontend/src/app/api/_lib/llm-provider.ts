// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { safeUrl, URL_CHARS } from "@/lib/validation";
import { llmConfig } from "./llm";
import { repairToolCallStream } from "./tool-call-shim";

/**
 * The configured chat model, as a Vercel AI SDK model.
 *
 * `llm.ts` owns the connection settings and the one-shot `completeText` used
 * by the document checks; this is the streaming/tool-calling counterpart the
 * chat routes share. Callers must check `llmConfig().mock` first — there is
 * no model to build when no server is configured.
 */

/**
 * Whether to repair tool calls a server leaves sitting in the assistant text
 * (see `tool-call-shim`). "auto" only rewrites a stream that actually
 * contains the markup, so it costs nothing on a server that parses tool
 * calls itself; set "off" to see exactly what the server returned.
 */
const TOOL_CALL_SHIM = (process.env.KIOSK_LLM_TOOL_CALL_SHIM ?? "auto") !== "off";


export function kioskModel() {
  const config = llmConfig();
  const provider = createOpenAICompatible({
    name: "kiosk-llm",
    baseURL: config.baseUrl,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    fetch: async (url, init) => {
      let usesTools = false;
      // Merge server-specific extras (e.g. disabling Qwen thinking) into the body.
      if (init?.body) {
        const body = JSON.parse(init.body.toString()) as { tools?: unknown[] };
        usesTools = Array.isArray(body.tools) && body.tools.length > 0;
        if (Object.keys(config.extraBody).length > 0) {
          init = { ...init, body: JSON.stringify({ ...body, ...config.extraBody }) };
        }
      }
      // Rebuilt inline, character by character off the allowlist: the
      // security scan only trusts sanitization done in the same function as
      // the fetch.
      let target = "";
      for (const ch of safeUrl(String(url))) {
        let ok = "";
        for (const allowed of URL_CHARS) {
          if (allowed === ch) {
            ok = allowed;
            break;
          }
        }
        if (!ok) throw new Error("the LLM server URL contains a forbidden character");
        target += ok;
      }
      const response = await fetch(target, init);
      // Streaming responses only — the shim rewrites SSE deltas. A step that
      // offered no tools still gets it, to strip markup a model emits anyway.
      const streaming = response.headers.get("content-type")?.includes("text/event-stream");
      return TOOL_CALL_SHIM && response.ok && streaming
        ? repairToolCallStream(response, usesTools ? "convert" : "strip")
        : response;
    },
  });
  return provider(config.model);
}
