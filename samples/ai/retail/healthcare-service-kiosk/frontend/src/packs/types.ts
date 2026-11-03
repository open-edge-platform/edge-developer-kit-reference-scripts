// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type PackIdDocument = "mykad" | "passport";

export type LocaleMeta = {
  /** BCP-47 language tag — <html lang>, STT language hint. */
  language: string;
  /** Intl locale for money amounts (formatMoney). */
  moneyLocale: string;
  /** Intl locale for record dates (formatShortDate). */
  dateLocale: string;
  /** Intl locale for the welcome-screen clock (formatTime/formatDate). */
  clockLocale: string;
  /** ISO 4217 currency code for every fee the kiosk quotes. */
  currency: string;
};

/** Flat catalog; Malaysia's is the canonical key set — a pack missing a key is a compile error. */
export type Messages = Record<string, string>;

export type PackSpeech = {
  /** STT repair vocabulary, `Canonical=alias|alias;…` — default behind `voice.stt.vocabulary`. */
  vocabulary: string;
  /** Lead-in of the transcript-repair user message, before the glossary. */
  repairIntro: string;
  /** Worked repair examples, verbatim prompt lines ending in "\n\n". */
  repairExamples: string;
};

export type CountryPack = {
  id: string;
  /** Must match the registry's `citizen.country` values. */
  countryName: string;
  /** Citizen countries this deployment enrols and serves. */
  countries: readonly string[];
  idDocuments: {
    /** Which document a citizen of `country` presents at this kiosk. */
    forCountry(country: string): PackIdDocument;
    /** What the national card is called on screen ("MyKad"). */
    label: string;
  };
  locale: LocaleMeta;
  /** One line of a structured registry address, ordered the way this country writes it. */
  formatAddress(address: {
    line: string;
    city: string;
    postcode: string;
    country: string;
  }): string;
  messages: Messages;
  speech: PackSpeech;
  /** `{{placeholder}}` values for every system prompt — see src/app/api/_lib/prompts.ts. */
  promptVars: Record<string, string>;
};
