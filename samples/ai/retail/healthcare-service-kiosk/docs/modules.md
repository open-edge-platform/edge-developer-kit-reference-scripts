# 🧩 Kiosk Modules

The hospital kiosk is built from parts — 19 services, the assistant, the MCP server and the
shared pieces some services need. Any part can be **switched off** in `config.yaml` (no code
change, no rebuild) or **taken out of the code** with one command, and the rest of the kiosk
keeps working. The staff pages — settings and the registration desk — are in every kiosk.
Code paths are relative to `healthcare-service-kiosk/frontend/`.

- [The parts](#the-parts)
- [Switching parts off](#switching-parts-off)
- [Taking parts out of the code](#taking-parts-out-of-the-code)
- [Staff pages](#staff-pages)
- [What every kiosk keeps](#what-every-kiosk-keeps)
- [How the parts plug in](#how-the-parts-plug-in)
- [Adding a part](#adding-a-part)
- [Tests](#tests)

---

## The parts

Run `npm run modules` to see them, and whether this terminal's `config.yaml` runs them.

**Features** have a switch of their own:

| id | Part | Needs |
|---|---|---|
| `chat` | Assistant: the chat and voice kiosk, its avatar and speech-to-text | `mcp` |
| `mcp` | MCP server at `/api/mcp`: the services as tool calls, for the assistant and outside agents | — |

**Services** are one folder each under `src/packs/malaysia/services/<category>/<group>/<service>/`:

| Category | Service | id | Needs |
|---|---|---|---|
| Patient Registration | Create Patient Record | `register` | — |
| | Patient Verification | `verify` | `queue` |
| | Eligibility Check | `insurance` | — |
| Appointments | New Specialist Visit | `book` | `booking` |
| | Follow-up Visit | `followup` | `booking` |
| | Same-Day Check-In | `checkin` | `queue` |
| Clinical Information | Medication Lookup | `meds` | — |
| | Refill Request | `refill` | — |
| | Lab Test Pricing | `labprice` | — |
| | Lab Results | `labresults` | — |
| Financial Services | Estimate Procedure Cost | `estimate` | — |
| | Outstanding Balance | `bill` | — |
| Navigation & Help | Indoor Navigation | `directions` | `wayfinding` |
| | Way to My Appointment | `myappointment` | `directions` |
| | Service Discovery | `hospitalinfo` | `knowledge` |
| | Find a Doctor | `doctors` | — |
| Diagnostics | Referral Validation | `referral` | — |
| | Medical Document Intake | `records` | — |
| Patient Support | General Q&A | `healthqa` | `knowledge` |
| | Patient Survey | `feedback` | — |

**Shared parts** have no switch: each runs while a service that needs it runs, and is removed
with the last one.

| id | Part | Used by |
|---|---|---|
| `wayfinding` | Hospital map, routing engine, 2D/3D route views, the home screen's Find your way (and `three`) | `directions` |
| `queue` | Queue numbers per clinic and for the registration counter, the live ticket, the `/queue` waiting-area board | `checkin`, `verify` |
| `booking` | Slot picker, the slot re-check at filing, the signed appointment slip | `book`, `followup` |
| `knowledge` | Retrieval over the hospital guide, grounded model answers, red-flag checks | `hospitalinfo`, `healthqa` |

Some screens offer another service when it is there, and drop the offer when it is not — none
of these is a dependency: Find a Doctor's *Show me the way* (`directions`) and its date buttons
(`book`); the check-in ticket's route button, and its map in chat; Way to My Appointment's
*Check in first* (`checkin`); a Q&A answer's route; the signed-in **For you**
tasks (`checkin`, `myappointment`, `bill`, `labresults`, `refill`, `followup`, `insurance`); the assistant's quick
chips; and a scanned slip at sign-in going straight to `checkin`.

## Switching parts off

In `config.yaml` (or `config.local.yaml`), then restart the kiosk:

```yaml
modules:
  disabled: [chat, feedback]                      # switch these off
  only: [checkin, directions, doctors, bill]      # or run just these, and what they need
```

Or at **/settings → Modules**: a box per service and feature, what each needs, and whether it
runs once that is taken into account. Save, then **Restart kiosk**.

| A part that is off | What changes |
|---|---|
| A service | Gone from the touch menu, the assistant's chips and briefing, the MCP tools and the For you tasks; its own API routes answer `404` |
| `chat` | The terminal runs touch only and the mode toggle disappears; `/api/chat` answers `404` |
| `mcp` | `/api/mcp` answers `404`, and the assistant goes with it |
| A shared part | Off with the last service that needs it, or by naming it in `disabled` — which switches those services off too |

- **No rebuild.** The switch is a browser-visible setting served with the page, like
  `terminal.mode`, so a restart applies it.
- **AI services follow.** Only Referral Validation, Medical Document Intake and Eligibility Check
  read paperwork. With all three off, an unreachable OCR or LLM worker no longer takes the kiosk
  out of service.
- **What is running now:** `GET /api/modules` returns `{ "<id>": true | false }` for every part.
- **Typos** are reported: `npm run modules` and the settings page both list ids that are not
  parts of this kiosk.

## Taking parts out of the code

```bash
npm run modules                           # every part, and whether config.yaml runs it
npm run modules -- describe wayfinding    # its files, packages and links
npm run modules -- remove chat feedback   # delete them from the code
npm run modules -- keep checkin directions doctors bill   # delete everything else
npm run modules -- check --deep           # prove each part can be removed on its own
```

`remove` and `keep` print the plan and ask before deleting anything (`--yes` skips the question,
`--dry-run` stops at the plan). They:

- remove what needs a removed part (`remove mcp` takes `chat`; `remove wayfinding` takes Indoor
  Navigation), and the shared parts nothing left needs;
- delete the files, and the category and group folders left empty;
- drop the part's `package.json` scripts, and print the `npm uninstall` line for packages
  nothing else imports;
- take the ids out of `modules.disabled` / `modules.only` in every settings file;
- clear Next's generated route types (`.next/types`), then type-check what is left.

Everything deleted is in git: `git checkout -- .` inside `healthcare-service-kiosk/frontend` brings it back.
`check --deep` copies the tree once per part, removes that part alone and type-checks the copy
— about a minute and a half for all 25.

A service can also go by hand: delete its folder. Nothing registers it anywhere else. If the
manifest lists it, delete that entry too; `npm run modules -- check` says when the manifest and
the tree disagree.

## Staff pages

These are part of every kiosk and are never removed. A patient cannot reach them: nothing on the
patient screens links to them, and each one asks for the CMS admin login.

| Address | What |
|---|---|
| `/staff` | Every staff page in one list, and which parts this terminal runs |
| `/enroll` | Registration desk: register a patient with their date of birth, portrait and card, or give a registered patient a card or portrait |
| `/settings` | This terminal's `config.yaml`: modules, AI services, peripherals; **Restart kiosk** applies it |
| `/mock-documents` | Test documents and codes for a registered patient — a genuine set and a tampered set, as PDFs or a zip — and the buttons that present them to this kiosk's simulated card reader, barcode scanner and document scanner |
| `/outbox` | The texts, emails and clinic notes the kiosk sent (`notify.driver`) |
| `/admin` | The CMS: patients, cases, payments, admin accounts |
| `/queue` | The waiting-area board — public, for a display; there while Same-Day Check-In is on |

In the desktop shell, **F9** or five taps in the top-right corner open the staff menu.

**Registering a patient** at `/enroll` records their name, IC or passport number, date of birth,
sex, contact details, address, known allergies and an emergency contact, and can bind a card and
a portrait in the same pass. The desk then shows the patient's MRN with a printable patient card.
That date of birth is the one the kiosk asks for after a patient card, slip or typed MRN; the
seeded demo patients keep a date of birth derived from their registry key.

## What every kiosk keeps

- Identity: MyKad or passport on the card reader with the face check; patient card, slip or typed
  MRN with the date of birth.
- Consent, document capture with the OCR and model check, payment, and receipts.
- Sign-in once per visit, the **For you** row, My Requests and Save & Exit.
- The accessibility menu, read-aloud, the emergency banner, the idle restart, light and dark.
- The mock hospital records (`src/hospital/data.ts`, `records.ts`) with the kiosk's own filings
  applied (`src/app/api/_lib/ledger.ts`), the patient registry (CMS), `/api/health` and the staff
  pages.
- Messages to patients and clinics (`src/app/api/_lib/notify.ts`, `/outbox`).

## How the parts plug in

- **A service folder is its whole registration.** The catalog finds `category.ts`, `group.ts`
  and `service.ts`, the touch kiosk finds `steps/*.tsx`, and the server finds `chain.ts` (the
  assistant's planner, plus the fee, filing and escalation hooks) and `read.ts` (document readers,
  exported as `readers`), all by file name (`src/packs/malaysia/{catalog.ts,steps.tsx,server.ts}`).
- **Step overrides.** A service's `steps/<step>.tsx` replaces the shared step of that name for that
  service. Check-In's and Patient Verification's `steps/receipt.tsx` show the queue ticket; the
  booking services' receipts show the slip; Create Patient Record's shows the patient card; Lab
  Results' `steps/result.tsx` adds **Email me a copy**. The shared `Receipt`, `Result` and
  `Payment` components take what a service passes in.
- **Chat takeaways.** A service's `steps/takeaway.tsx` is not a step: the chat draws it under the
  receipt or result card (`packTakeaway` in `src/packs/malaysia/steps.tsx`) — the queue ticket,
  the slip, the patient card, the email button.
- **Slots.** A feature adds to screens it does not own through a `slots.tsx` in its components
  folder (`src/modules/slots.ts`): the assistant adds its terminal mode, wayfinding adds the
  home screen's Find your way panel and the chat map card. A deleted or switched-off part simply
  fills no slot.
- **The manifest** (`src/modules/manifest.ts`) names the features and shared parts, the files
  each owns, what each needs, and the services that need more than their folder.
- **The switch** (`src/modules/state.ts`, logic in `graph.ts`) filters the catalog the kiosk, the
  assistant and the MCP server all read, and `moduleOff("<id>")` (`src/app/api/_lib/modules.ts`)
  answers a switched-off part's routes with `404`.

## Adding a part

- **A service:** a folder with `service.ts`, plus `steps/`, `chain.ts` and `read.ts` as it needs
  them (the frontend README's *Adding, changing or removing a service*). Add a manifest entry only
  if it needs a shared part or owns files outside its folder.
- **A feature or shared part:** a manifest entry with its `paths`, `requires`, `packages` and
  `scripts`. Guard its API routes with `moduleOff("<id>")`, reach other screens through a slot
  rather than an import, and run `npm run modules -- check --deep`.

## Tests

The specs ask `/api/modules` and skip what the kiosk under test has switched off. A spec that
belongs to one part — `wayfinding.spec.ts`, `find-a-doctor.spec.ts`, `chat-layout.spec.ts`,
`flow-session.spec.ts`, `mixed-capture.spec.ts` — is deleted with it, because the production
build type-checks `tests/` too.
