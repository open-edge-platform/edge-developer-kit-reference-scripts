// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  Calculator,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  CreditCard,
  FileCheck,
  FileScan,
  FileUp,
  FlaskConical,
  Hospital,
  MapIcon,
  MessageCircleHeart,
  MessageCircleQuestion,
  Navigation,
  Pill,
  PillBottle,
  ShieldCheck,
  Star,
  Stethoscope,
  Tag,
  Ticket,
  UserCheck,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { CategoryIconId, ServiceDefinition, ServiceIconId } from "@/services/types";

export const CATEGORY_ICONS: Record<CategoryIconId, LucideIcon> = {
  "user-plus": UserPlus,
  calendar: CalendarDays,
  pill: Pill,
  wallet: Wallet,
  map: MapIcon,
  "file-scan": FileScan,
  message: MessageCircleHeart,
};

const SERVICE_ICONS: Record<ServiceIconId, LucideIcon> = {
  "calendar-check": CalendarCheck,
  "calendar-plus": CalendarPlus,
  ticket: Ticket,
  flask: FlaskConical,
  tag: Tag,
  pill: Pill,
  "pill-bottle": PillBottle,
  "file-up": FileUp,
  "file-check": FileCheck,
  calculator: Calculator,
  "credit-card": CreditCard,
  stethoscope: Stethoscope,
  hospital: Hospital,
  navigation: Navigation,
  "shield-check": ShieldCheck,
  "user-plus": UserPlus,
  "user-check": UserCheck,
  star: Star,
  question: MessageCircleQuestion,
};

export function serviceIcon(service: ServiceDefinition, fallback: CategoryIconId): LucideIcon {
  return service.icon ? SERVICE_ICONS[service.icon] : CATEGORY_ICONS[fallback];
}
