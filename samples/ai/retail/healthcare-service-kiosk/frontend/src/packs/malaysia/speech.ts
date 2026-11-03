// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { PackSpeech } from "../types";

export const speech: PackSpeech = {
  // Aliases match whole-word, case-insensitively — keep them distinctive
  // ("my card" is deliberately not an alias for MyKad).
  vocabulary: [
    "MyKad=my cad|mycad|my kad|mykat|my cat|mic|mikad",
    "MyTentera=my tentera|mytentara",
    "MRN=em are en|em-are-en|m r n",
    "HbA1c=h b a one c|hb a one c|aitch b a one c",
    "ECG=e c g|easy g",
    "MRI=em ar eye|m r i|em ri",
    "Paediatrics=pediatrics|pedia tricks",
    "Orthopaedics=orthopedics|ortho pedics",
    "O&G=o and g|oh and gee",
  ].join(";"),

  repairIntro: "Local Malaysian and hospital terms the recogniser gets wrong",

  repairExamples:
    '"Can I replace my mic?" -> {"text": "Can I replace my MyKad?"}\n' +
    '"My my tentra card is damaged." -> {"text": "My MyTentera card is damaged."}\n' +
    '"What is my em are en?" -> {"text": "What is my MRN?"}\n' +
    '"I need my h b a one c results." -> {"text": "I need my HbA1c results."}\n' +
    '"I have an appointment with pedia tricks." -> {"text": "I have an appointment with Paediatrics."}\n' +
    '"I want to pay by card." -> {"text": "I want to pay by card."}\n' +
    '"How much does it cost?" -> {"text": "How much does it cost?"}\n\n',
};
