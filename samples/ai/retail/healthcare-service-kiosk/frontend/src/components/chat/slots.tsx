// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { SlotFile } from "@/modules/slots";
import { ChatKiosk } from "./chat-kiosk";

const chat: SlotFile = {
  module: "chat",
  slots: { modes: [{ id: "chat", Kiosk: ChatKiosk }] },
};

export default chat;
