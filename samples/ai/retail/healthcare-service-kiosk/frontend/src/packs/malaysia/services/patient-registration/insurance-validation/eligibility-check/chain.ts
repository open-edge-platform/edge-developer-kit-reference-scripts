// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { documentAsk, documentText } from "@/app/api/_lib/document-text";
import { CURRENCY } from "@/app/api/_lib/registry";
import { formatMoney } from "@/lib/format";
import { ask, done } from "@/app/api/_lib/flows/plan";
import type { ChainContext, ChainSpec } from "@/app/api/_lib/flows/types";
import { PAYERS, payer } from "@/hospital/data";
import { isoDate, patientRecord } from "@/hospital/records";
import { resultMessage } from "@/services/shared/result";
import { CARD_CHOICES, CARD_QUESTION, PAYER_QUESTION, cardData, cardResult, checkCard, withChosenPayer } from "./card";
import { eligibility, eligibilityResult, manualOutcome } from "./eligibility";
import { readInsuranceCard } from "./read";

const money = (amount: number) => formatMoney(amount, CURRENCY);

const payerAsk = (say?: string) =>
  ask(say, [
    {
      id: "payerId",
      question: PAYER_QUESTION,
      type: "options",
      options: PAYERS.map((p) => ({ value: p.id, label: p.name })),
    },
  ]);

function manual(ctx: ChainContext) {
  const chosen = payer(ctx.data.payerId);
  if (!chosen) return payerAsk();
  const outcome = eligibility(patientRecord(ctx.documentNumber), chosen.id, isoDate(new Date()));
  ctx.data.eligibilityOutcome = manualOutcome(outcome);
  return done(resultMessage(eligibilityResult(outcome, chosen.name, chosen.id, money)));
}

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: async (ctx) => {
    if (ctx.data.cardChoice !== "scan" && ctx.data.cardChoice !== "manual") {
      return ask(undefined, [
        {
          id: "cardChoice",
          question: CARD_QUESTION,
          type: "options",
          options: CARD_CHOICES.map((c) => ({ value: c.id, label: c.label })),
        },
      ]);
    }
    if (ctx.data.cardChoice === "manual") return manual(ctx);

    const requirement = ctx.service.documents[0];
    const requestedAt = Number(ctx.data.cardRequestedAt) || 0;
    const card = requestedAt
      ? await documentText({
          serviceId: ctx.service.id,
          documentId: requirement.id,
          documentNumber: ctx.documentNumber,
          since: requestedAt,
        })
      : null;
    if (!card) {
      ctx.data.cardRequestedAt = String(Date.now());
      return ask(undefined, [documentAsk(requirement)]);
    }
    if (card.status === "rejected" && !card.typeMatches) {
      ctx.data.cardRequestedAt = String(Date.now());
      return ask(undefined, [documentAsk(requirement, "That didn't look like an insurance card.")]);
    }
    if (!card.text) {
      ctx.data.cardChoice = "manual";
      ctx.notes.push("I couldn't read your card, so let's find your policy by insurer instead.");
      return manual(ctx);
    }

    const patient = { name: ctx.profile.name, nationalId: ctx.profile.nationalId };
    const { reading, readBy } = await readInsuranceCard(card, patient);
    let found = reading;
    if (!found.payerName) {
      if (!payer(ctx.data.payerId)) return payerAsk("I couldn't tell who issued your card.");
      found = withChosenPayer(found, ctx.data.payerId);
    }
    const onFile = patientRecord(ctx.documentNumber).policy;
    const checks = checkCard(found, patient, new Date(), onFile);
    Object.assign(ctx.data, cardData(found, checks, readBy, onFile, money));
    return done(resultMessage(cardResult(found, checks, onFile, money)));
  },
};
