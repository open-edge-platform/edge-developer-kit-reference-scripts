// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Mock hospital information system: static catalogs the healthcare services read. */

export type Department = {
  id: string;
  name: string;
  building: string;
  floor: string;
  /** The department's room on the hospital map (src/hospital/wayfinding.ts). */
  place: string;
  hours: string;
  /** Spoken and printed directions from the main entrance, for when the map is unavailable. */
  directions: string[];
  services: string;
  /** What to bring or do first — "Explain services, hours, requirements". */
  requirements: string;
};

const SPECIALIST_REQUIREMENTS =
  "By appointment. A first visit needs a referral letter from your GP or another hospital; bring your MyKad or passport, and your insurance card if you have one.";

export const DEPARTMENTS: Department[] = [
  {
    id: "cardiology",
    name: "Cardiology",
    building: "Block A",
    floor: "Level 4",
    place: "a-l4-cardiology",
    hours: "Mon–Fri 8:00–17:00",
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 2 floors to Level 4", "Exit and head south", "Arrive at Cardiology"],
    services: "Heart checks, ECG, echocardiogram, stress tests",
    requirements: SPECIALIST_REQUIREMENTS,
  },
  {
    id: "orthopaedics",
    name: "Orthopaedics",
    building: "Block B",
    floor: "Level 5",
    place: "b-l5-orthopaedics",
    hours: "Mon–Fri 8:00–17:00",
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 3 floors to Level 5", "Exit and head south", "Turn left", "Turn left", "Turn right", "Arrive at Orthopaedics on your right"],
    services: "Bone, joint and sports injuries, fracture follow-up",
    requirements: SPECIALIST_REQUIREMENTS,
  },
  {
    id: "paediatrics",
    name: "Paediatrics",
    building: "Block C",
    floor: "Level 3",
    place: "c-l3-paediatrics",
    hours: "Mon–Sat 8:00–20:00",
    directions: ["Head north on Level 2", "Take the escalator up to Level 3", "Exit and head north", "Turn left", "Turn left", "Turn right", "Arrive at Paediatrics on your left"],
    services: "Child health, vaccinations, growth checks",
    requirements: SPECIALIST_REQUIREMENTS,
  },
  {
    id: "obgyn",
    name: "Obstetrics & Gynaecology",
    building: "Block C",
    floor: "Level 6",
    place: "c-l6-obstetrics-gynaecology",
    hours: "Mon–Fri 8:00–17:00",
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 4 floors to Level 6", "Exit and head south", "Turn right", "Turn right", "Turn left", "Arrive at Obstetrics & Gynaecology on your left"],
    services: "Antenatal care, women's health, fertility consults",
    requirements: SPECIALIST_REQUIREMENTS,
  },
  {
    id: "dermatology",
    name: "Dermatology",
    building: "Block A",
    floor: "Level 3",
    place: "a-l3-dermatology",
    hours: "Mon–Fri 9:00–17:00",
    directions: ["Head north on Level 2", "Take the escalator up to Level 3", "Exit and head north", "Turn right", "Arrive at Dermatology on your left"],
    services: "Skin, hair and nail conditions",
    requirements: SPECIALIST_REQUIREMENTS,
  },
  {
    id: "radiology",
    name: "Radiology",
    building: "Block A",
    floor: "Level 2",
    place: "a-l2-radiology",
    hours: "Daily 7:00–22:00",
    directions: ["Head north on Level 2", "Turn right", "Turn left", "Turn left", "Arrive at Radiology on your right"],
    services: "X-ray, ultrasound, CT and MRI scans",
    requirements: "Bring the imaging request form from your doctor. Some scans need fasting or a full bladder — the form says so.",
  },
  {
    id: "laboratory",
    name: "Laboratory",
    building: "Block A",
    floor: "Level 2",
    place: "a-l2-laboratory",
    hours: "Daily 7:00–21:00",
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Arrive at Laboratory"],
    services: "Blood and urine tests, sample collection",
    requirements: "Bring the lab request form from your doctor. Fasting tests need 8–12 hours without food; water is fine.",
  },
  {
    id: "pharmacy",
    name: "Pharmacy",
    building: "Block A",
    floor: "Level 1",
    place: "a-l1-pharmacy",
    hours: "Daily 8:00–22:00",
    directions: ["Head north on Level 2", "Bear left", "Take the escalator down to Level 1", "Exit and head east", "Arrive at Pharmacy on your left"],
    services: "Prescription collection, refills, medication advice",
    requirements: "Bring your prescription, or your MyKad or patient card for a refill.",
  },
  {
    id: "emergency",
    name: "Emergency Department",
    building: "Block D",
    floor: "Level 1",
    place: "d-l1-emergency-department",
    hours: "24 hours",
    directions: ["Head north on Level 2", "Bear left", "Take the escalator down to Level 1", "Exit and head north", "Arrive at Emergency Department on your left"],
    services: "Accident and emergency care, 24 hours",
    requirements: "Come straight in — no appointment or referral is needed.",
  },
  {
    id: "registration",
    name: "Registration & Admissions",
    building: "Block A",
    floor: "Level 2",
    place: "a-l2-registration-admissions",
    hours: "Mon–Sat 7:30–20:00",
    directions: ["Head north on Level 2", "Turn left", "Arrive at Registration & Admissions on your left"],
    services: "New patient registration, patient cards, admissions, verification help",
    requirements: "Bring your MyKad or passport. New patients can also register at the kiosk.",
  },
  {
    id: "billing",
    name: "Billing & Insurance Counter",
    building: "Block A",
    floor: "Level 2",
    place: "a-l2-billing-insurance-counter",
    hours: "Mon–Sat 8:00–20:00",
    directions: ["Head north on Level 2", "Turn right", "Arrive at Billing & Insurance Counter on your right"],
    services: "Payments, insurance guarantee letters, invoices",
    requirements: "Bring your invoice or MyKad, and your insurance card for a Guarantee Letter.",
  },
];

