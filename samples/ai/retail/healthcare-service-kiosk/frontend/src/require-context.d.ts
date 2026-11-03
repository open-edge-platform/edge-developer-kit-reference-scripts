// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Webpack/Turbopack require.context, used by the service registry for folder-based discovery. */
interface RequireContext {
  keys(): string[];
  <T = unknown>(id: string): T;
  resolve(id: string): string;
  id: string;
}

declare namespace NodeJS {
  interface Require {
    context(directory: string, useSubdirectories?: boolean, regExp?: RegExp): RequireContext;
  }
}
