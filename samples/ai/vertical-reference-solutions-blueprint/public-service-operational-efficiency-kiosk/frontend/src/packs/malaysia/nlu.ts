// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CountryPack } from "../types";

export const nlu: CountryPack["nlu"] = {
  serviceKeywords: {
    roadtax: ["road tax", "roadtax", "lkm", "vehicle registration", "renew tax"],
    fine: ["fine", "saman", "summons", "summonses", "penalty", "ticket"],
    dl_renew: ["renew license", "renew my license", "license renewal", "replace license", "cdl"],
    dl_new: ["new license", "first license", "apply license", "kpp", "probationary"],
    idcard: ["mykad", "id card", "ic replacement", "lost ic", "identity card"],
    address: ["address", "moved", "moving house", "change address"],
    police: ["good conduct", "police clearance", "skb", "conduct certificate", "clearance"],
    birth: ["birth", "newborn", "baby", "born"],
    marriage: ["marriage", "marry", "wedding", "kahwin"],
    welfare: ["welfare", "aid", "bantuan", "jkm", "assistance", "oku", "senior"],
  },

  requestsKeywords: [
    "my request",
    "my application",
    "my case",
    "my saved",
    "application status",
    "status of my",
    "check my status",
    "check status",
    "track my",
    "resume",
    "continue my",
    "continue where",
    "saved application",
    "pending application",
  ],

  phoneticHint:
    "The message may come from speech recognition and can contain phonetic errors " +
    '(for example "my cad", "my kad" or "mic" for MyKad; "simon" or "summon" for saman).',

  routeExamples:
    '- "I got a ticket last week" -> {"serviceId": "fine"}\n' +
    '- "my licence runs out next month" -> {"serviceId": "dl_renew"}\n\n',
};
