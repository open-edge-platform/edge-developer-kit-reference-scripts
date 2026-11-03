// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Builds public/maps/hospital.json (npm run map:build). Departments and wards in
// src/hospital/data.ts name their room's id, so keep them in sync.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maps", "hospital.json");
const STOREY = 4.5;

const LEVELS = [
  ["L1", "Emergency, Pharmacy & Rehab"],
  ["L2", "Main Lobby & Diagnostics"],
  ["L3", "Specialist Clinics & Children's Centre"],
  ["L4", "Heart Centre & Wards"],
  ["L5", "Bone & Joint Centre & Wards"],
  ["L6", "Women's Health & Wards"],
  ["L7", "Intensive Care & Private Suites"],
];

const CATEGORIES = {
  health: { label: "Department", color: "#86efac", icon: "🏥" },
  consult: { label: "Clinic", color: "#bfdbfe", icon: "🩺" },
  treatment: { label: "Treatment", color: "#bae6fd", icon: "💉" },
  imaging: { label: "Imaging", color: "#ddd6fe", icon: "🩻" },
  lab: { label: "Laboratory", color: "#fde68a", icon: "🧪" },
  ward: { label: "Ward", color: "#a5f3fc", icon: "🛏️" },
  therapy: { label: "Therapy", color: "#99f6e4", icon: "🏃" },
  surgery: { label: "Surgery", color: "#fbcfe8", icon: "⚕️" },
  admin: { label: "Office", color: "#e2e8f0", icon: "🗂️" },
  food: { label: "Food", color: "#fed7aa", icon: "☕" },
  info: { label: "Information", color: "#93c5fd", icon: "ℹ️" },
  hall: { label: "Hall", color: "#ddd6fe", icon: "🎤" },
  lounge: { label: "Waiting", color: "#fef08a", icon: "🛋️" },
  amenity: { label: "Amenity", color: "#e5e7eb", icon: "🕌" },
  restroom: { label: "Restroom", color: "#d1d5db", icon: "🚻" },
  core: { label: "Staff only", color: "#cbd5e1", icon: "📦" },
};

const has = {
  A: ["L1", "L2", "L3", "L4", "L5", "L6", "L7"],
  B: ["L1", "L2", "L3", "L4", "L5", "L6", "L7"],
  C: ["L1", "L2", "L3", "L4", "L5", "L6"],
  D: ["L1", "L2"],
};
const FOOTPRINT = {
  A: [60, 20, 132, 64],
  B: [148, 33, 192, 51],
  C: [0, 33, 44, 51],
  D: [72, 76, 116, 104],
  AB: [132, 40, 148, 44],
  AC: [44, 40, 60, 44],
  AD: [92.5, 64, 95.5, 76],
};

const rooms = [];
const pois = [];
const nodes = [];
const edges = [];
const plan = new Map(LEVELS.map(([id]) => [id, { segs: [], fixed: [] }]));
const ids = new Set();

const slug = (s) => s.toLowerCase().replace(/&/g, "").replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function uniqueId(base) {
  let id = base;
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
  ids.add(id);
  return id;
}

const corridor = (level, a, b) => plan.get(level).segs.push([a, b]);

function room(level, block, name, category, [x0, y0, x1, y1], door, icon) {
  const id = uniqueId(`${block}-${level}-${slug(name)}`.toLowerCase());
  rooms.push({ id, name, level, category, polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], node: { level, at: door }, ...(icon && { icon }) });
  return id;
}

function poi(level, block, name, category, [x, y], door) {
  const id = uniqueId(`${block}-${level}-${slug(name)}`.toLowerCase());
  pois.push({ id, name, level, x, y, category, node: { level, at: door } });
  return id;
}

/** Rooms side by side from x0, each [name, category, width, doorX?], opening onto the corridor at doorY. */
function row(level, block, x0, [y0, y1], doorY, list) {
  let x = x0;
  for (const [name, category, w, doorX] of list) {
    if (name) room(level, block, name, category, [x, y0, x + w, y1], [doorX ?? x + w / 2, doorY], name === "Stairs" ? "🪜" : undefined);
    x += w;
  }
}

