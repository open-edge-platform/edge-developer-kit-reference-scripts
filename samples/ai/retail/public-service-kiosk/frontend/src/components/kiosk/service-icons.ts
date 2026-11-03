// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { BookText, CarFront, House, IdCard, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import type { CategoryIconId } from "@/services/types";

/** A category's glyph, on the touch menu's tiles and beside its services in the chat. */
export const CATEGORY_ICONS: Record<CategoryIconId, LucideIcon> = {
  car: CarFront,
  book: BookText,
  "id-card": IdCard,
  house: House,
  users: Users,
  shield: ShieldCheck,
};
