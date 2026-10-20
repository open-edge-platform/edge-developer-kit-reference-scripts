// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { PackSpeech } from "../types";

export const speech: PackSpeech = {
  // Aliases match whole-word, case-insensitively — keep them distinctive
  // ("my card" is deliberately not an alias for MyKad).
  vocabulary: [
    "MyKad=my cad|mycad|my kad|mykat|my cat|mic|mikad",
    "MyTentera=my tentera|mytentara",
    "saman=simon|summon|salmon|samurai",
    "JPJ=jay pee jay|jpj",
    "JKM=jay kay em",
    "Bantuan=bantwan|ban tuan",
    "KPP=kay pee pee",
    "LKM=el kay em",
    "SKB=ess kay bee",
  ].join(";"),

  repairIntro: "Local Malaysian terms the recogniser gets wrong",

  repairExamples:
    '"Can I replace my mic?" -> {"text": "Can I replace my MyKad?"}\n' +
    '"I want to pay my simon." -> {"text": "I want to pay my saman."}\n' +
    '"My my tentra card is damaged." -> {"text": "My MyTentera card is damaged."}\n' +
    '"I need to renew my jay pee jay licence." -> {"text": "I need to renew my JPJ licence."}\n' +
    '"I want to pay by card." -> {"text": "I want to pay by card."}\n' +
    '"How much does it cost?" -> {"text": "How much does it cost?"}\n\n',
};