const beds = (prefix, first, count, width) =>
  Array.from({ length: count }, (_, i) => [`Room ${prefix}${String(first + i).padStart(2, "0")}`, "ward", width]);

const stairs = ["Stairs", "core"];

function landing(level, [x, y], kind, name, door) {
  const id = uniqueId(`${level}-${kind}-${x}-${y}`.toLowerCase());
  nodes.push({ id, level, x, y, kind, name });
  plan.get(level).fixed.push({ id, door });
  return id;
}

const A_SOUTH = {
  L1: [["Health Screening Centre", "consult", 12], ["Dietetics Clinic", "consult", 12], ["Patient Affairs", "admin", 12], ["Medical Social Work", "admin", 12], ["Cafeteria", "food", 24]],
  L2: [["Registration & Admissions", "admin", 12], [null, null, 48], ["Billing & Insurance Counter", "health", 12]],
  L3: [["Eye Clinic", "consult", 12], ["ENT Clinic", "consult", 12], ["Diabetes Clinic", "consult", 12], ["Surgical Clinic", "consult", 12], ["Kidney Clinic", "consult", 12], ["Treatment Room", "treatment", 12]],
  L4: [["Cardiac Rehab", "therapy", 10], ["ECG & Echo Lab", "lab", 11], ["Cardiology", "health", 12], ["Stress Test Room", "therapy", 13], ["Cath Lab", "imaging", 14], ["Heart Failure Clinic", "consult", 12]],
  L5: [["Day Room", "lounge", 8], ...beds("5A-", 1, 16, 4)],
  L6: [["Day Room", "lounge", 8], ...beds("6A-", 1, 16, 4)],
  L7: beds("7A-", 1, 12, 6).map(([name, , w]) => [name.replace("Room", "Private Suite"), "ward", w]),
};

const A_NORTH = {
  L1: [["Dialysis Unit", "treatment", 14], ["Oncology Day Care", "treatment", 18.5], [null, null, 3], ["Pharmacy", "health", 14.5], ["Medication Counselling", "consult", 12], ["Pharmacy Store", "core", 10]],
  L2: [["Medical Records", "admin", 12], ["Sample Collection", "lab", 8], ["Laboratory", "health", 12.5, 87], [null, null, 3], ["Blood Bank", "lab", 10.5], ["Radiology", "health", 16], ["MRI & CT Suite", "imaging", 10]],
  L3: [["Health Education Centre", "hall", 14], ["Waiting Area", "lounge", 16], ["Consult Rooms", "consult", 14, 98], ["Dermatology", "health", 14], ["Procedure Room", "treatment", 14]],
  L4: [["Coronary Care Unit", "ward", 20], ...beds("4A-", 1, 10, 4), ["Day Room", "lounge", 12]],
  L5: [["Recovery Ward", "ward", 16], ...beds("5A-", 17, 14, 4)],
  L6: [["Isolation Ward", "ward", 16], ...beds("6A-", 17, 14, 4)],
  L7: [["Intensive Care Unit", "ward", 36], ["High Dependency Unit", "ward", 20], ["Family Room", "lounge", 16]],
};

