// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { createMcpHandler } from "mcp-handler";
import { registerKioskTools } from "./tools";

/**
 * MCP endpoint (Streamable HTTP, stateless) exposing every kiosk service as a
 * tool. Point any MCP client at http://<host>:3000/api/mcp — the kiosk
 * chatbot, `claude mcp add --transport http kiosk <url>`, or an agent SDK.
 */
const handler = createMcpHandler(registerKioskTools, {
  serverInfo: { name: "kiosk-services", version: "1.0.0" },
  instructions:
    "Government service kiosk (JPJ, JPN, PDRM, NRD, JKM services). To serve a citizen, " +
    "PREFER the guided flows: get_service_catalog to find the service id, then " +
    "start_service_flow — it verifies identity and runs the whole application " +
    "server-side, returning ready-to-relay questions whenever a human answer is needed; " +
    "relay them, then continue_service_flow with the answers until the flow completes. " +
    "Ask the citizen for missing input instead of guessing it. The granular tools " +
    "(lookup_fines, list_vehicles, list_licenses, get_fee_quote, verify_document, " +
    "pay_service_fee, submit_application, list_requests…) are for ad-hoc queries and " +
    "custom orchestration only.",
});

export { handler as GET, handler as POST };
