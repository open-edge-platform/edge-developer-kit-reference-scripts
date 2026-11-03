// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { SPECIALIST_DEPARTMENTS, department, departmentLocation, type Doctor } from "@/hospital/data";
import { addDays, isoDate } from "@/hospital/records";
import { formatDayParts, formatShortDate } from "@/lib/format";
import { findCitizenByDocument } from "./citizens";
import { ask, done } from "./flows/plan";
import type { ApplicationPlan, ChainSpec } from "./flows/types";
import { maskedEmail, maskedPhone, notify } from "./notify";
import { BOOKING_SERVICES, takenSlots } from "./patients";
import { cmsFind } from "./cms";
import { signedSlipCode } from "./slips";

/**
 * Filing for a booked visit: the slot must still be free, the case id becomes
 * the slip the patient scans on the day, and the confirmation goes out by SMS
 * and email (see ./notify).
 */
export const fileBooking: NonNullable<ChainSpec["file"]> = async ({ caseId, data, documentNumber }) => {
  if (data.doctorId && (await takenSlots(data.doctorId)).has(`${data.date} ${data.time}`)) {
    return {
      hold: `${formatShortDate(data.date)} at ${data.time} was booked by someone else a moment ago — please choose another time at the counter.`,
    };
  }
  const citizen = documentNumber ? await findCitizenByDocument(documentNumber) : null;
  const clinic = department(data.department)?.name ?? data.department;
  const text =
    `Hospital Concierge: your appointment ${caseId} with ${data.doctorName} (${clinic}) is on ` +
    `${formatShortDate(data.date)} at ${data.time}, ${departmentLocation(data.department)}. ` +
    "Scan your slip at any kiosk to check in on the day.";
  const sent: string[] = [];
  const phone = citizen?.phone?.trim();
  if (phone) {
    const sms = await notify({ channel: "sms", to: phone, body: text, serviceId: "book", caseId });
    if (sms?.delivered) sent.push(`a text to ${maskedPhone(phone)}`);
  }
  const emailAddress = citizen?.email?.trim();
  if (emailAddress) {
    const email = await notify({
      channel: "email",
      to: emailAddress,
      subject: `Appointment confirmed — ${formatShortDate(data.date)} at ${data.time}`,
      body: text,
      serviceId: "book",
      caseId,
    });
    if (email?.delivered) sent.push(`an email to ${maskedEmail(emailAddress)}`);
  }
  return { data: { slipCode: signedSlipCode(caseId), ...(sent.length ? { confirmationSent: sent.join(" and ") } : {}) } };
};

export const bookingFiled: NonNullable<ChainSpec["filed"]> = ({ caseId, status, data }) =>
  status === "on_hold"
    ? ""
    : `See you ${data.date === isoDate(new Date()) ? "today" : `on ${formatShortDate(data.date)}`} at ${data.time} with ${data.doctorName} — ${departmentLocation(data.department)}. ` +
      `Your appointment reference is ${caseId}: ${data.date === isoDate(new Date()) ? "when you arrive" : "on the day"}, scan the slip's barcode at any kiosk to check in.` +
      (data.confirmationSent ? ` We've sent ${data.confirmationSent} to confirm.` : "");

type Slot = { date: string; time: string };

const slotKey = (slot: Slot) => `${slot.date} ${slot.time}`;

/** The slots a chain may offer: the doctor's, minus the ones somebody already holds. */
export async function freeSlots<T extends Slot>(doctorId: string, slots: T[]): Promise<T[]> {
  const taken = await takenSlots(doctorId);
  return slots.filter((slot) => !taken.has(slotKey(slot)));
}

type BookingDoc = { caseId: string; data?: Record<string, string> | null };

/** The patient's upcoming open booking in a clinic, if they already hold one. */
export async function openBookingIn(citizenId: number, departmentId: string): Promise<BookingDoc | null> {
  const today = isoDate(new Date());
  const res = await cmsFind<BookingDoc>("applications", {
    where: {
      citizen: { equals: citizenId },
      serviceId: { in: BOOKING_SERVICES.join(",") },
      status: { in: "in_review,officer_review" },
    },
    limit: 50,
  });
  return res.docs.find((doc) => doc.data?.department === departmentId && (doc.data?.date ?? "") >= today) ?? null;
}

/** The words patients use for each specialist clinic, English and Malay. */
const CLINIC_WORDS: Record<string, RegExp> = {
  cardiology: /\b(cardiology|cardiologist|cardiac|heart|kardiologi|jantung)\b/,
  orthopaedics: /\b(orthopa?edics?|orthopa?edist|ortopedik|ortopedi|bones?|joints?|knee|back pain|tulang)\b/,
  paediatrics: /\b(pa?ediatrics?|pa?ediatrician|pa?ediatrik|child|children|kids?|kanak-kanak)\b/,
  obgyn: /\b(obstetrics?|obstetrician|obstetrik|gyna?ecology|gyna?ecologist|gynae|ginekologi|obgyn|pregnant|pregnancy|antenatal|mengandung|sakit puan)\b/,
  dermatology: /\b(dermatology|dermatologist|dermatologi|skin|rash|eczema|kulit)\b/,
};