const A_CORE = {
  L1: { nw: ["Staff Locker Room", "core"], se: [["Central Sterile Supply", "core", 18]], ne: [["Linen Room", "core", 9], ["Medical Store", "core", 13]], west: ["Security Office", "admin"], east: ["Store", "core"] },
  L2: { nw: ["Surau", "amenity"], se: [["Baby Room", "amenity", 5], ["Admissions Office", "admin", 13]], ne: [["Ultrasound", "imaging", 11], ["X-ray", "imaging", 11]], west: ["Wheelchair Station", "info"], east: ["Insurance Liaison", "admin"] },
  L3: { nw: ["Nurse Station", "treatment"], se: [["Clinic Office", "admin", 18]], ne: [["Phlebotomy", "lab", 11], ["Audiology", "consult", 11]], west: ["Store", "core"], east: ["Store", "core"] },
  L4: { nw: ["Ward 4A", "ward"], se: [["Treatment Room", "treatment", 18]], ne: [["Doctors' Room", "admin", 11], ["Utility Room", "core", 11]], west: ["Store", "core"], east: ["Store", "core"] },
  L5: { nw: ["Ward 5A", "ward"], se: [["Treatment Room", "treatment", 18]], ne: [["Doctors' Room", "admin", 11], ["Utility Room", "core", 11]], west: ["Store", "core"], east: ["Store", "core"] },
  L6: { nw: ["Ward 6A", "ward"], se: [["Treatment Room", "treatment", 18]], ne: [["Doctors' Room", "admin", 11], ["Utility Room", "core", 11]], west: ["Store", "core"], east: ["Store", "core"] },
  L7: { nw: ["Ward 7A", "ward"], se: [["ICU Store", "core", 18]], ne: [["Doctors' Room", "admin", 11], ["Equipment Store", "core", 11]], west: ["Store", "core"], east: ["Store", "core"] },
};

const ESCALATOR_LEVELS = ["L1", "L2", "L3"];

const LIFTS = [
  ["Lift A1", [82.5, 37], [87, 37]],
  ["Lift A2", [82.5, 47], [87, 47]],
  ["Lift A3", [91.5, 37], [87, 37]],
  ["Lift A4", [91.5, 47], [87, 47]],
];

function blockA(level) {
  const linkWest = has.C.includes(level);
  corridor(level, [61.5, 30.5], [130.5, 30.5]);
  corridor(level, [61.5, 53.5], [130.5, 53.5]);
  corridor(level, [67.5, 30.5], [67.5, 53.5]);
  corridor(level, [124.5, 30.5], [124.5, 53.5]);
  corridor(level, [87, 30.5], [87, 53.5]);

  row(level, "A", 60, [20, 29], 30.5, A_SOUTH[level]);
  row(level, "A", 60, [55, 64], 53.5, A_NORTH[level]);

  const core = A_CORE[level];
  row(level, "A", 69, [32, 42], 30.5, [["Restrooms", "restroom", 5], ["Accessible Restroom", "restroom", 3], [...stairs, 4]]);
  room(level, "A", ...core.nw, [69, 42, 81, 52], [75, 53.5]);
  row(level, "A", 101, [32, 42], 30.5, [[...stairs, 4], ...core.se]);
  row(level, "A", 101, [42, 52], 53.5, core.ne);
  if (!ESCALATOR_LEVELS.includes(level)) {
    room(level, "A", "Pantry", "core", [93, 32, 101, 42], [97, 30.5]);
    room(level, "A", "Clean Utility", "core", [93, 42, 101, 52], [97, 53.5]);
  }

  room(level, "A", "Stairs", "core", [60, 32, 66, 40], [67.5, 36], "🪜");
  room(level, "A", "Stairs", "core", [126, 32, 132, 40], [124.5, 36], "🪜");
  room(level, "A", ...core.west, [60, linkWest ? 44 : 40, 66, 52], [67.5, 48]);
  room(level, "A", ...core.east, [126, 44, 132, 52], [124.5, 48]);

  for (const [name, at, door] of LIFTS) landing(level, at, "elevator", name, door);
}

function lobby() {
  corridor("L2", [98, 21], [98, 30.5]);
  corridor("L2", [78, 26], [115, 26]);
  room("L2", "A", "Waiting Area", "lounge", [72, 20, 84, 24], [78, 26]);
  room("L2", "A", "Café", "food", [110, 20, 120, 24], [115, 26]);
  poi("L2", "A", "Main Entrance", "info", [98, 20.4], [98, 21]);
  poi("L2", "A", "Information Counter", "info", [98, 26], [98, 26]);
  poi("L2", "A", "ATM", "amenity", [112, 26.8], [112, 26]);
  poi("L1", "A", "ATM", "amenity", [106, 31.6], [106, 30.5]);
}

/**
 * Two pairs of escalators side by side in the core: Levels 1–2 rise south
 * and Levels 2–3 rise north, so both start on Level 2 by the lobby corridor.
 */
