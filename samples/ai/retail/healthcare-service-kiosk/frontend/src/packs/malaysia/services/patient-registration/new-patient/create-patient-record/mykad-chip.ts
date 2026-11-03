// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * "Scan ID → extract demographic data", as the MyKad chip gives it.
 *
 * A real MyKad answers the JPN applet with the holder's name, IC number,
 * address and citizenship; the kiosk reads only the card serial, so the rest
 * is simulated from that serial. The same card always reads as the same
 * person — tap it twice and the details agree — while a different card is
 * somebody new. SYNTHETIC DATA FOR DEMO ONLY.
 */

import { seededRandom } from "@/hospital/records";
import { displayDay } from "@/lib/document-fields";
import { maskId } from "@/lib/mask";

export type ChipDetails = {
  name: string;
  /** Twelve digits, no dashes — the form the registry keeps an IC number in. */
  idNumber: string;
  /** YYYY-MM-DD, as the IC number's first six digits carry it. */
  dateOfBirth: string;
  sex: "female" | "male";
  nationality: string;
  country: string;
  address: { line: string; city: string; postcode: string };
};

/** Where people live, with the place-of-birth code their state carries in an IC number. */
const PLACES = [
  { code: "14", city: "Kuala Lumpur", postcode: "50450", streets: ["Jalan Ampang", "Jalan Tun Razak", "Jalan Bangsar"] },
  { code: "10", city: "Petaling Jaya", postcode: "47300", streets: ["Jalan SS 2/24", "Jalan 17/45", "Jalan Damansara"] },
  { code: "10", city: "Shah Alam", postcode: "40000", streets: ["Jalan Plumbum 7/102", "Persiaran Kayangan"] },
  { code: "01", city: "Johor Bahru", postcode: "80250", streets: ["Jalan Harimau 3", "Jalan Tebrau", "Jalan Wong Ah Fook"] },
  { code: "07", city: "George Town", postcode: "10400", streets: ["Lorong Macalister", "Jalan Burma"] },
  { code: "08", city: "Ipoh", postcode: "30000", streets: ["Jalan Sultan Idris Shah", "Jalan Raja Musa Aziz"] },
  { code: "12", city: "Kota Kinabalu", postcode: "88300", streets: ["Jalan Lintas", "Jalan Gaya"] },
  { code: "13", city: "Kuching", postcode: "93100", streets: ["Jalan Padungan", "Jalan Tabuan"] },
  { code: "04", city: "Melaka", postcode: "75100", streets: ["Jalan Bendahara", "Jalan Hang Tuah"] },
  { code: "05", city: "Seremban", postcode: "70300", streets: ["Jalan Rasah", "Jalan Dato Bandar Tunggal"] },
];

type Sex = ChipDetails["sex"];

/** A Chinese name leads with the surname; a Malay one carries the father's name after bin/binti, an Indian one after a/l or a/p. */
type NamePool = Record<Sex, string[]> &
  ({ surnames: string[] } | { joiner: Record<Sex, string>; parents: string[] });

const NAMES: NamePool[] = [
  {
    male: ["Ahmad Faiz", "Muhammad Hafiz", "Amirul Hakim", "Syafiq", "Khairul Anuar", "Mohd Firdaus"],
    female: ["Nurul Ain", "Siti Aisyah", "Farah Nadia", "Nur Izzati", "Aina Syazwani", "Hidayah"],
    joiner: { male: "bin", female: "binti" },
    parents: ["Abdullah", "Ismail", "Rahman", "Hassan", "Yusof", "Ibrahim", "Razak", "Salleh"],
  },
  {
    male: ["Wei Ming", "Jun Hao", "Kah Wai", "Zhi Hao", "Chee Keong", "Boon Seng"],
    female: ["Mei Ling", "Hui Min", "Xin Yi", "Pei Shan", "Siew Lan", "Jia Hui"],
    surnames: ["Tan", "Lim", "Lee", "Wong", "Ng", "Chong", "Goh", "Ong"],
  },
  {
    male: ["Arun", "Ganesh", "Rajesh", "Suresh", "Vijay", "Kumaran"],
    female: ["Priya", "Kavitha", "Deepa", "Lakshmi", "Shalini", "Nisha"],
    joiner: { male: "a/l", female: "a/p" },
    parents: ["Ramasamy", "Subramaniam", "Krishnan", "Muthu", "Selvaraj", "Nair"],
  },
];

/** The details the chip of the MyKad with this serial gives up. */
export function readChip(serial: string): ChipDetails {
  const rand = seededRandom(`mykad:${serial}`);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
  const digits = (count: number) => String(Math.floor(rand() * 10 ** count)).padStart(count, "0");

  const sex: Sex = rand() < 0.5 ? "female" : "male";
  const people = pick(NAMES);
  const given = pick(people[sex]);
  const name =
    "surnames" in people
      ? `${pick(people.surnames)} ${given}`
      : `${given} ${people.joiner[sex]} ${pick(people.parents)}`;

  // Born 1950–2006: everyone registering here is an adult.
  const year = 1950 + Math.floor(rand() * 57);
  const month = 1 + Math.floor(rand() * 12);
  const day = 1 + Math.floor(rand() * 28);
  const yymmdd = `${String(year % 100).padStart(2, "0")}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;

  const place = pick(PLACES);
  // The last digit is odd for a man and even for a woman.
  const last = 2 * Math.floor(rand() * 5) + (sex === "male" ? 1 : 0);
  return {
    name,
    idNumber: `${yymmdd}${place.code}${digits(3)}${last}`,
    dateOfBirth: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    sex,
    nationality: "Malaysian",
    country: "Malaysia",
    address: {
      line: `No. ${1 + Math.floor(rand() * 120)}, ${pick(place.streets)}`,
      city: place.city,
      postcode: place.postcode,
    },
  };
}

/** "880305-14-5523", the way the card prints it. */
export const formatIc = (idNumber: string): string =>
  /^\d{12}$/.test(idNumber) ? `${idNumber.slice(0, 6)}-${idNumber.slice(6, 8)}-${idNumber.slice(8)}` : idNumber;

/**
 * The read-back the patient confirms, in the chat's question and on the touch
 * screen alike. The IC number shows only its last four digits: the screen sits
 * in a public hall, and the date of birth beside it is the rest of the number.
 */
export function chipLines(details: ChipDetails): { label: string; value: string }[] {
  const { line, postcode, city } = details.address;
  return [
    { label: "Name", value: details.name },
    { label: "IC number", value: maskId(formatIc(details.idNumber)) },
    { label: "Date of birth", value: displayDay(details.dateOfBirth) },
    { label: "Sex", value: details.sex === "female" ? "Female" : "Male" },
    { label: "Nationality", value: details.nationality },
    { label: "Address", value: `${line}, ${postcode} ${city}` },
  ];
}
