// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { activePack, type MessageKey } from "@/packs";

// One active locale per terminal, chosen at build time by the country pack.
// Which strings are catalog keys and which stay literal is a deliberate cut — see docs/i18n.md.

/** `{{name}}` placeholders, same syntax as the system prompts. */
const substitute = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{\{(\w[\w-]*)\}\}/g, (whole, key: string) =>
    key in vars ? String(vars[key]) : whole,
  );

/** Unknown keys return the key itself — visible, greppable, never a crash on a kiosk. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const text = activePack().messages[key];
  if (text === undefined) {
    console.warn(`[i18n] missing message "${key}" in pack "${activePack().id}"`);
    return key;
  }
  return vars ? substitute(text, vars) : text;
}