function escalators() {
  const at = (level, x, y, line) =>
    landing(level, [x, y], "escalator", `Escalator A-${line}`, [x, y === 34 ? 30.5 : 53.5]);
  const down12 = [at("L2", 94, 34, "D-I"), at("L1", 94, 48.5, "D-O")];
  const up12 = [at("L1", 96, 48.5, "U-I"), at("L2", 96, 34, "U-O")];
  const up23 = [at("L2", 98, 34, "U-I"), at("L3", 98, 48.5, "U-O")];
  const down23 = [at("L3", 100, 48.5, "D-I"), at("L2", 100, 34, "D-O")];
  for (const [from, to] of [down12, up12, up23, down23, [up12[0], up23[1]], [down23[0], down12[1]]]) {
    edges.push({ from, to, via: "escalator", oneWay: true });
  }
}

const B = {
  L1: [[["Physiotherapy", "therapy", 20], ["Hydrotherapy Pool", "therapy", 18]], [["Occupational Therapy", "therapy", 14], ["Speech Therapy", "therapy", 10], ["Restrooms", "restroom", 6], ["Rehab Gym", "therapy", 14]]],
  L2: [[["Neurology Clinic", "consult", 12], ["Urology Clinic", "consult", 12], ["Gastro Clinic", "consult", 14]], [["Respiratory Clinic", "consult", 14], ["Lung Function Lab", "lab", 10], ["Restrooms", "restroom", 6], ["Consult Rooms", "consult", 14]]],
  L3: [[["Oncology Clinic", "consult", 14], ["Haematology Clinic", "consult", 12], ["Rheumatology Clinic", "consult", 12]], [["Chemotherapy Suite", "treatment", 18], ["Consult Rooms", "consult", 14], ["Restrooms", "restroom", 6], ["Store", "core", 6]]],
  L4: [beds("4B-", 1, 8, 4.75), [["Ward 4B", "ward", 8], ["Treatment Room", "treatment", 8], ["Restrooms", "restroom", 6], ...beds("4B-", 9, 5, 4.4)]],
  L5: [[["Orthopaedics", "health", 18], ["Plaster Room", "treatment", 10], ["Sports Injury Clinic", "consult", 10]], [["Fracture Clinic", "consult", 12], ["Orthopaedic X-ray", "imaging", 10], ["Restrooms", "restroom", 6], ["Physiotherapy Gym", "therapy", 16]]],
  L6: [beds("6B-", 1, 8, 4.75), [["Ward 6B", "ward", 8], ["Treatment Room", "treatment", 8], ["Restrooms", "restroom", 6], ...beds("6B-", 9, 5, 4.4)]],
  L7: [beds("7B-", 1, 6, 38 / 6).map(([n, , w]) => [n.replace("Room", "Private Suite"), "ward", w]), [["Ward 7B", "ward", 8], ["Family Lounge", "lounge", 10], ["Restrooms", "restroom", 6], ["Health Screening Suite", "consult", 20]]],
};

const C = {
  L1: [[["Endoscopy Unit", "treatment", 18], ["Day Surgery Centre", "surgery", 20]], [["Recovery Bay", "surgery", 14], ["Pre-op Assessment", "consult", 14], ["Restrooms", "restroom", 6], ["Store", "core", 10]]],
  L2: [[["Mammography", "imaging", 12], ["Women's Imaging", "imaging", 14], ["Bone Density Scan", "imaging", 12]], [["Antenatal Classes", "hall", 16], ["Family Waiting", "lounge", 12], ["Restrooms", "restroom", 6], ["Store", "core", 10]]],
  L3: [[["Paediatrics", "health", 18], ["Vaccination Room", "treatment", 10], ["Child Development", "therapy", 10]], [["Paediatric Day Ward", "ward", 14], ["Play Area", "lounge", 10], ["Baby Room", "amenity", 6], ["Restrooms", "restroom", 6], ["Store", "core", 8]]],
  L4: [[["Neonatal ICU", "ward", 14], ["Paediatric ICU", "ward", 12], ["Special Care Nursery", "ward", 12]], [["Ward 4C", "ward", 20], ["Nurse Station", "treatment", 8], ["Restrooms", "restroom", 6], ["Family Room", "lounge", 10]]],
  L5: [[["Labour Suite", "surgery", 20], ["Delivery Rooms", "surgery", 18]], [["Ward 5C", "ward", 20], ["Nurse Station", "treatment", 8], ["Restrooms", "restroom", 6], ["Lactation Room", "lounge", 10]]],
  L6: [[["Obstetrics & Gynaecology", "health", 18], ["Antenatal Clinic", "consult", 10], ["Fetal Monitoring", "treatment", 10]], [["Gynae Procedure Room", "treatment", 14], ["Baby Room", "amenity", 6], ["Restrooms", "restroom", 6], ["Surau", "amenity", 10], ["Store", "core", 8]]],
};