/** The specialist clinic words name ("a cardiologist", "a skin doctor"), when they name exactly one. */
export function clinicNamed(said: string): string | undefined {
  const text = said.toLowerCase();
  const named = SPECIALIST_DEPARTMENTS.filter((id) => CLINIC_WORDS[id]?.test(text));
  return named.length === 1 ? named[0] : undefined;
}

/** "Thu 5 Nov": patients ask for a day by its weekday. */
function dayLabel(date: string): string {
  const { weekday, day, month } = formatDayParts(date);
  return `${weekday} ${day} ${month}`;
}

/** Said with the confirm question, which may come straight after the face scan when the time was asked for up front. */
export const CONFIRM_SAY = "Please check the details before I book it.";

/** The confirm question before a slot is taken — the same words in chat as on the touch summary. */
export function confirmAsk(doctorName: string, clinic: string, date: string, time: string) {
  return {
    id: "confirmBooking",
    question: `Book ${doctorName} (${clinic}) on ${dayLabel(date)} at ${time}?`,
    type: "options" as const,
    options: [
      { value: "yes", label: "Yes, book it" },
      { value: "change", label: "Pick another time" },
    ],
  };
}

const WEEKDAY_WORDS: Record<string, number> = {
  sun: 0, sunday: 0, ahad: 0,
  mon: 1, monday: 1, isnin: 1,
  tue: 2, tues: 2, tuesday: 2, selasa: 2,
  wed: 3, wednesday: 3, rabu: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, khamis: 4,
  fri: 5, friday: 5, jumaat: 5,
  sat: 6, saturday: 6, sabtu: 6,
};

const WEEKDAY_CODES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;

/** Month names by their first three letters, English and Malay ("Mac", "Mei", "Ogos", "Okt", "Disember"). */
const MONTH_WORDS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, mac: 2, apr: 3, may: 4, mei: 4, jun: 5,
  jul: 6, aug: 7, ogo: 7, sep: 8, oct: 9, okt: 9, nov: 10, dec: 11, dis: 11,
};

/** A whole month name or its short form — so "decided" or "marks" is no month. */
const MONTH_NAME =
  /^(jan(uary|uari)?|feb(ruary|ruari)?|mar(ch)?|mac|apr(il)?|may|mei|june?|jul(y|ai)?|aug(ust)?|ogos|sept?(ember)?|oct(ober)?|okt(ober)?|nov(ember)?|dec(ember)?|dis(ember)?)$/;

/** "3 Nov", "Nov 3rd", "5 Disember": the next such date from today, this year or the one after. */
function dayOfMonth(text: string, today: Date): string | undefined {
  const match =
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,})/.exec(text) ?? /\b([a-z]{3,})\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(text);
  if (!match) return undefined;
  const [day, word] = /\d/.test(match[1]) ? [Number(match[1]), match[2]] : [Number(match[2]), match[1]];
  if (!MONTH_NAME.test(word)) return undefined;
  const month = MONTH_WORDS[word.slice(0, 3)];
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    const date = new Date(year, month, day);
    if (date.getMonth() === month && isoDate(date) >= isoDate(today)) return isoDate(date);
  }
  return undefined;
}

/** "2026-11-05", or — when the model skipped the calendar — "5 Nov", a weekday, "today" or "tomorrow". */
function requestedDate(said: string | undefined, today: Date): string | undefined {
  const text = said?.trim().toLowerCase() ?? "";
  const iso = ISO_DATE.exec(text)?.[0];
  if (iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return isoDate(new Date(year, month - 1, day)) === iso ? iso : undefined;
  }
  if (/\b(today|hari ini)\b/.test(text)) return isoDate(today);
  if (/\b(tomorrow|esok)\b/.test(text)) return isoDate(addDays(today, 1));
  const dated = dayOfMonth(text, today);
  if (dated) return dated;
  const weekday = text.split(/[^a-z]+/).map((word) => WEEKDAY_WORDS[word]).find((day) => day !== undefined);
  return weekday === undefined ? undefined : isoDate(addDays(today, (weekday - today.getDay() + 7) % 7 || 7));
}

