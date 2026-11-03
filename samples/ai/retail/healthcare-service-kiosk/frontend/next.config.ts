// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { NextConfig } from "next";
import { withPayload } from "@payloadcms/next/withPayload";
import { applyKioskConfig, publicKioskEnv } from "./src/lib/kiosk-config";

// config.yaml is the kiosk's settings file. Copying it into process.env here —
// before Next reads anything — is what lets every server module keep reading
// plain process.env.KIOSK_*; `env` below inlines the browser-visible half into
// the client bundle the same way a NEXT_PUBLIC_ variable would be.
applyKioskConfig();

const nextConfig: NextConfig = {
  reactCompiler: true,
  // The packaged kiosk (see ../electron) ships the server as a self-contained
  // folder rather than a node_modules tree. Only that build sets the flag, so
  // `npm run dev` / `npm run build` are untouched.
  output: process.env.KIOSK_STANDALONE ? "standalone" : undefined,
  env: publicKioskEnv(),
  // The ID card reader's PC/SC bindings are a native addon loaded through a
  // prebuilt .node binary, and an optional dependency at that — bundling it
  // would resolve it at build time on a machine that may not have it. Left
  // external, it is `require`d at run time and its absence stays what the
  // reader is written to survive (see src/app/api/_lib/nfc.ts).
  // pdfkit packs a scan's pages into one PDF (see api/_lib/scanner.ts). It is
  // a server-only library that reads its own font data off disk, which a
  // bundled copy cannot find — left external, it loads at run time as it
  // expects to.
  serverExternalPackages: ["pcsc-mini", "pdfkit"],
  // sharp finds libvips through its prebuilt .node's RPATH rather than a
  // require(), so the output tracer — which only walks the JS graph — leaves
  // the shared library out of the standalone build and the packaged kiosk
  // dies on the first image. Naming it here puts it back.
  // (electron/scripts/build.mjs re-checks the staged copy, for builds that reuse
  // an output traced before this was set.)
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@img/sharp-libvips-linux-x64/lib/**"],
  },
};

export default withPayload(nextConfig);