function wingB(level) {
  corridor(level, [124.5, 42], [190, 42]);
  const [south, north] = B[level];
  row(level, "B", 148, [33, 40.5], 42, [...south, [...stairs, 6, 189]]);
  row(level, "B", 148, [43.5, 51], 42, north);
}

function wingC(level) {
  corridor(level, [2, 42], [67.5, 42]);
  const [south, north] = C[level];
  row(level, "C", 0, [33, 40.5], 42, [[...stairs, 6, 3], ...south]);
  row(level, "C", 0, [43.5, 51], 42, north);
}

function blockD(level) {
  corridor(level, [94, 53.5], [94, 90]);
  corridor(level, [73.5, 90], [114.5, 90]);
  poi(level, "D", "Car Park Link", "info", [115.7, 90], [114.5, 90]);
  if (level === "L1") {
    room(level, "D", "Emergency Department", "health", [72, 76, 92.5, 88.5], [94, 82.25]);
    row(level, "D", 95.5, [76, 88.5], 90, [["Triage", "treatment", 8.5], ["Resuscitation Room", "treatment", 8], [...stairs, 4]]);
    row(level, "D", 72, [91.5, 104], 90, [["Treatment Bays", "treatment", 18], ["Observation Ward", "ward", 14], ["Ambulance Bay", "core", 12]]);
    poi(level, "D", "Emergency Entrance", "info", [72.3, 90], [73.5, 90]);
  } else {
    room(level, "D", "Operating Theatres", "surgery", [72, 76, 92.5, 88.5], [94, 82.25]);
    row(level, "D", 95.5, [76, 88.5], 90, [["Recovery Bay", "surgery", 16.5], [...stairs, 4]]);
    row(level, "D", 72, [91.5, 104], 90, [["Surgical ICU", "ward", 24], ["Sterile Store", "core", 10], ["Staff Lounge", "lounge", 10]]);
  }
}

/** The outline of a union of axis-aligned rectangles, counter-clockwise. */
function outlineOf(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b);
  const filled = (i, j) =>
    i >= 0 && j >= 0 && i < xs.length - 1 && j < ys.length - 1 &&
    rects.some((r) => r[0] <= xs[i] && xs[i + 1] <= r[2] && r[1] <= ys[j] && ys[j + 1] <= r[3]);
  const next = new Map();
  const key = (p) => p.join(",");
  const edge = (a, b) => next.set(key(a), b);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!filled(i, j)) continue;
      const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
      if (!filled(i, j - 1)) edge([x0, y0], [x1, y0]);
      if (!filled(i + 1, j)) edge([x1, y0], [x1, y1]);
      if (!filled(i, j + 1)) edge([x1, y1], [x0, y1]);
      if (!filled(i - 1, j)) edge([x0, y1], [x0, y0]);
    }
  }
  const start = [...next.keys()][0].split(",").map(Number);
  const ring = [start];
  for (let p = next.get(key(start)); key(p) !== key(start); p = next.get(key(p))) ring.push(p);
  if (ring.length !== next.size) throw new Error("floor outline is not one piece");
  return ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length];
    const b = ring[(i + 1) % ring.length];
    return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
  });
}

