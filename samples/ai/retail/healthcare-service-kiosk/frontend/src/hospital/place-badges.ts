// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  Accessibility,
  Activity,
  Ambulance,
  Armchair,
  Baby,
  Banknote,
  BedDouble,
  Bone,
  Car,
  ClipboardList,
  Coffee,
  DoorOpen,
  FlaskConical,
  Hand,
  HeartPulse,
  Info,
  MapPin,
  MonitorDot,
  MoonStar,
  Pill,
  Presentation,
  Receipt,
  ScanLine,
  Scissors,
  Stethoscope,
  Syringe,
  Toilet,
  Utensils,
  Venus,
} from "lucide-react";
import type { BadgeIcon } from "@/components/wayfinding/badge";
import type { Place } from "@/lib/wayfinding/types";
import { DEPARTMENTS, WARDS } from "./data";

const FAMILY = {
  clinic: "#087f78",
  diagnostics: "#6a4bc4",
  emergency: "#c62828",
  services: "#1f5fa6",
  amenity: "#4b5563",
  food: "#b45309",
  ward: "#a3367f",
} as const;
type Family = keyof typeof FAMILY;

const NAMED: ReadonlySet<Family> = new Set(["clinic", "diagnostics", "emergency", "services", "ward"]);

const DEPARTMENT: Record<string, [BadgeIcon, Family]> = {
  cardiology: [HeartPulse, "clinic"],
  orthopaedics: [Bone, "clinic"],
  paediatrics: [Baby, "clinic"],
  obgyn: [Venus, "clinic"],
  dermatology: [Hand, "clinic"],
  radiology: [ScanLine, "diagnostics"],
  laboratory: [FlaskConical, "diagnostics"],
  pharmacy: [Pill, "services"],
  emergency: [Ambulance, "emergency"],
  billing: [Receipt, "services"],
};

const KIND: Record<string, [BadgeIcon, Family]> = {
  consult: [Stethoscope, "clinic"],
  treatment: [Syringe, "clinic"],
  imaging: [ScanLine, "diagnostics"],
  lab: [FlaskConical, "diagnostics"],
  ward: [BedDouble, "ward"],
  therapy: [Activity, "clinic"],
  surgery: [Scissors, "clinic"],
  admin: [ClipboardList, "services"],
  food: [Coffee, "food"],
  info: [Info, "services"],
  hall: [Presentation, "services"],
  lounge: [Armchair, "amenity"],
};

function iconOf(place: Place): [BadgeIcon, Family] {
  const dept = DEPARTMENTS.find((d) => d.name === place.name && place.category === "health");
  if (dept && DEPARTMENT[dept.id]) return DEPARTMENT[dept.id];
  if (WARDS.some((w) => w.group === "intensive" && w.place === place.id)) return [MonitorDot, "ward"];
  const name = place.name;
  if (name === "Accessible Restroom") return [Accessibility, "amenity"];
  if (place.category === "restroom" || name.endsWith("Restroom")) return [Toilet, "amenity"];
  if (name === "Surau") return [MoonStar, "amenity"];
  if (name === "Baby Room") return [Baby, "amenity"];
  if (name.startsWith("ATM")) return [Banknote, "amenity"];
  if (name === "Cafeteria") return [Utensils, "food"];
  if (place.category === "info") {
    if (name.startsWith("Car Park")) return [Car, "services"];
    if (name.endsWith("Entrance")) return [DoorOpen, "services"];
    if (name.includes("Wheelchair")) return [Accessibility, "services"];
  }
  return KIND[place.category] ?? [MapPin, "amenity"];
}

/** The badge a place wears on the 3D map; amenities and points show the icon alone, staff-only rooms none. */
export function placeBadge(place: Place): { icon: BadgeIcon; color: string; named: boolean } | null {
  if (place.category === "core") return null;
  const [icon, family] = iconOf(place);
  return { icon, color: FAMILY[family], named: place.kind === "room" && NAMED.has(family) };
}