export const SPECIALIST_DEPARTMENTS = ["cardiology", "orthopaedics", "paediatrics", "obgyn", "dermatology"];

/** Numbered wards are named by level and block: Ward 5A is on Level 5 of Block A, its rooms 5A-01 onwards. */
export type WardGroup = "numbered" | "intensive" | "other";

export type Ward = {
  id: string;
  /** As signed and as named on the map. */
  name: string;
  /** The ward number or unit visitors ask for: "5A", "ICU". */
  code?: string;
  group: WardGroup;
  care: string;
  building: string;
  floor: string;
  /** The ward's counter, or the ward itself, on the hospital map. */
  place: string;
  visiting: string;
  keywords: string[];
  /** Spoken and printed directions from the main entrance, for when the map is unavailable. */
  directions: string[];
};

const GENERAL_VISITING = "Visiting 12:00–14:00 and 17:00–21:00";
const INTENSIVE_VISITING = "Visits arranged with the ward nurse";

export const WARDS: Ward[] = [
  {
    id: "ward-4a",
    name: "Ward 4A",
    code: "4A",
    group: "numbered",
    care: "Cardiac ward",
    building: "Block A",
    floor: "Level 4",
    place: "a-l4-ward-4a",
    visiting: GENERAL_VISITING,
    keywords: ["cardiac ward", "heart ward"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 2 floors to Level 4", "Exit and head north", "Turn left", "Arrive at Ward 4A on your left"],
  },
  {
    id: "ward-4b",
    name: "Ward 4B",
    code: "4B",
    group: "numbered",
    care: "Medical ward",
    building: "Block B",
    floor: "Level 4",
    place: "b-l4-ward-4b",
    visiting: GENERAL_VISITING,
    keywords: ["medical ward", "general ward"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 2 floors to Level 4", "Exit and head south", "Turn left", "Turn left", "Turn right", "Arrive at Ward 4B on your left"],
  },
  {
    id: "ward-4c",
    name: "Ward 4C",
    code: "4C",
    group: "numbered",
    care: "Children's ward",
    building: "Block C",
    floor: "Level 4",
    place: "c-l4-ward-4c",
    visiting: "Parents any time; other visitors 12:00–14:00 and 17:00–21:00",
    keywords: ["paediatric ward", "pediatric ward", "children's ward", "childrens ward", "kids ward"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 2 floors to Level 4", "Exit and head south", "Turn right", "Turn right", "Turn left", "Arrive at Ward 4C on your right"],
  },
  {
    id: "ward-5a",
    name: "Ward 5A",
    code: "5A",
    group: "numbered",
    care: "Orthopaedic ward",
    building: "Block A",
    floor: "Level 5",
    place: "a-l5-ward-5a",
    visiting: GENERAL_VISITING,
    keywords: ["orthopaedic ward", "orthopedic ward", "bone ward"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 3 floors to Level 5", "Exit and head north", "Turn left", "Arrive at Ward 5A on your left"],
  },
  {
    id: "ward-5c",
    name: "Ward 5C",
    code: "5C",
    group: "numbered",
    care: "Maternity ward",
    building: "Block C",
    floor: "Level 5",
    place: "c-l5-ward-5c",
    visiting: "Partners any time; other visitors 12:00–14:00 and 17:00–21:00",
    keywords: ["maternity ward", "maternity", "postnatal ward", "new mothers", "bersalin"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 3 floors to Level 5", "Exit and head south", "Turn right", "Turn right", "Turn left", "Arrive at Ward 5C on your right"],
  },
  {
    id: "ward-6a",
    name: "Ward 6A",
    code: "6A",
    group: "numbered",
    care: "Surgical ward",
    building: "Block A",
    floor: "Level 6",
    place: "a-l6-ward-6a",
    visiting: GENERAL_VISITING,
    keywords: ["surgical ward"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 4 floors to Level 6", "Exit and head north", "Turn left", "Arrive at Ward 6A on your left"],
  },
  {
    id: "ward-6b",
    name: "Ward 6B",
    code: "6B",
    group: "numbered",
    care: "Gynaecology ward",
    building: "Block B",
    floor: "Level 6",
    place: "b-l6-ward-6b",
    visiting: GENERAL_VISITING,
    keywords: ["gynaecology ward", "gynecology ward", "gynae ward", "women's ward"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 4 floors to Level 6", "Exit and head south", "Turn left", "Turn left", "Turn right", "Arrive at Ward 6B on your left"],
  },
  {
    id: "ward-7a",
    name: "Ward 7A",
    code: "7A",
    group: "numbered",
    care: "Private suites",
    building: "Block A",
    floor: "Level 7",
    place: "a-l7-ward-7a",
    visiting: "Visiting 10:00–21:00",
    keywords: ["private suite", "private ward", "single room"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 5 floors to Level 7", "Exit and head north", "Turn left", "Arrive at Ward 7A on your left"],
  },
  {
    id: "ward-7b",
    name: "Ward 7B",
    code: "7B",
    group: "numbered",
    care: "Private suites",
    building: "Block B",
    floor: "Level 7",
    place: "b-l7-ward-7b",
    visiting: "Visiting 10:00–21:00",
    keywords: ["private suite", "private ward", "single room"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 5 floors to Level 7", "Exit and head south", "Turn left", "Turn left", "Turn right", "Arrive at Ward 7B on your left"],
  },
  {
    id: "icu",
    name: "Intensive Care Unit",
    code: "ICU",
    group: "intensive",
    care: "Adult intensive care",
    building: "Block A",
    floor: "Level 7",
    place: "a-l7-intensive-care-unit",
    visiting: INTENSIVE_VISITING,
    keywords: ["intensive care", "critical care", "unit rawatan rapi"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 5 floors to Level 7", "Exit and head north", "Turn left", "Arrive at Intensive Care Unit on your right"],
  },
  {
    id: "hdu",
    name: "High Dependency Unit",
    code: "HDU",
    group: "intensive",
    care: "Close monitoring after intensive care",
    building: "Block A",
    floor: "Level 7",
    place: "a-l7-high-dependency-unit",
    visiting: INTENSIVE_VISITING,
    keywords: ["high dependency", "step-down"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 5 floors to Level 7", "Exit and head north", "Turn right", "Arrive at High Dependency Unit on your left"],
  },
  {
    id: "ccu",
    name: "Coronary Care Unit",
    code: "CCU",
    group: "intensive",
    care: "Heart intensive care",
    building: "Block A",
    floor: "Level 4",
    place: "a-l4-coronary-care-unit",
    visiting: INTENSIVE_VISITING,
    keywords: ["coronary care", "cardiac intensive care"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 2 floors to Level 4", "Exit and head north", "Turn left", "Arrive at Coronary Care Unit on your right"],
  },
  {
    id: "sicu",
    name: "Surgical ICU",
    code: "SICU",
    group: "intensive",
    care: "Intensive care after surgery",
    building: "Block D",
    floor: "Level 2",
    place: "d-l2-surgical-icu",
    visiting: INTENSIVE_VISITING,
    keywords: ["surgical intensive care", "post-op intensive care"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Turn left", "Arrive at Surgical ICU on your right"],
  },
  {
    id: "nicu",
    name: "Neonatal ICU",
    code: "NICU",
    group: "intensive",
    care: "Newborn intensive care",
    building: "Block C",
    floor: "Level 4",
    place: "c-l4-neonatal-icu",
    visiting: "Parents any time; other visitors with the nurse",
    keywords: ["neonatal intensive care", "newborn intensive care", "premature baby"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 2 floors to Level 4", "Exit and head south", "Turn right", "Turn right", "Turn left", "Arrive at Neonatal ICU on your left"],
  },
  {
    id: "picu",
    name: "Paediatric ICU",
    code: "PICU",
    group: "intensive",
    care: "Children's intensive care",
    building: "Block C",
    floor: "Level 4",
    place: "c-l4-paediatric-icu",
    visiting: "Parents any time; other visitors with the nurse",
    keywords: ["paediatric intensive care", "pediatric intensive care", "children's intensive care", "pediatric icu"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 2 floors to Level 4", "Exit and head south", "Turn right", "Turn right", "Turn left", "Arrive at Paediatric ICU on your left"],
  },
  {
    id: "isolation-ward",
    name: "Isolation Ward",
    group: "other",
    care: "Infection control",
    building: "Block A",
    floor: "Level 6",
    place: "a-l6-isolation-ward",
    visiting: "Ask the ward nurse before visiting",
    keywords: ["isolation", "infectious", "quarantine"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 4 floors to Level 6", "Exit and head north", "Turn left", "Arrive at Isolation Ward on your right"],
  },
  {
    id: "recovery-ward",
    name: "Recovery Ward",
    group: "other",
    care: "Recovery after surgery",
    building: "Block A",
    floor: "Level 5",
    place: "a-l5-recovery-ward",
    visiting: GENERAL_VISITING,
    keywords: ["recovery", "post-op ward"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 3 floors to Level 5", "Exit and head north", "Turn left", "Arrive at Recovery Ward on your right"],
  },
  {
    id: "observation-ward",
    name: "Observation Ward",
    group: "other",
    care: "Emergency short stay",
    building: "Block D",
    floor: "Level 1",
    place: "d-l1-observation-ward",
    visiting: "One companion at a time",
    keywords: ["observation", "short stay", "emergency ward"],
    directions: ["Head north on Level 2", "Bear left", "Take the escalator down to Level 1", "Exit and head north", "Turn right", "Arrive at Observation Ward on your left"],
  },
  {
    id: "paediatric-day-ward",
    name: "Paediatric Day Ward",
    group: "other",
    care: "Children's day treatment",
    building: "Block C",
    floor: "Level 3",
    place: "c-l3-paediatric-day-ward",
    visiting: "One parent stays with the child",
    keywords: ["day ward", "children's day ward", "pediatric day ward"],
    directions: ["Head north on Level 2", "Take the escalator up to Level 3", "Exit and head north", "Turn left", "Turn left", "Turn right", "Arrive at Paediatric Day Ward on your right"],
  },
  {
    id: "special-care-nursery",
    name: "Special Care Nursery",
    group: "other",
    care: "Newborn special care",
    building: "Block C",
    floor: "Level 4",
    place: "c-l4-special-care-nursery",
    visiting: "Parents any time; other visitors with the nurse",
    keywords: ["nursery", "scn", "special care baby"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 2 floors to Level 4", "Exit and head south", "Turn right", "Turn right", "Turn left", "Arrive at Special Care Nursery on your left"],
  },
  {
    id: "labour-suite",
    name: "Labour Suite",
    group: "other",
    care: "Labour and delivery",
    building: "Block C",
    floor: "Level 5",
    place: "c-l5-labour-suite",
    visiting: "One birth partner",
    keywords: ["labour ward", "labor ward", "labour room", "delivery suite", "giving birth"],
    directions: ["Head north on Level 2", "Turn left", "Turn right", "Take the lift up 3 floors to Level 5", "Exit and head south", "Turn right", "Turn right", "Turn left", "Arrive at Labour Suite on your left"],
  },
];

export type Doctor = {
  id: string;
  name: string;
  department: string;
  languages: string[];
  days: string[];
};

export const DOCTORS: Doctor[] = [
  { id: "d01", name: "Dr. Aisyah Rahman", department: "cardiology", languages: ["English", "Malay"], days: ["Mon", "Wed", "Fri"] },
  { id: "d02", name: "Dr. Lim Wei Jie", department: "cardiology", languages: ["English", "Mandarin"], days: ["Tue", "Thu"] },
  { id: "d03", name: "Dr. Rajesh Kumar", department: "orthopaedics", languages: ["English", "Tamil", "Malay"], days: ["Mon", "Tue", "Thu"] },
  { id: "d04", name: "Dr. Tan Mei Ling", department: "orthopaedics", languages: ["English", "Mandarin", "Cantonese"], days: ["Wed", "Fri"] },
  { id: "d05", name: "Dr. Nurul Huda", department: "paediatrics", languages: ["English", "Malay"], days: ["Mon", "Tue", "Wed", "Thu", "Fri"] },
  { id: "d06", name: "Dr. Siti Aminah", department: "obgyn", languages: ["English", "Malay", "Arabic"], days: ["Mon", "Thu"] },
  { id: "d07", name: "Dr. Chong Kah Wai", department: "obgyn", languages: ["English", "Mandarin"], days: ["Tue", "Fri"] },
  { id: "d08", name: "Dr. Priya Nair", department: "dermatology", languages: ["English", "Tamil", "Malayalam"], days: ["Mon", "Wed"] },
];

export const SLOT_TIMES = ["09:00", "09:30", "10:00", "10:30", "11:00", "14:00", "14:30", "15:00", "15:30"];

export type LabTest = {
  id: string;
  name: string;
  keywords: string[];
  price: number;
  preparation: string;
  turnaround: string;
};

export const LAB_TESTS: LabTest[] = [
  { id: "fbc", name: "Full Blood Count", keywords: ["fbc", "blood count", "cbc", "haemoglobin", "hemoglobin", "anaemia", "anemia", "platelet", "white cell", "complete blood"], price: 35, preparation: "No fasting needed", turnaround: "Same day" },
  { id: "lipid", name: "Lipid Profile", keywords: ["lipid", "cholesterol", "triglyceride", "ldl", "hdl", "blood fat"], price: 60, preparation: "Fast for 10–12 hours (water is fine)", turnaround: "Same day" },
  { id: "fbs", name: "Fasting Blood Sugar", keywords: ["sugar", "glucose", "diabetes", "fbs", "fasting"], price: 20, preparation: "Fast for 8 hours (water is fine)", turnaround: "Same day" },
  { id: "hba1c", name: "HbA1c", keywords: ["hba1c", "a1c", "diabetes", "glycated", "average sugar"], price: 55, preparation: "No fasting needed", turnaround: "1 day" },
  { id: "lft", name: "Liver Function Test", keywords: ["liver", "lft", "alt", "ast", "bilirubin", "jaundice"], price: 70, preparation: "No fasting needed", turnaround: "1 day" },
  { id: "rft", name: "Renal Function Test", keywords: ["kidney", "renal", "rft", "creatinine", "urea", "egfr", "electrolytes"], price: 65, preparation: "No fasting needed", turnaround: "1 day" },
  { id: "tsh", name: "Thyroid Function (TSH)", keywords: ["thyroid", "tsh", "t4", "goitre", "goiter"], price: 80, preparation: "No fasting needed", turnaround: "2 days" },
  { id: "ufeme", name: "Urine FEME", keywords: ["urine", "feme", "urinalysis", "uti", "pee"], price: 25, preparation: "Bring a mid-stream morning urine sample", turnaround: "Same day" },
];

export type Procedure = {
  id: string;
  name: string;
  department: string;
  charges: { label: string; amount: number }[];
};

export const PROCEDURES: Procedure[] = [
  {
    id: "mri-knee",
    name: "MRI Knee",
    department: "radiology",
    charges: [{ label: "Scan", amount: 1100 }, { label: "Radiologist report", amount: 150 }],
  },
  {
    id: "ct-brain",
    name: "CT Brain",
    department: "radiology",
    charges: [{ label: "Scan", amount: 850 }, { label: "Radiologist report", amount: 150 }],
  },
  {
    id: "echo",
    name: "Echocardiogram",
    department: "cardiology",
    charges: [{ label: "Procedure", amount: 450 }, { label: "Cardiologist review", amount: 120 }],
  },
  {
    id: "colonoscopy",
    name: "Colonoscopy (day case)",
    department: "laboratory",
    charges: [{ label: "Procedure", amount: 1800 }, { label: "Sedation", amount: 350 }, { label: "Day-care bed", amount: 250 }],
  },
  {
    id: "knee-arthroscopy",
    name: "Knee Arthroscopy (day case)",
    department: "orthopaedics",
    charges: [{ label: "Surgeon fee", amount: 2800 }, { label: "Theatre and anaesthesia", amount: 2400 }, { label: "Day-care bed", amount: 250 }],
  },
];

export type Payer = { id: string; name: string; coveragePercent: number };

export const PAYERS: Payer[] = [
  { id: "aia", name: "AIA Malaysia", coveragePercent: 90 },
  { id: "allianz", name: "Allianz Malaysia", coveragePercent: 80 },
  { id: "greateastern", name: "Great Eastern", coveragePercent: 85 },
  { id: "prudential", name: "Prudential BSN", coveragePercent: 80 },
];

export type Medication = { name: string; dosage: string; price: number };

export const MEDICATIONS: Medication[] = [
  { name: "Amlodipine 5 mg", dosage: "1 tablet once daily", price: 18 },
  { name: "Metformin 500 mg", dosage: "1 tablet twice daily after meals", price: 15 },
  { name: "Atorvastatin 20 mg", dosage: "1 tablet at night", price: 32 },
  { name: "Losartan 50 mg", dosage: "1 tablet once daily", price: 28 },
  { name: "Omeprazole 20 mg", dosage: "1 capsule before breakfast", price: 22 },
  { name: "Salbutamol inhaler", dosage: "2 puffs when needed", price: 25 },
];

export const CONSULTATION_FEE = 120;

/** What each clinic prescribes at a visit, ready at the pharmacy the same day — the mock HIS has no consultation notes. */
export const VISIT_MEDICATIONS: Record<string, Medication> = {
  cardiology: { name: "Amlodipine 5 mg", dosage: "1 tablet once daily", price: 18 },
  orthopaedics: { name: "Celecoxib 200 mg", dosage: "1 capsule twice daily after meals", price: 36 },
  paediatrics: { name: "Paracetamol syrup 120 mg/5 ml", dosage: "5 ml every 6 hours when needed", price: 9 },
  obgyn: { name: "Folic acid 5 mg", dosage: "1 tablet once daily", price: 8 },
  dermatology: { name: "Hydrocortisone cream 1%", dosage: "Apply thinly twice daily", price: 14 },
};

export type HospitalTopic = { id: string; question: string; keywords: string[]; answer: string };

export const HOSPITAL_TOPICS: HospitalTopic[] = [
  { id: "visiting", question: "Visiting hours", keywords: ["visit", "visiting", "visitor"], answer: "General wards: 12:00–14:00 and 17:00–21:00 daily; private suites (Wards 7A and 7B): 10:00–21:00. Two visitors per patient at a time. ICU, HDU, CCU and isolation visits are arranged with the ward nurse." },
  { id: "parking", question: "Parking", keywords: ["parking", "car", "park"], answer: "Multi-storey car park beside Block D. RM3 for the first hour, RM2 each hour after. Pay at the machines on the ground floor." },
  { id: "health-screening", question: "Health screening packages", keywords: ["screening", "check-up", "checkup", "package"], answer: "Basic, Executive and Comprehensive packages from RM250. Book at the Health Screening Centre, Block A Level 1. Fast overnight before the visit." },
  { id: "vaccination", question: "Vaccinations", keywords: ["vaccine", "vaccination", "jab", "immunisation"], answer: "Adult and child vaccinations at the Paediatric Clinic (Block C Level 3), Mon–Sat 8:00–20:00. Bring your vaccination card." },
  { id: "emergency", question: "Emergency care", keywords: ["emergency", "urgent", "a&e", "accident"], answer: "The Emergency Department in Block D is open 24 hours. In a life-threatening emergency call 999." },
  { id: "medical-report", question: "Medical reports", keywords: ["report", "medical report", "records"], answer: "Request medical reports at the Medical Records counter, Block A Level 2. Ready in 14 working days; fee RM50." },
  { id: "payment", question: "Payment methods", keywords: ["pay", "payment", "card", "cash", "insurance", "duitnow", "e-wallet", "bayar"], answer: "Pay at the Billing & Insurance Counter, Block A Level 2, Mon–Sat 8:00–20:00. We accept cash, debit and credit cards, DuitNow QR and e-wallets. Insurance guarantee letters are handled at the same counter." },
  { id: "admission", question: "Admission to a ward", keywords: ["admission", "admit", "warded", "inpatient", "masuk wad"], answer: "Go to Registration & Admissions in the main lobby, Block A Level 2, with your MyKad or passport, your doctor's admission letter and your insurance card if you have one. A deposit may be needed if you have no guarantee letter." },
  { id: "pharmacy-hours", question: "Pharmacy hours", keywords: ["pharmacy", "farmasi", "medicine", "ubat", "prescription"], answer: "The Pharmacy is in Block A Level 1, open daily 8:00–22:00. Bring your prescription or queue slip. Pharmacists in the Medication Counselling room next door can explain how to use your medicines." },
  { id: "cafeteria", question: "Cafeteria and café", keywords: ["food", "eat", "cafeteria", "canteen", "cafe", "kantin", "makan"], answer: "The cafeteria is in Block A Level 1, open daily 7:00–21:00, serving halal meals. The café in the main lobby, Block A Level 2, sells drinks and snacks from 7:00 to 22:00." },
  { id: "surau", question: "Surau (prayer room)", keywords: ["surau", "prayer", "pray", "solat", "musolla"], answer: "There is a surau in Block A Level 2 beside the lifts, and another in Block C Level 6. Both have separate areas for men and women with ablution facilities, and are open 24 hours." },
  { id: "wifi", question: "Free Wi-Fi", keywords: ["wifi", "wi-fi", "internet"], answer: "Free Wi-Fi covers the whole hospital. Connect to the network \"Hospital-Guest\" and accept the terms on the sign-in page; no password is needed." },
  { id: "lost-found", question: "Lost and found", keywords: ["lost", "found", "missing", "hilang"], answer: "Lost and found is at the Security Office, Block A Level 1, open 24 hours. Items are kept for 30 days; bring your MyKad to collect one." },
  { id: "interpreter", question: "Interpreter services", keywords: ["interpreter", "translator", "language", "bahasa"], answer: "Free interpreters for Malay, Mandarin, Tamil and sign language can be arranged. Ask at the Information Counter in the main lobby, Block A Level 2, or tell your clinic a day before your visit." },
  { id: "wheelchair", question: "Wheelchairs", keywords: ["wheelchair", "kerusi roda", "oku", "disabled"], answer: "Free wheelchairs are at the Wheelchair Station in the main lobby, Block A Level 2, and at the Emergency entrance in Block D. Leave your MyKad with the attendant and return the chair before you leave. Every block has lifts and accessible toilets." },
  { id: "atm", question: "ATMs", keywords: ["atm", "cash", "withdraw", "bank"], answer: "ATMs are in the main lobby on Level 2 of Block A, and outside the cafeteria on Level 1." },
  { id: "restrooms", question: "Toilets", keywords: ["toilet", "restroom", "washroom", "tandas"], answer: "Toilets are on every floor of every block — follow the signs. Accessible toilets are on Levels 1 and 2 of Block A, and baby rooms are on Level 2 beside the lifts." },
  { id: "information-counter", question: "Information Counter", keywords: ["information", "counter", "help", "enquiry", "pertanyaan"], answer: "The Information Counter is in the main lobby beside the main entrance, Block A Level 2, open 24 hours." },
  { id: "patient-affairs", question: "Complaints and compliments", keywords: ["complaint", "compliment", "feedback", "aduan"], answer: "Patient Affairs in Block A Level 1 handles complaints, compliments and enquiries, Mon–Fri 8:00–17:00. You can also leave feedback at this kiosk under Patient Survey." },
];

export const HEALTH_ANSWERS: HospitalTopic[] = [
  { id: "fever", question: "Fever", keywords: ["fever", "temperature", "demam"], answer: "Rest, drink plenty of fluids and take paracetamol as directed. See a doctor if the fever lasts more than 3 days or is above 39 °C." },
  { id: "fasting", question: "Fasting before a blood test", keywords: ["fast", "fasting", "before blood test"], answer: "Most fasting tests need 8–12 hours without food. Water is allowed. Take your usual medicines unless your doctor says otherwise." },
  { id: "blood-pressure", question: "High blood pressure", keywords: ["blood pressure", "hypertension", "bp"], answer: "Reduce salt, stay active and take your medicines every day. Check your blood pressure regularly and keep your clinic follow-ups." },
  { id: "diabetes", question: "Diabetes care", keywords: ["diabetes", "sugar", "glucose"], answer: "Eat regular balanced meals, take your medicines as prescribed and check your sugar as advised. Attend your HbA1c test every 3–6 months." },
  { id: "flu", question: "Colds and flu", keywords: ["flu", "cold", "cough", "selesema", "batuk"], answer: "Rest, drink plenty of fluids and cover your coughs and sneezes. Wash your hands often and wear a mask around other people. See a doctor if you find it hard to breathe, the fever lasts more than 3 days, or you get worse after starting to feel better." },
  { id: "dengue", question: "Dengue warning signs", keywords: ["dengue", "denggi", "mosquito", "aedes"], answer: "Dengue often starts with a sudden high fever, headache, pain behind the eyes and body aches. Go to a doctor or the Emergency Department straight away if you have stomach pain, keep vomiting, bleed from the gums or nose, or feel very tired or restless — these often appear as the fever goes down. Drink plenty of fluids." },
  { id: "healthy-eating", question: "Healthy eating", keywords: ["diet", "healthy", "food", "makan", "sihat"], answer: "Use the Malaysian Healthy Plate: fill half your plate with vegetables and fruit, a quarter with rice or other grains, and a quarter with fish, chicken, eggs or beans. Choose plain water over sweet drinks and cut down on salt, sugar and fried food." },
  { id: "exercise", question: "Staying active", keywords: ["exercise", "active", "senaman", "walking"], answer: "Adults should aim for at least 150 minutes of moderate activity a week, such as brisk walking, plus muscle-strengthening activities on 2 days. Start slowly if you are not used to exercise, and check with your doctor first if you have a long-term condition." },
  { id: "vaccines", question: "Vaccinations", keywords: ["vaccine", "vaccination", "vaksin", "immunisation", "jab"], answer: "Vaccines protect you and the people around you. Children follow the national immunisation schedule; adults may need vaccines such as influenza, pneumococcal, hepatitis B or tetanus depending on age and health. Bring your vaccination card and ask your doctor which ones you need." },
  { id: "quit-smoking", question: "Quitting smoking", keywords: ["smoking", "rokok", "cigarette", "vape", "quit"], answer: "Quitting at any age is good for your heart and lungs, and support makes it easier. Ask your doctor or pharmacist about a quit-smoking clinic (mQuit), counselling and stop-smoking aids. Avoiding triggers and telling family and friends can also help." },
  { id: "mental-health", question: "Mental health support", keywords: ["mental", "stress", "anxiety", "depression", "sad"], answer: "Feeling stressed, anxious or low is common, and help is available. Talk to someone you trust or to your doctor. In Malaysia you can call Talian HEAL 15555 (Ministry of Health) or Befrienders KL at 03-7627 2929 (24 hours)." },
];

/** Symptoms that end any conversation with an emergency referral. */
export const RED_FLAGS = ["chest pain", "can't breathe", "cannot breathe", "difficulty breathing", "stroke", "unconscious", "severe bleeding", "suicide", "seizure"];

export const EMERGENCY_DIRECTIONS = "Go to the Emergency Department in Block D now, or call 999.";

export const EMERGENCY_NOTICE = `This may be an emergency. ${EMERGENCY_DIRECTIONS}`;

export const HEALTH_DISCLAIMER =
  "This is general information, not medical advice. Please speak to a doctor or pharmacist about your own condition.";

export function department(id: string): Department | undefined {
  return DEPARTMENTS.find((d) => d.id === id);
}

const NAME_TITLES = new Set(["dr", "doctor", "doktor"]);

const nameWords = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word && !NAME_TITLES.has(word));

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/**
 * The doctors a name said aloud could mean: "Dr Lim", "lim wei jie", or one speech recognition
 * got a letter wrong ("Dr Aishah"). A word that matches outright outranks a near one, so "Dr Wei"
 * is Dr. Lim Wei Jie rather than Dr. Tan Mei Ling; a tie returns everyone in it, to be asked about.
 */
export function doctorsCalled(said: string): Doctor[] {
  const asked = nameWords(said);
  const score = (doctor: Doctor) => {
    const words = nameWords(doctor.name);
    return asked.reduce((total, word) => {
      if (words.includes(word)) return total + 2;
      const near = words.some(
        (w) => (word.length >= 3 && w.startsWith(word)) || (Math.min(word.length, w.length) >= 3 && editDistance(word, w) <= 1),
      );
      return total + (near ? 1 : 0);
    }, 0);
  };
  const scored = DOCTORS.map((doctor) => ({ doctor, score: score(doctor) }));
  const best = Math.max(0, ...scored.map((s) => s.score));
  return best === 0 ? [] : scored.filter((s) => s.score === best).map((s) => s.doctor);
}

export function ward(id: string): Ward | undefined {
  return WARDS.find((w) => w.id === id);
}

export function departmentLocation(id: string): string {
  const d = department(id);
  return d ? `${d.name}, ${d.building} ${d.floor}` : "";
}

export function payer(id: string): Payer | undefined {
  return PAYERS.find((p) => p.id === id);
}

export function searchCatalog<T extends { keywords: string[]; name?: string; question?: string }>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const score = (item: T) => {
    const label = (item.name ?? item.question ?? "").toLowerCase();
    let s = label.includes(q) ? 3 : 0;
    for (const k of item.keywords) if (q.includes(k) || k.includes(q)) s += 2;
    return s;
  };
  return items
    .map((item) => ({ item, s: score(item) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item);
}

export function hasRedFlag(text: string): boolean {
  const t = text.toLowerCase();
  return RED_FLAGS.some((flag) => t.includes(flag));
}
