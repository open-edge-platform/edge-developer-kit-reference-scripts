// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Messages the kiosk sends on a patient's behalf: an SMS or email confirming
 * a booking, lab results by email, a note to the clinic that a patient has
 * arrived. `notify.driver` picks where they go:
 *
 * - `outbox` (default): kept on this terminal for staff to read at /outbox —
 *   nothing leaves the machine, which is what a demo or a pilot wants.
 * - `webhook`: POSTed as JSON to `notify.webhook_url`, for the hospital's SMS
 *   gateway, mail relay or HIS integration engine to deliver.
 * - `off`: not sent; the screens say nothing was sent.
 */

export type Channel = "sms" | "email" | "clinic";

export type Notice = {
  channel: Channel;
  /** A phone number, an email address, or a clinic's id. */
  to: string;
  subject?: string;
  body: string;
  serviceId?: string;
  caseId?: string;
};

export type SentNotice = Notice & { id: string; at: string; delivered: boolean; error?: string };

type Driver = "outbox" | "webhook" | "off";

const driver = (): Driver => {
  const id = process.env.KIOSK_NOTIFY_DRIVER?.trim().toLowerCase();
  return id === "webhook" || id === "off" ? id : "outbox";
};

const OUTBOX_SIZE = 200;
const WEBHOOK_TIMEOUT_MS = 8_000;

const OUTBOX = Symbol.for("kiosk.notify.outbox");
type Global = { [OUTBOX]?: SentNotice[] };

function outbox(): SentNotice[] {
  const globals = globalThis as Global;
  return (globals[OUTBOX] ??= []);
}

export const notificationsOn = (): boolean => driver() !== "off";

/** Sends one message; never throws — a failed send is reported, not fatal to the flow that asked. */
export async function notify(notice: Notice): Promise<SentNotice | null> {
  const mode = driver();
  if (mode === "off" || !notice.to.trim()) return null;
  const sent: SentNotice = { ...notice, id: crypto.randomUUID(), at: new Date().toISOString(), delivered: true };
  if (mode === "webhook") {
    const url = process.env.KIOSK_NOTIFY_WEBHOOK_URL?.trim();
    try {
      if (!url) throw new Error("notify.webhook_url is not set");
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sent),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`the gateway answered ${res.status}`);
    } catch (error) {
      sent.delivered = false;
      sent.error = (error as Error).message;
    }
  }
  const box = outbox();
  box.unshift(sent);
  box.length = Math.min(box.length, OUTBOX_SIZE);
  return sent;
}

/** The latest messages, newest first, for the staff outbox page. */
export const sentNotices = (): SentNotice[] => [...outbox()];

/** "+60•••••0502" — enough for the patient to recognise their own number on a public screen. */
export function maskedPhone(phone: string): string {
  const digits = phone.replace(/\s/g, "");
  return digits.length <= 4 ? digits : `${digits.slice(0, 3)}${"•".repeat(Math.max(digits.length - 7, 2))}${digits.slice(-4)}`;
}

/** "n•••@demo.local". */
export function maskedEmail(email: string): string {
  const [user, domain] = email.split("@");
  return domain ? `${user.slice(0, 1)}•••@${domain}` : email;
}
