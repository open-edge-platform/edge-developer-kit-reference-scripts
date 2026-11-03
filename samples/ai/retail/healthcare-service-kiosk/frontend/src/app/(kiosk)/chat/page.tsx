// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { redirect } from "next/navigation";

/**
 * The assistant no longer has an address of its own: which kiosk a terminal
 * runs is a setup-time setting, and a link straight into chat would be a way
 * around it. Anything still pointing here lands on the terminal's own mode.
 */
export default function ChatPage() {
  redirect("/");
}
