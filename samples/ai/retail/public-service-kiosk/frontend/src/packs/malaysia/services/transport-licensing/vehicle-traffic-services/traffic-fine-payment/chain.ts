// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { countOf, formatMoney, formatShortDate } from "@/lib/format";
import { fetchFines } from "@/app/api/_lib/flows/bridge";
import { ask, done, READY } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
/** The pattern check is deliberately loose — it only has to reject a value that is not a reference at all. */
const FINE_LOOKUP_KEYS: Record<
  string,
  { option: string; noun: string; question: string; placeholder: string; pattern: RegExp }
> = {
  summons: {
    option: "By summons number (on the saman notice)",
    noun: "summons number",
    question: "What is the summons number printed on the notice?",
    placeholder: "e.g. WJ10000137",
    pattern: /^[A-Z]{1,3}\d{5,}$/,
  },
  plate: {
    option: "By vehicle plate number",
    noun: "plate number",
    question: "What is the vehicle's plate number?",
    placeholder: "e.g. WXY 1234",
    pattern: /^[A-Z]{1,3}\d{1,4}[A-Z]?$/,
  },
  mykad: {
    option: "By another person's MyKad number",
    noun: "MyKad number",
    question: "Which MyKad number should I search? Please enter it in full.",
    placeholder: "e.g. MY3080592042",
    pattern: /^[A-Z]{0,2}\d{6,}$/,
  },
};

/** Registries store references upper-cased and unspaced, so compare and search on that form. */
const normalizeReference = (value: string) => value.toUpperCase().replace(/[\s-]+/g, "");

const lookupByAsk = (): Ask => ({
  id: "lookupBy",
  question: "How would you like to search?",
  type: "options",
  options: Object.entries(FINE_LOOKUP_KEYS).map(([value, key]) => ({
    value,
    label: key.option,
  })),
});

const referenceAsk = (key: (typeof FINE_LOOKUP_KEYS)[string]): Ask => ({
  id: "reference",
  question: key.question,
  type: "text",
  placeholder: key.placeholder,
});

export const chain: ChainSpec = {
  application: async (ctx) => {
    if (!ctx.data.lookupBy && !ctx.data.reference) {
      const own = await fetchFines("mykad", ctx.documentNumber);
      if (own.fines.length > 0) {
        ctx.data.lookupBy = "mykad";
        ctx.data.reference = ctx.documentNumber;
      } else {
        // Asked on its own round — asked alongside the reference, the answer lands in the reference field.
        return ask(
          "Good news — there are no outstanding summonses under your IC. You can still settle " +
            "a summons under another reference (a family member's saman, another vehicle).",
          [lookupByAsk()],
        );
      }
    }
    const lookupBy = FINE_LOOKUP_KEYS[ctx.data.lookupBy] ? ctx.data.lookupBy : "summons";
    const key = FINE_LOOKUP_KEYS[lookupBy];
    const reference = normalizeReference(ctx.data.reference ?? "");
    if (!key.pattern.test(reference)) {
      const rejected = ctx.data.reference?.trim();
      // Dropped so an already-rejected value can't come back out of the saved draft next round.
      delete ctx.data.reference;
      return ask(
        rejected
          ? `"${rejected}" doesn't look like a ${key.noun} — one looks like ` +
              `${key.placeholder.replace("e.g. ", "")}.`
          : `Right — I'll search by ${key.noun}.`,
        [referenceAsk(key)],
      );
    }
    ctx.data.lookupBy = lookupBy;
    ctx.data.reference = reference;

    const result = await fetchFines(lookupBy, reference);
    if (result.fines.length === 0) {
      return done(
        `No outstanding summonses were found for ${key.noun} ${reference} — nothing to pay. ` +
          "Note that unpaid summonses past 60 days lead to blacklisting, which blocks " +
          "license and road tax renewal.",
      );
    }
    ctx.notes.push(
      `Found ${countOf(result.fines.length, "outstanding summons", "outstanding summonses")} ` +
        `totalling ${formatMoney(result.total, result.currency)}:\n` +
        result.fines
          .map(
            (f) =>
              `• ${f.offence} — ${f.summonsNo}, ${f.plateNumber}, issued ` +
              `${formatShortDate(f.issuedAt)}: ${formatMoney(f.amount, result.currency)}`,
          )
          .join("\n"),
    );
    return READY;
  },
};
