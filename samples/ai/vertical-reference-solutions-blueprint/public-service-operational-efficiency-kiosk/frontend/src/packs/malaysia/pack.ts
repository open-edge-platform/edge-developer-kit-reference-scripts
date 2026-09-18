// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CountryPack } from "../types";
import { messages } from "./messages";
import { nlu } from "./nlu";
import { speech } from "./speech";

export const malaysia: CountryPack = {
  id: "malaysia",
  countryName: "Malaysia",
  // Synthetic citizens are Malaysian and Vietnamese — see data/citizens.csv.
  countries: ["Malaysia", "Vietnam"],
  idDocuments: {
    forCountry: (country) => (country === "Malaysia" ? "mykad" : "passport"),
    label: "MyKad",
  },
  locale: {
    language: "en",
    moneyLocale: "en-MY",
    dateLocale: "en-MY",
    clockLocale: "en-US",
    currency: "MYR",
    minKeywordWordLength: 4,
  },
  // Postcode before city: "NO. 12, JALAN …, 88000 Kota Kinabalu, Malaysia".
  formatAddress: ({ line, city, postcode, country }) =>
    `${line}, ${postcode} ${city}, ${country}`,
  messages,
  speech,
  nlu,
  promptVars: {
    // The adjective, not the country name — prompts say "a Malaysian … kiosk".
    country_adjective: "Malaysian",
    id_document: "MyKad",
    // Empty for English; a translated pack sets e.g. "\nAlways reply in Vietnamese."
    language_instruction: "",
  },
};
