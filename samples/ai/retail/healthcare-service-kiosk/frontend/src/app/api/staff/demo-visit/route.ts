// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cmsFindOne } from "../../_lib/cms";
import type { CitizenDoc } from "../../_lib/citizens";
import { demoVisitOf, prepareDemoVisit } from "../../_lib/demo-visit";
import { badRequest, conflict, notFound, param, readJson } from "../../_lib/http";
import { notStaff, staffUser } from "../../_lib/staff";

// Staff-only, on the CMS admin session — see ../../_lib/staff.

async function citizenOf(raw: unknown): Promise<CitizenDoc | Response> {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return badRequest("citizen must be a registry row id");
  return (await cmsFindOne<CitizenDoc>("citizens", { id: { equals: id } })) ?? notFound("nobody on the register has that id");
}

/** GET ?citizen= — where the patient's visit stands today: appointments, check-ins, the bill still due. */
export async function GET(req: Request) {
  if (!(await staffUser(req))) return notStaff();
  const citizen = await citizenOf(param(req, "citizen"));
  if (citizen instanceof Response) return citizen;
  return Response.json(await demoVisitOf(citizen), { headers: { "cache-control": "no-store" } });
}

/** POST {citizen} — clear the last run (today's check-in, bill payments) and book today's visit if there is none. */
export async function POST(req: Request) {
  const staff = await staffUser(req);
  if (!staff) return notStaff();
  const citizen = await citizenOf((await readJson<{ citizen: number }>(req)).citizen);
  if (citizen instanceof Response) return citizen;
  try {
    const done = await prepareDemoVisit(citizen, staff.email);
    return Response.json({ done, visit: await demoVisitOf(citizen) });
  } catch (error) {
    return conflict(error instanceof Error ? error.message : "the visit could not be set up");
  }
}