const SNAP = 0.6;
const onSeg = ([a, b], [x, y]) =>
  a[0] === b[0]
    ? Math.abs(x - a[0]) < 1e-6 && y >= Math.min(a[1], b[1]) - 1e-6 && y <= Math.max(a[1], b[1]) + 1e-6
    : Math.abs(y - a[1]) < 1e-6 && x >= Math.min(a[0], b[0]) - 1e-6 && x <= Math.max(a[0], b[0]) + 1e-6;

function graph(level) {
  const { segs, fixed } = plan.get(level);
  const here = [];
  const nodeAt = (p) => {
    const near = here.find((n) => Math.hypot(n.x - p[0], n.y - p[1]) < SNAP);
    if (near) return near;
    const n = { id: `${level.toLowerCase()}-${here.length + 1}`, level, x: p[0], y: p[1] };
    here.push(n);
    return n;
  };
  for (const s of segs) {
    nodeAt(s[0]);
    nodeAt(s[1]);
    for (const t of segs) {
      if ((s[0][0] === s[1][0]) === (t[0][0] === t[1][0])) continue;
      const cross = s[0][0] === s[1][0] ? [s[0][0], t[0][1]] : [t[0][0], s[0][1]];
      if (onSeg(s, cross) && onSeg(t, cross)) nodeAt(cross);
    }
  }
  const resolve = (at, what) => {
    if (!segs.some((s) => onSeg(s, at))) throw new Error(`${what} on ${level}: door ${at} is not on a corridor`);
    return nodeAt(at).id;
  };
  for (const r of [...rooms, ...pois]) if (r.level === level) r.node = resolve(r.node.at, r.id);
  for (const f of fixed) edges.push({ from: f.id, to: resolve(f.door, f.id) });

  for (const s of segs) {
    const along = s[0][0] === s[1][0] ? (n) => n.y : (n) => n.x;
    const on = here.filter((n) => onSeg(s, [n.x, n.y])).sort((a, b) => along(a) - along(b));
    for (let i = 1; i < on.length; i++) edges.push({ from: on[i - 1].id, to: on[i].id });
  }
  nodes.push(...here);
}

for (const [level] of LEVELS) {
  blockA(level);
  if (has.B.includes(level)) wingB(level);
  if (has.C.includes(level)) wingC(level);
  if (has.D.includes(level)) blockD(level);
}
lobby();
escalators();
for (const [name] of LIFTS) {
  const stops = nodes.filter((n) => n.name === name);
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) edges.push({ from: stops[i].id, to: stops[j].id, via: "elevator" });
  }
}
for (const [level] of LEVELS) graph(level);

const seen = new Set();
const unique = edges.filter((e) => {
  const k = e.oneWay ? `${e.from}>${e.to}` : [e.from, e.to].sort().join("|");
  return !seen.has(k) && seen.add(k);
});

const map = {
  $schema: "./map.schema.json",
  version: 1,
  name: "Hospital",
  units: "meters",
  attribution: "Fictional hospital floor plan, generated by scripts/build-hospital-map.mjs.",
  defaultStart: "a-l2-information-counter",
  categories: CATEGORIES,
  levels: LEVELS.map(([id, subtitle], ordinal) => ({
    id,
    name: `Level ${ordinal + 1}`,
    shortName: String(ordinal + 1),
    subtitle,
    ordinal,
    elevation: ordinal * STOREY,
    height: STOREY,
    outline: outlineOf(Object.keys(has).filter((b) => has[b].includes(id)).flatMap((b) => [
      FOOTPRINT[b],
      ...(b === "B" ? [FOOTPRINT.AB] : b === "C" ? [FOOTPRINT.AC] : b === "D" ? [FOOTPRINT.AD] : []),
    ])),
  })),
  rooms,
  pois,
  nodes,
  edges: unique,
};

writeFileSync(OUT, `${JSON.stringify(map, null, 1)}\n`);
console.log(`${OUT}: ${LEVELS.length} levels, ${rooms.length} rooms, ${pois.length} points, ${nodes.length} nodes, ${unique.length} edges`);
