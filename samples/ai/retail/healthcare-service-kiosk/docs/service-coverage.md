# ✅ Service Coverage

How each of the 19 services in [service-hierarchy.xlsx](service-hierarchy.xlsx) carries out the
steps the spreadsheet lists, in touch mode and in chat mode. Code paths are relative to
`healthcare-service-kiosk/frontend/`; each service lives in
`src/packs/malaysia/services/<category>/<group>/<service>/`.

- [What stands in for the hospital's systems](#what-stands-in-for-the-hospitals-systems)
- [Patient Registration](#patient-registration)
- [Appointments](#appointments)
- [Clinical Information](#clinical-information)
- [Financial Services](#financial-services)
- [Navigation & Help](#navigation--help)
- [Diagnostics](#diagnostics)
- [Patient Support](#patient-support)
- [Both modes](#both-modes)

---

## What stands in for the hospital's systems

There is no HIS, ERP, scheduler, payment gateway or SMS gateway behind the kiosk. These stand in
for them, so every step runs end to end:

| Spreadsheet says | The kiosk uses |
|---|---|
| HIS / ERP API | `src/hospital/records.ts` derives each patient's record from their ID number. `src/app/api/_lib/ledger.ts` applies what the kiosk filed on top: paid invoices drop off, dispensed refills count down, a booked follow-up is marked done. Contact details given at registration or verification are written to the patient registry (CMS). |
| Scheduler API | Doctors' clinic days and slots in `src/hospital/data.ts`. A slot booked at any kiosk is hidden and re-checked at filing. |
| Payment gateway | A simulated card, QR or cash terminal (`src/app/api/payments`). |
| SMS / email | `src/app/api/_lib/notify.ts`. `notify.driver: outbox` keeps each message for staff at `/outbox`; `webhook` posts it as JSON to `notify.webhook_url` for a real gateway. |
| ID scan, OCR, LLM | The card reader (or its stand-in), the document scanner (or generated mock paperwork), the OCR worker and the model, all live. See [patient-journey.md](patient-journey.md#test-documents-and-simulated-peripherals). |

## Patient Registration

**Create Patient Record** (`register`)

| Step | How |
|---|---|
| Welcome → Consent | The consent step (touch); the agreement is filed with the case as `consentAt`. Chat tells the patient that tapping their MyKad means agreeing, and records it when the record is created. |
| Scan ID/Passport | The patient taps their MyKad at the enroll step, which stands where the identity step would: they have no record to identify against yet. The chat's card watch hands the card it saw to that read, so a quick tap counts. No MyKad, or a passport, goes to the registration counter. |
| OCR extract demographic data | The name, IC number, date of birth, sex, nationality and address the MyKad chip carries. The kiosk only reads the card's serial, so `mykad-chip.ts` simulates the rest from it: the same card always reads as the same person. The patient confirms the read-back (IC number masked to its last four digits); **No, something is wrong** sends them to the registration counter. |
| Face capture | The camera takes the record photo; one the face detector can't find exactly one face in is taken again. With no camera the record is made without one, and the case goes to the counter to take it. |
| Validate duplicate patient | A card that already opens a record, or an IC number already registered, is refused before anything is read back. Another record with the same name and date of birth under a different ID sends the case to the counter. |
| Create MRN in HIS/ERP | The citizen record, created with the card's serial (when it is a real card) and the photo (`src/app/api/_lib/self-enrollment.ts`), so tapping that MyKad signs the patient in next time and the face check has a portrait to match. The MRN is filed with the case; the phone number, language and emergency contact asked next are written to the record. |
| Print patient card/token | A Code 128 patient card on screen and in the chat (**Print** prints only the card). Withheld while the counter still has a check to make. |

**Patient Verification** (`verify`)

| Step | How |
|---|---|
| Scan MyKad/ID → Retrieve record | MyKad, passport, patient card, appointment slip or typed MRN. |
| Face verification | Face match for a card; date of birth for a code or typed MRN. |
| Confirm demographics | MRN, name, ID (masked), date of birth, phone and address, then *still correct?* A new phone number is written to the record. |
| Check eligibility/status | Insurance on file (active, expired or none), an outstanding balance, and an appointment today. |
| Issue queue token | A number for Registration & Admissions (`R001`…) on the same live ticket and `/queue` board as the clinics. |
| Verified Patient Session | Touch keeps the patient signed in for 10 minutes; chat carries the sign-in to the next service through **Something else**. |

**Eligibility Check** (`insurance`)

| Step | How |
|---|---|
| Scan insurance card → OCR policy | Payer, member ID, policy number, holder, IC and expiry read by rule, the model filling gaps. Without the card, the patient picks the insurer. |
| Validate payer eligibility | On the hospital's panel, the holder's name and IC, the card's expiry, and the policy on the hospital's record (lapsed or limit used up → the counter). |
| Display coverage and co-pay | The panel's coverage and the patient's co-pay (%), and the annual limit left when the policy is on record. |

## Appointments

**New Specialist Visit** (`book`)

| Step | How |
|---|---|
| Identify patient | The identity step, or the sign-in. |
| Select department → Check doctor schedules → Show slots | Department, doctor (languages and clinic days), then free slots. Slots already booked are not offered. |
| Confirm booking | A summary to confirm in touch; *Book … on … at …?* in chat. |
| SMS/Email confirmation | A text and an email through `notify` (to the outbox, or the gateway); the receipt says where they went. |
| Appointment | A signed, barcoded appointment slip, scanned on the day to check in. One open booking per clinic. |

**Follow-up Visit** (`followup`)

| Step | How |
|---|---|
| Retrieve doctor recommendation | The recommendation on the record: clinic, doctor and weeks. |
| Suggest follow-up dates → Book slot | Free slots from a week before the recommended date; confirm, then book. |
| Update HIS | The ledger marks the recommendation booked, so the kiosk then says when it is instead of offering it again. Confirmation by SMS and email, and a slip. |

**Same-Day Check-In** (`checkin`)

| Step | How |
|---|---|
| Scan ID | Any identity method; a scanned slip preselects its visit. |
| Retrieve appointment | The scheduled visit and anything booked at a kiosk for today, one check-in per appointment. |
| Check-in | Two pre-visit questions; early or late arrival is noted. |
| Generate queue number | Issued at filing, one series per clinic per day, never reused. |
| Notify clinic | A note to the clinic's channel through `notify` (number, appointment, pre-visit flags), and a flag on the `/queue` board. |
| Queue Ticket | Live position and wait, the way to the clinic, and a QR for the phone — in chat too, where the map to the clinic comes up under the ticket. |

## Clinical Information

**Medication Lookup** (`meds`): each prescription's dosage, duration, price, refills left and last
fill, from the live record.

**Refill Request** (`refill`)

| Step | How |
|---|---|
| Validate refill eligibility | Refills left, and three quarters of the last supply used; a prescription not yet due says from when. |
| Submit refill request | Filed for the pharmacy; the collection point, and an SMS that it is being prepared. The refill counts down on the record. |
| Payment if needed | Billed to the insurer when an active policy on record covers it; otherwise paid at the kiosk, with no kiosk fee on top. |

**Lab Test Pricing** (`labprice`): the test asked for by name, synonym or with a typo
(`lab-price.ts`), or by the model when the words match no test (`lab-search.ts`, `/api/lab-tests`);
then price, preparation, turnaround and where.

**Lab Results** (`labresults`): the results, each explained in plain words by the model under
strict checks (a fixed template when it fails them), with **Print** (the explanations included)
and **Email me a copy** in both modes.

## Financial Services

**Estimate Procedure Cost** (`estimate`): the procedure by name or words, the standard charges
line by line, then the insurer's share and the co-pay.

**Outstanding Balance** (`bill`): the unpaid invoices and their total, **Pay now** or **Not now**.
Paying files a completed case, clears the invoices from the record and emails a receipt.

## Navigation & Help

**Indoor Navigation** (`directions`): spoken, typed or tapped destination; the 2D/3D map with
turn-by-turn steps; the steps as a QR for the phone, on the route screen and on the chat's map card.
"My appointment" or "my doctor" as a destination points the patient to Way to My Appointment.

**Way to My Appointment** (`myappointment`, an addition to the spreadsheet): the patient
identifies, the kiosk finds today's visits (asking which one when there are several), and the
route ends at that doctor's clinic: the route screen in touch mode, the map card in chat. It
says whether they have checked in yet, and touch mode offers **Check in first**. Nothing is filed.

**Service Discovery** (`hospitalinfo`): retrieval over the hospital guide — every department's
place, hours, services and what to bring, and an overview of the hospital and the kiosk — reworded
by the model only from what it retrieved.

**Find a Doctor** (`doctors`): by specialty or name; languages (every language a doctor
speaks); clinic days and the next free slots.

## Diagnostics

**Referral Validation** (`referral`): OCR, then the patient, IC, referring doctor, MMC number,
clinic, date (valid for 6 months) and clinic referred to. A missing or unusual MMC number, an old
or future date, or another person's letter goes to staff review; warnings are said in chat too.

**Medical Document Intake** (`records`): a scan, PDF or photo (JPG, PNG); the kind of document
recognised from its text and confirmed by the patient; filed against the patient with a
`DocumentReference` that names the stored copy. Several intakes may be open at once.

## Patient Support

**General Q&A** (`healthqa`): red flags first, then the trusted health guide, reworded by the
model under checks, always with the disclaimer. Spoken in chat mode (speech-to-text and
text-to-speech); typed in touch mode.

**Patient Survey** (`feedback`): rating, area and a comment (always offered); sentiment by rules
and the model; poor, urgent or safety feedback becomes a follow-up ticket for staff.

## Both modes

- **Chat mode** runs every service through the same flow engine as the MCP tools, so its steps
  and rules are the touch kiosk's. Information services need no identity. A filed case shows its
  receipt with the takeaway — queue ticket, slip or patient card — and a finished look-up shows
  its result card.
- **Still simulated, by design:** the hospital record is derived rather than read from a HIS, the
  MRN is derived from the ID number, payment is a simulated terminal, and messages reach a real
  phone or inbox only through `notify.webhook_url`. Physical printing uses the browser dialog.
  See [patient-journey.md](patient-journey.md#not-done-yet).
