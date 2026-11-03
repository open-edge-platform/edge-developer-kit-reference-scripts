// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { department } from "@/hospital/data";
import { displayMrn } from "@/hospital/patient-id";
import { formatDayParts } from "@/lib/format";
import { Ticket } from "./escpos";
import type { Appointment } from "./patients";

/** 15 mm bars: the card's MRN and the slip's 20-digit code both run across the paper. */
const BAR_DOTS = 120;

/** The paper patient card: what the kiosk and counter scanners read next time. */
export function patientCardTicket(name: string, mrn: string, widthDots: number): Buffer {
  return new Ticket(widthDots)
    .align("center")
    .line("Hospital Concierge", { bold: true, tall: true })
    .line("PATIENT CARD")
    .rule()
    .align("left")
    .line("Name")
    .line(name.toUpperCase(), { bold: true, tall: true })
    .line(displayMrn(mrn), { bold: true, tall: true })
    .feed(1)
    .code128(mrn, BAR_DOTS)
    .align("center")
    .line(mrn)
    .feed(1)
    .line("Next time, scan this card at any kiosk instead of your MyKad.")
    .feed(3)
    .cut()
    .build();
}

/** The paper appointment slip: the same signed code the screen shows, scanned on the day. */
export function appointmentSlipTicket(appointment: Appointment, slipCode: string, widthDots: number): Buffer {
  const dept = department(appointment.department);
  const day = formatDayParts(appointment.date);
  const ticket = new Ticket(widthDots)
    .align("center")
    .line("Hospital Concierge", { bold: true, tall: true })
    .line("APPOINTMENT SLIP")
    .rule()
    .line(`${day.weekday} ${day.day} ${day.month}  ${appointment.time}`, { bold: true, large: true })
    .line(dept?.name ?? appointment.department, { bold: true })
    .align("left")
    .feed(1);
  if (appointment.doctor) ticket.pair("Doctor", appointment.doctor);
  if (dept) ticket.pair("Where", `${dept.building}, ${dept.floor}`);
  return ticket
    .pair("Reference", appointment.reference)
    .pair("Check in", "From an hour before, at any kiosk")
    .feed(1)
    .code128(slipCode, BAR_DOTS)
    .feed(1)
    .align("center")
    .line("Scan this with your date of birth to check in.")
    .feed(3)
    .cut()
    .build();
}
