// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ModuleSpec } from "./types";

/**
 * The kiosk's parts. Each service is a module by being a folder under
 * src/packs/<pack>/services; it appears here only to claim files outside that
 * folder or to need another module. Everything not claimed here is the core,
 * the staff pages (/staff, /enroll, /settings) included.
 * Read by the app (src/modules/state.ts) and by `npm run modules`.
 */
export const MODULES: ModuleSpec[] = [
  {
    id: "chat",
    kind: "feature",
    title: "Assistant (chat & voice)",
    summary: "The chat and voice kiosk: a tool-calling model drives the services through the MCP server.",
    requires: ["mcp"],
    paths: [
      "src/components/chat",
      "src/app/(kiosk)/chat",
      "src/app/api/chat",
      "src/app/api/_lib/llm-provider.ts",
      "src/app/api/_lib/tool-call-shim.ts",
      "src/app/api/_lib/mcp-bridge.ts",
      "src/app/api/_lib/service-briefing.ts",
      "src/app/api/speech/transcribe",
      "src/app/api/avatar",
      "src/app/api/documents/scan/next",
      "src/app/api/documents/mock/next",
      "src/hooks/use-voice-input.ts",
      "src/lib/audio",
      "tests/verify/chat-layout.spec.ts",
    ],
    packages: ["ai", "@ai-sdk/react", "@ai-sdk/openai-compatible"],
  },
  {
    id: "mcp",
    kind: "feature",
    title: "MCP server",
    summary: "Runs the services as tool calls at /api/mcp, for the assistant and for outside agents.",
    paths: [
      "src/app/api/mcp",
      "src/app/api/_lib/flows/engine.ts",
      "src/app/api/_lib/flows/bridge.ts",
      "src/app/api/_lib/flows/verified-sessions.ts",
      "src/app/api/_lib/route-call.ts",
      "tests/api/flow-session.spec.ts",
    ],
    packages: ["mcp-handler", "@modelcontextprotocol/server", "@modelcontextprotocol/sdk"],
  },
  {
    id: "wayfinding",
    kind: "shared",
    title: "Wayfinding",
    summary: "The hospital map, the routing engine, the 2D/3D route views and the home screen's Find your way.",
    paths: [
      "src/lib/wayfinding",
      "src/components/wayfinding",
      "src/hospital/wayfinding.ts",
      "src/hospital/wayfinding.server.ts",
      "src/hospital/place-badges.ts",
      "public/maps",
      "scripts/build-hospital-map.mjs",
      "tests/verify/wayfinding.spec.ts",
    ],
    packages: ["three", "@react-three/fiber", "@react-three/drei", "@types/three"],
    scripts: ["map:build"],
  },
  {
    id: "queue",
    kind: "shared",
    title: "Clinic queue",
    summary: "Queue numbers per clinic and for the registration counter, live ticket status and the /queue waiting-area board.",
    paths: [
      "src/app/api/_lib/queue.ts",
      "src/app/api/queue",
      "src/components/queue",
      "src/app/(kiosk)/queue",
    ],
  },
  {
    id: "booking",
    kind: "shared",
    title: "Appointment booking",
    summary: "Slot picking, the slot re-check at filing, and the signed appointment slip.",
    paths: [
      "src/app/api/_lib/booking.ts",
      "src/components/kiosk/slot-picker.tsx",
      "src/components/kiosk/appointment-slip.tsx",
      "src/components/kiosk/appointment-receipt.tsx",
      "src/components/kiosk/appointment-takeaway.tsx",
    ],
  },
  {
    id: "knowledge",
    kind: "shared",
    title: "Hospital Q&A",
    summary: "Retrieval over the hospital guide, grounded model answers and the red-flag checks.",
    paths: [
      "src/app/api/_lib/grounded.ts",
      "src/app/api/answers",
      "src/hospital/answers.ts",
      "src/hospital/knowledge.ts",
      "src/hospital/retrieval.ts",
      "src/hospital/safety.ts",
      "src/lib/api/answers.ts",
      "src/components/kiosk/answer-result.tsx",
      "src/components/kiosk/ask-field.tsx",
    ],
  },
  { id: "checkin", kind: "service", requires: ["queue"] },
  { id: "verify", kind: "service", requires: ["queue"] },
  { id: "book", kind: "service", requires: ["booking"] },
  { id: "followup", kind: "service", requires: ["booking"] },
  { id: "directions", kind: "service", requires: ["wayfinding"] },
  // Its touch step hands the patient on to Indoor Navigation's route screen.
  { id: "myappointment", kind: "service", requires: ["directions"] },
  { id: "hospitalinfo", kind: "service", requires: ["knowledge"] },
  { id: "healthqa", kind: "service", requires: ["knowledge"] },
  {
    id: "labresults",
    kind: "service",
    paths: [
      "src/app/api/labs",
      "src/app/api/_lib/lab-explain.ts",
      "src/hospital/labs.ts",
      "src/lib/api/labs.ts",
    ],
  },
  { id: "labprice", kind: "service", paths: ["src/app/api/lab-tests"] },
  { id: "doctors", kind: "service", paths: ["tests/verify/find-a-doctor.spec.ts"] },
  { id: "referral", kind: "service", paths: ["tests/api/mixed-capture.spec.ts"] },
];