const CLOCK = /\b(\d{1,2})(?:[:.]?(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|pagi|petang|malam)?(?!\d)/gi;

/**
 * "10:00", "10.30", "2330", "10am", "2:30 pm", "3 petang" as 24-hour "HH:MM"; a bare 1 to 6 is the
 * afternoon clinic. A time with minutes or am/pm wins over a bare number ("Mon 2 Nov · 23:00").
 */
function requestedTime(said: string | undefined): string | undefined {
  const found = [...(said ?? "").replace(new RegExp(ISO_DATE, "g"), " ").matchAll(CLOCK)];
  const match = found.find((m) => m[2] || m[3]) ?? found[0];
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const half = match[3]?.toLowerCase().replace(/\./g, "");
  const afternoon = half === "pm" || half === "petang" || half === "malam" || (!half && hour >= 1 && hour <= 6);
  if (afternoon && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The day asked for (`preferredDate`) as "YYYY-MM-DD", without consuming it — `slotRound` does that once a doctor is settled. */
export const askedDay = (data: Record<string, string>): string | undefined => requestedDate(data.preferredDate, new Date());

/**
 * The day and time words name — "what's free today?", "Thursday", "esok", "9:30 please", "3pm" — as the
 * preferredDate/preferredTime a booking flow takes, so the chat can hand them over when its model doesn't. A time
 * counts only with its minutes or am/pm: a bare number is as likely an age or the end of an IC number.
 */
export function namedWhen(said: string): { preferredDate?: string; preferredTime?: string } {
  const preferredDate = requestedDate(said, new Date());
  const clock = [...said.replace(new RegExp(ISO_DATE, "g"), " ").matchAll(CLOCK)].find((m) => m[3] || /\d[:.]\d/.test(m[0]));
  const preferredTime = clock ? requestedTime(clock[0]) : undefined;
  return { ...(preferredDate ? { preferredDate } : {}), ...(preferredTime ? { preferredTime } : {}) };
}

/** "today", or "on Thu 5 Nov" — a day said back to the patient. */
export const onDay = (date: string): string => (date === isoDate(new Date()) ? "today" : `on ${dayLabel(date)}`);

type SlotRequest = { date?: string; time?: string };

const dayAskedBefore = (data: Record<string, string>) => /^\d{4}-\d{2}-\d{2}/.exec(data.requestedSlot ?? "")?.[0];

/** The day and time asked for last (`requestedSlot`), which the times offered stay around until one is picked. */
function standingRequest(data: Record<string, string>): SlotRequest | null {
  const date = dayAskedBefore(data);
  const time = /\b\d{2}:\d{2}\b/.exec(data.requestedSlot ?? "")?.[0];
  return date || time ? { date, time } : null;
}

const fitsRequest = (request: SlotRequest) => (slot: Slot) =>
  (!request.date || slot.date === request.date) && (!request.time || slot.time === request.time);

/**
 * A day and time asked for (`preferredDate`/`preferredTime`), the first time it arrives. A
 * single-turn agent sends every answer it holds on each call, and that repeat must not undo the
 * slot the patient picked since — so the request is consumed, and remembered as `requestedSlot`.
 * A time on its own keeps the day asked for before it ("today" … "at 11pm").
 */
function freshSlotRequest(data: Record<string, string>): SlotRequest | null {
  const time = requestedTime(data.preferredTime);
  const date = requestedDate(data.preferredDate, new Date()) ?? (time ? dayAskedBefore(data) : undefined);
  delete data.preferredDate;
  delete data.preferredTime;
  if (!date && !time) return null;
  const heard = [date, time].filter(Boolean).join(" ");
  if (data.requestedSlot === heard) return null;
  data.requestedSlot = heard;
  return { date, time };
}

/** How many of the closest free times answer a request that can't be met exactly. */
const NEAREST = 4;

const dayNumber = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;

const minuteOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const orList = (items: string[], last = " or ") =>
  items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")}${last}${items[items.length - 1]}`;

/** "today at 15:00 or 15:30, or on Thu 5 Nov at 10:00" — chronological slots, one clause a day. */
function slotList(slots: Slot[]): string {
  const days = [...new Set(slots.map((slot) => slot.date))];
  return orList(
    days.map((date) => `${onDay(date)} at ${orList(slots.filter((slot) => slot.date === date).map((slot) => slot.time))}`),
    ", or ",
  );
}

/** Why the time asked for can't be had, then the closest ones that can. */
function requestLine(doctor: Doctor, request: SlotRequest, offered: Slot[], free: Slot[]): string {
  if (offered.some(fitsRequest(request))) return `${doctor.name} is free ${slotList(offered)}.`;
  const asked = [request.date && `on ${dayLabel(request.date)}`, request.time && `at ${request.time}`].filter(Boolean).join(" ");
  // A day off is said as one, today included, before the booking window is.
  const dayOff =
    request.date &&
    request.date >= isoDate(new Date()) &&
    !free.some((slot) => slot.date === request.date) &&
    !doctor.days.includes(WEEKDAY_CODES[new Date(`${request.date}T00:00`).getDay()]);
  const why = !request.date
    ? `${doctor.name} has no free time ${asked}`
    : dayOff
      ? `${doctor.name} doesn't consult on ${dayLabel(request.date)} — only on ${orList(doctor.days, " and ")}`
      : request.date < free[0].date
        ? `The earliest I can book ${doctor.name} is ${dayLabel(free[0].date)}`
        : request.date > free[free.length - 1].date
          ? `I can only book ${doctor.name} up to ${dayLabel(free[free.length - 1].date)} for now`
          : `${doctor.name} has no free time ${asked}`;
  return `${why}. The closest free times are ${slotList(offered)}.`;
}

const freeAt = (free: Slot[], time: string, date?: string) =>
  free.find((slot) => slot.time === time && (!date || slot.date === date));

/**
 * A slot answered in words rather than by its value — its label, "23:00", "today at 11pm" — as the
 * free slot it names, on the day asked for before when it names none.
 */
function namedSlot(said: string, free: Slot[], data: Record<string, string>): Slot | undefined {
  const labelled = free.find((slot) => `${dayLabel(slot.date)} · ${slot.time}` === said.trim());
  const time = requestedTime(said);
  return labelled ?? (time ? freeAt(free, time, requestedDate(said, new Date()) ?? dayAskedBefore(data)) : undefined);
}

/**
 * The slot round of a booking chain, or null once `data.slot` holds a free slot.
 *
 * A day and time the patient asked for — up front, or instead of the times offered — goes
 * straight to the confirm question when it is free (a time alone: on the day asked for before,
 * else the first day it is free), as does a day with a single free time; otherwise it brings
 * the free times closest to it, with a line saying why, and they stay around it until one is
 * picked. A request the picked slot already fits ("yes, today is fine") keeps it. Without one,
 * the first free time of each clinic day. `free` is in date and time order.
 */
export function slotRound(
  data: Record<string, string>,
  doctor: Doctor,
  free: Slot[],
  question: string,
  intro?: string,
): ApplicationPlan | null {
  if (data.slot && !free.some((slot) => slotKey(slot) === data.slot)) {
    const named = namedSlot(data.slot, free, data);
    if (named) {
      data.slot = slotKey(named);
    } else {
      // A time no free slot has — or a slot taken since it was picked — is asked for like any
      // other, so the patient hears why and the closest free times.
      const day = ISO_DATE.exec(data.slot)?.[0];
      if (day) data.preferredDate = data.preferredDate ?? day;
      data.preferredTime = data.preferredTime ?? data.slot;
      delete data.slot;
    }
  }
  const fresh = freshSlotRequest(data);
  const picked = free.find((slot) => slotKey(slot) === data.slot);
  if (fresh && !(picked && fitsRequest(fresh)(picked))) {
    // Newer than any slot picked before it.
    delete data.slot;
    delete data.confirmBooking;
    const exact = fresh.time ? freeAt(free, fresh.time, fresh.date) : undefined;
    const thatDay = fresh.date && !fresh.time ? free.filter((slot) => slot.date === fresh.date) : [];
    const settled = exact ?? (thatDay.length === 1 ? thatDay[0] : undefined);
    if (settled) data.slot = slotKey(settled);
  }
  if (free.some((slot) => slotKey(slot) === data.slot)) return null;
  if (free.length === 0) {
    return done(`${doctor.name} has no free appointment in the coming weeks — please ask at the registration counter.`);
  }
  const slotAsk = (slots: Slot[]) => ({
    id: "slot",
    question,
    type: "options" as const,
    options: slots.map((slot) => ({ value: slotKey(slot), label: `${dayLabel(slot.date)} · ${slot.time}` })),
  });
  const request = fresh ?? standingRequest(data);
  if (!request) {
    const firstEachDay = free.filter((slot, i) => i === 0 || free[i - 1].date !== slot.date);
    return ask([intro, "These are the first free times — or tell me a day and time that suits you."].filter(Boolean).join(" "), [
      slotAsk(firstEachDay),
    ]);
  }
  const distance = (slot: Slot) =>
    (request.date ? Math.abs(dayNumber(slot.date) - dayNumber(request.date)) * 1440 : 0) +
    (request.time ? Math.abs(minuteOf(slot.time) - minuteOf(request.time)) : 0);
  // A day just asked for that has free times offers those alone; one asked for before, after another time was
  // turned down, offers the closest around it.
  const fitting = fresh ? free.filter(fitsRequest(fresh)) : [];
  const offered = [...(fitting.length > 0 ? fitting : free)]
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, NEAREST)
    .sort((a, b) => slotKey(a).localeCompare(slotKey(b)));
  return ask([intro, requestLine(doctor, request, offered, free)].filter(Boolean).join(" "), [slotAsk(offered)]);
}
