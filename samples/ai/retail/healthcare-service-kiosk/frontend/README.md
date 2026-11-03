# Hospital Concierge Kiosk

Self-service hospital kiosk built with Next.js, shadcn/ui and TanStack Query.
Every service walks a chain of steps:

**Welcome → Service → Consent → Verify → Details → (service-specific steps) → Documents → Payment → Receipt**

## Getting started

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001).

## Configuration

Every setting the kiosk has lives in `config.yaml` — terminal mode, the AI
service URLs, voice, document capture, mock timings and the CMS credentials —
each one documented beside the value it sets. Edit it and restart `npm run dev`.

That file is **per-install and gitignored**: the launcher scripts copy it out of
[`configs/`](configs/README.md) on the first run (`./setup.sh --profile <name>`,
default `reference`) and generate its admin password there, so no credential is
ever committed. Until one exists the app reads
[`configs/reference.yaml`](configs/reference.yaml), which is the documented
reference — the file to read when you want to know what a setting does.

The other profiles are ready-to-run presets, selectable without replacing your
`config.yaml`:

```bash
KIOSK_CONFIG_FILE=configs/simulated.yaml npm run dev  # no hardware or AI workers
KIOSK_CONFIG_FILE=configs/hardware.yaml npm run dev   # strict physical kiosk
```

The selected profile looks for its machine-specific override beside it (for
example, `configs/config.local.yaml`).

A setting that is commented out is not set: the default named in the comment
applies, and for the optional services (LLM, OCR, speech) an unset `base_url`
switches that capability off entirely.

Changes you don't want to commit go in `config.local.yaml` next to it — it is
git-ignored and layered over `config.yaml` setting by setting, so it only needs
the lines you're changing. Environment variables still win over both, which is
how CI and one-off runs override things:

```bash
KIOSK_LLM_MOCK=true npm run dev     # this run only, no file edited
```

The `prompts:` section at the end is the AI half of it: all eight system
prompts the kiosk sends — the chat agent's brief (multi- and single-turn), the
four document prompts, the transcript repair and the language detection —
are printed there as they ship, ready to be uncommented and rewritten.
`{{services}}` in a prompt is filled from the live service catalog, and
`{{calendar}}` with today's date and the next two weeks.

`src/lib/kiosk-config.ts` maps the YAML tree onto the flat `KIOSK_*` variables
the code reads, and `src/app/api/_lib/prompts.ts` holds the default prompt
text, so adding a setting means adding it there and to `config.yaml`.

## Peripheral drivers

Running against the real hardware needs the proper drivers installed — without
them every device is silently simulated (or, with `simulate: never`, refused):

- **NFC card scanning** needs the PC/SC stack: `libpcsclite1` + the `pcscd`
  daemon (plus `pcsc-tools` for `pcsc_scan`). The kiosk's
  [pcsc-mini](https://npmjs.com/package/pcsc-mini) bindings talk to that
  daemon — no daemon, no reads. See
  [ID card reader](#id-card-reader-pcsc--nfc).
- **The fi-800R document scanner** needs SANE's `scanimage` (`sane-utils`)
  **plus PFU's proprietary `pfufs` backend** — the fi Series Linux driver.
  The generic SANE backends do not drive the fi-800R the way the kiosk uses
  it (`Adf-duplex`, `--page-auto`, multifeed detection), and the
  `pfufsgetscstatus` paper-detect tool the kiosk polls before every scan
  ships only with that driver. It is a licensed download from
  [PFU's support site](https://www.pfu.ricoh.com/global/scanners/fi/support/software/)
  (driver guide: `P2U3-0200-08ENZ0.pdf`).
- **OCR** needs `poppler-utils` (`pdftoppm`) to rasterize captured PDFs.
- **The webcam** needs no driver package — it is a standard UVC device read
  in the browser via `getUserMedia`.

One script installs all of it (Debian/Ubuntu, uses sudo):

```bash
npm run drivers:install                 # = scripts/install-drivers.sh
```

It installs the apt packages, enables `pcscd`, and installs the `pfufs`
driver from a `pfufs*.deb` you have downloaded (pass
`--pfufs-deb <path>`, or drop it in the repo root or `~/Downloads`) — the
PFU download requires a license click-through, so the script cannot fetch it
itself. It ends by reporting what actually answers: `pcscd` running,
`scanimage -L` seeing the scanner, `pfufsgetscstatus` on `PATH`.
`./setup.sh --hardware` at the repo root runs the same script.

## Architecture

```
src/
├── packs/                           Country packs — everything country-shaped
│   ├── types.ts                     CountryPack contract
│   ├── index.ts                     Pack registry + activePack() (NEXT_PUBLIC_KIOSK_PACK)
│   ├── index.server.ts              Server-only: chainFor / readerFor over the active pack
│   └── malaysia/                    The shipped pack
│       ├── pack.ts                  Locale, countries, ID documents, prompt vars
│       ├── messages.ts              Message catalog (canonical key set for all packs)
│       ├── speech.ts                STT vocabulary + transcript-repair examples
│       ├── catalog.ts / steps.tsx   Folder discovery over this pack's services/
│       ├── server.ts                Server-only discovery: each service's chain.ts and read.ts
│       └── services/                Level 1 / 2 / 3 catalog (see ../docs/service-hierarchy.xlsx)
│           └── <level-1>/           e.g. appointments/
│               ├── category.ts        exports `category` (label, icon, order)
│               └── <level-2>/       e.g. book-appointment/
│                   ├── group.ts       exports `group` (label, order)
│                   └── <level-3>/   e.g. new-specialist-visit/
│                       ├── service.ts   exports `service` (fee, documents, flow, fields…)
│                       ├── chain.ts     the guided-flow planner + fee/filing hooks (server-only)
│                       ├── read.ts      document readers, exported as `readers` (optional)
│                       └── steps/       service-specific steps, e.g. application.tsx
├── modules/                         The parts: manifest, the config.yaml switch, slots
│                                    (see ../docs/modules.md)
├── services/                        Shared service machinery (country-neutral)
│   ├── shared/                      Everything services reuse
│   │   ├── steps/                   Shared flow steps: service, consent, identity,
│   │   │                            documents, payment, receipt, result
│   │   ├── fields.tsx               Form kit for custom steps (TextField, OptionCards)
│   │   ├── step-shell.tsx           Common step layout
│   │   ├── step-props.ts            The one props contract every step receives
│   │   └── flow.ts                  STANDARD_FLOW + shared document requirements
│   ├── catalog.ts                   Shim: the active pack's catalog
│   ├── registry.tsx                 Shim: shared steps + the active pack's overrides
│   └── types.ts                     ServiceDefinition, FieldSpec, DocumentRequirement…
├── components/
│   ├── kiosk/                       App shell (welcome, header, stepper, footer,
│   │                                flow runner) + generic primitives
│   │                                (TapCard, IconTile, CtaButton)
│   ├── staff/                       Staff pages: hub (/staff), registration desk
│   │                                (/enroll), settings and modules (/settings),
│   │                                mock documents (/mock-documents)
│   └── ui/                          shadcn/ui components
├── hooks/                           use-kiosk-flow (session state machine),
│                                    use-kiosk-api (TanStack Query hooks), use-clock
├── lib/
│   ├── api/                         Typed client for the kiosk API (base URL from config.yaml)
│   ├── i18n.ts                      t() over the active pack's message catalog
│   ├── countries.ts                 The active pack's country list
│   ├── id-reader.ts                 Tap-or-insert copy for the ID reader this kiosk has
│   └── format.ts                    Money / date formatting (locales from config)
├── payload/                         Payload CMS: collections (citizens, applications,
│   │                                payments, requests, users, face photos), CSV seeding
│   └── payload.config.ts
└── app/
    ├── api/                         Kiosk API: catalog, identity, documents, fees,
    │   │                            payments, applications, chat, speech, MCP
    │   ├── _lib/cms.ts              REST proxy to Payload (never the Local API)
    │   ├── _lib/nfc.ts              PC/SC ID card reader (serial in, citizen out)
    │   └── staff/                   Registration-desk writes, behind the admin session
    ├── (kiosk)/                     The patient kiosk (/), the queue board (/queue)
    │                                and the staff pages: /staff, /enroll, /settings,
    │                                /mock-documents
    └── (payload)/                   /admin panel + /cms-api REST catch-all
```

## Patient registry (Payload CMS + SQLite)

The kiosk is backed by a synthetic patient registry managed by
[Payload CMS](https://payloadcms.com) and persisted in `db.sqlite`. On first
run the database is created and seeded automatically from
`data/citizens.csv` (100 synthetic patients; 50 MyKad holders, 50 passport
holders). No reference portraits are seeded — drop your own into
`data/faces/` to change that (see
[Face verification](#face-verification-identity-step)).

- **Admin panel** — [http://127.0.0.1:3001/admin](http://127.0.0.1:3001/admin),
  seeded login `admin@demo.local` and the password in `cms.admin_password`,
  generated by the launcher on the first run (override via
  `PAYLOAD_ADMIN_EMAIL` / `PAYLOAD_ADMIN_PASSWORD`). Face reference portraits
  are uploaded and reassigned from here — see
  [Managing portraits from the CMS dashboard](#managing-portraits-from-the-cms-dashboard).
- **Registration desk** — [http://127.0.0.1:3001/enroll](http://127.0.0.1:3001/enroll),
  linked from the admin nav. Registering somebody with their photograph and
  their card in one pass, rather than across three CMS screens — see
  [Registration desk](#registration-desk-enroll).
- **Settings page** — [http://127.0.0.1:3001/settings](http://127.0.0.1:3001/settings),
  linked from the admin nav. This terminal's `config.yaml` as a form (and as
  the file itself), with a restart button that makes a save count — see
  [docs/configuration.md](../../common/docs/configuration.md#the-settings-page).
- **REST API** — served under `/cms-api/*` (kept off `/api/*` so it never
  collides with the kiosk routes). Non-admin requests must send the
  `x-kiosk-key` header (`KIOSK_CMS_KEY`, default `dev-kiosk-key`).
- **In-process access** — the kiosk API routes in `src/app/api/` talk to
  Payload through its Local API via `src/app/api/_lib/cms.ts`; the CMS always
  runs on the kiosk itself. The REST API exists for the admin UI and for
  external callers (tests, scripts) bearing the kiosk key. Remote
  dependencies (LLM, speech, OCR, face) are separate services, each with its
  own `base_url`/`api_key` config.
- **Reset** — `npm run db:reset` deletes `db.sqlite`; the next request
  re-creates and re-seeds it. Pin the mock ID reader to one patient with
  `KIOSK_READER_CITIZEN` (patient ID or CitizenKey), otherwise each session
  draws a random one.

How the registry drives the services:

| Service | Registry behaviour |
| --- | --- |
| Patient verification | Reader reports a real patient's IC/passport; the camera frame is matched against the portrait on their record, and verify returns their registry profile |
| Insurance eligibility check | Looks up the patient's active policy; coverage, co-pay and remaining annual limit come from the registry |
| Outstanding balance | Looks up open invoices by patient; the fee **is** the outstanding balance; paying marks them settled |
| Book appointment | Checks the doctor's schedule and existing bookings before confirming a slot |
| Refill request | Goes `on_hold` while the prescription has no refills left or has expired |
| All services | Applications & payments are persisted with a relationship to the patient |

### Demo reset

To demo one patient's visit (sign in, check in, pay), use **Demo reset** in the CMS admin nav
([/demo-visit](http://127.0.0.1:3001/demo-visit)). Pick a patient and press **Set up today's
visit**: it books today's slot if they have none, and clears their last check-in and bill payment
so the visit can be walked again. See
[patient-journey.md](../docs/patient-journey.md#test-documents-and-simulated-peripherals).

## Registration desk (`/enroll`)

Enrolling a patient is two bindings the CMS cannot do from a form field: a
photograph taken with the camera on the desk, and the serial read off the card
in the patient's hand. The registration desk at
[http://127.0.0.1:3001/enroll](http://127.0.0.1:3001/enroll) does both, and is
linked from the admin nav and from the staff hub at `/staff`.

It has two tabs:

- **New patient** — name, IC or passport number, country, **date of birth**,
  sex, phone, email, address, known allergies and an emergency contact, with
  the portrait and the card bound in the same pass. The patient row, the
  uploaded portrait and the card serial are written as one request, so a
  rejected enrollment leaves nothing behind. The desk then shows the patient's
  MRN and a patient card to print. The date of birth is what the kiosk asks
  for after a patient card, slip or typed MRN.
- **Card for an existing patient** — search by name or IC / passport number,
  then give somebody already on the register a card, a portrait, or both. This
  is the common case: the seeded register has a hundred patients and not one
  of them holds a card. It also unbinds a card, which is how a lost one is
  taken out of service.

**The portrait** comes from the desk's webcam ("Take photo", framed in the
same oval the kiosk asks patients to fill) or from a file. Either way it is
uploaded to the `face-photos` collection, so the face detector checks it on
the way in and refuses a picture the kiosk could never match anybody against
— see [Managing portraits](#managing-portraits-from-the-cms-dashboard).

**The card** is read off the reader ("Read card from the reader" waits 20s for
a tap) or typed in from `npm run nfc:probe`. Three serials are refused rather
than stored:

| Refused | Why |
| --- | --- |
| a serial another patient holds | one card opens one record; the desk names who holds it instead |
| a `MOCK…` serial | a stood-in read, not a card — it would bind the patient to a card that does not exist |
| a contact card's ATR | an ATR names a card *model*; every card of that type would open the record |

**Who may use it.** The desk is gated on the CMS admin session — the same
login as `/admin`, checked on the page and again on every route behind it
(`/api/staff/*`). It is not part of the kiosk flow and a patient at the
terminal cannot reach it. Everything it writes is an ordinary registry row,
visible and correctable in the CMS.

## Adding, changing or removing a service

The catalog is discovered from the pack's folder tree — there is no
registration list to edit. A service lives in ONE directory,
`src/packs/<pack>/services/<level-1>/<level-2>/<level-3>/`:

1. `service.ts` exporting a `service: ServiceDefinition` — id, label, fee,
   required documents, the `flow` array chaining shared step ids with any
   custom ones, and `fields` (the application answers it collects, which is
   what the agent briefing is generated from).
2. If the flow contains a custom step id (e.g. `"application"`), add
   `steps/<step-id>.tsx` next to `service.ts`. It default-exports a component
   taking `StepProps`; collect answers with the `shared/fields` kit and finish
   with `actions.stepCompleted("<step-id>", data)`. A custom step file also
   *overrides* a shared step of the same id for that service only — Check-In's
   `steps/receipt.tsx` passes its queue ticket to the shared `Receipt`.
3. If the service has an application step, add `chain.ts` exporting
   `chain: ChainSpec` — the guided-flow planner the chat agent drives over MCP
   (same gates and options as the touch step, expressed as asks), plus any
   `quote` / `file` / `escalate` hooks the touch kiosk shares. It is found by
   name (`src/packs/malaysia/server.ts`).
4. A service that reads fields off a scanned document adds `read.ts` exporting
   `readers`, keyed by the document requirement's id.
5. A service whose case leaves the patient with something to keep (a ticket, a
   slip, a card) adds `steps/takeaway.tsx`, taking `TakeawayProps`: the chat
   draws it under the receipt card. It is not a step of the flow.
6. New Level 1/2 branches just need a `category.ts` / `group.ts` alongside.

Deleting a service folder removes it everywhere. A service that needs a
shared part (the map, the queue, booking, the Q&A knowledge) or owns files
outside its folder has an entry in `src/modules/manifest.ts`;
`npm run modules -- remove <id>` deletes those with it and type-checks what is
left. Flows are per-service: e.g. Outstanding Balance runs `["consent",
"identity", "application", "payment", "receipt"]` — lookup before payment,
no document uploads. Switching a service off without deleting it is
`modules.disabled` in `config.yaml` — see [../docs/modules.md](../docs/modules.md).

## Document uploads

The documents step accepts manual file uploads: each required document card
opens a file picker, and the chosen PDF or photo (JPG, PNG) is sent as
multipart form data to `POST /api/documents`. The route stores a copy in the
uploads folder (`KIOSK_UPLOADS_DIR`, default `../assets/pdf`) — a photo wrapped
into a one-page PDF — reads its metadata (title, pages, size), and returns it to
the kiosk. Files up to `KIOSK_UPLOAD_MAX_BYTES` (default 10 MB) are accepted.

Specimen documents for testing — MyKad or passport copy, referral letter, lab,
imaging and discharge reports, insurance card, patient card and appointment
slip, with fictional data and marked as test fixtures in their PDF metadata —
are drawn in `src/packs/malaysia/mock-documents.mjs`. A simulated scanner
renders the genuine set of whoever verified at the terminal on the spot; staff
can generate any registered patient's genuine and tampered sets at
`/mock-documents`, download them, or present them to the kiosk's simulated
peripherals (see [../docs/patient-journey.md](../docs/patient-journey.md#test-documents-and-simulated-peripherals)).
`npm run mocks:gen` writes sets to `../assets/mocks/citizens` (no patient card
or slip — those need the running kiosk), one folder per person with a `good/`
set and a `false/` set described in its `manifest.json`; a set folder can stand
in as `documents.mocks_dir`.

## Document analysis (OCR + local LLM)

Each uploaded PDF is turned into text and an LLM judges whether the document
satisfies the service's requirement and belongs to the verified patient.

What it is asked to compare is declared per requirement, from the paperwork
that service actually accepts (`DocumentRequirement` in `src/services/types.ts`):

| field | what it says | why it is per-requirement |
| --- | --- | --- |
| `accepts` | the kinds of paperwork that satisfy this step, any ONE of which is the right type | a label listing three alternatives reads as one compound document no scan can be, and every genuine police report is refused for not also being a birth certificate |
| `holderDetails` | which registry details the paperwork prints — name, IC number, or both | a utility bill carries a name and no IC; ask for one it cannot print and the model supplies the value from the prompt, then rules on it |
| `holderRole` | who the patient is on paperwork naming several people | a referral letter names the referring doctor, a birth certificate names the newborn and both parents, an insurance card names the policyholder |
| `addressField` | the flow-data key the printed address is saved under | the address is read off the document, never compared to the registry — and it has to be one the registry does not already hold, or it proves no move (`provesNewAddress`) |

The registered address is never compared on ordinary documents: most print an
issuer's or employer's address or none at all, and a patient who has moved
legitimately carries the old one.

Two cross-checks against the registry are made in code rather than by the
model, because both are string comparisons against data the kiosk already
holds: the ID number printed on a document must be the patient's (a small
model reads MY0627475478 against an expected MY7394142145 and answers that
the details match), and a proof of address must show a home the registry does
not already hold.
Everything runs server-side in the `/api/documents` route handler. The
verdict shows on the document card; a rejected document (wrong type or
another person's details) blocks Continue until it is rescanned, with a
contact-staff option for disputed checks.

Text extraction: every uploaded PDF is rasterized with `pdftoppm` and
OCR'd page by page via the service at `KIOSK_OCR_BASE_URL` (a PaddleOCR
worker, `POST {base}/ocr`); when unset, extraction — and with it the
analysis — is skipped.

With `KIOSK_LLM_MOCK=true` (default) the verdict is simulated from the
text, so no AI service needs to be running; set
`KIOSK_LLM_MOCK_VERDICT=mismatch` to preview the warning UI. To go live,
set `KIOSK_LLM_MOCK=false` and point `KIOSK_LLM_BASE_URL` /
`KIOSK_LLM_MODEL` at any OpenAI-compatible chat-completions server — for
the Edge AI Demo Studio gateway that's
`http://127.0.0.1:8080/api/text-generation@kiosk-llm/v1` with model
`llamacpp:unsloth/gemma-4-E4B-it-GGUF:Q4_K_M`, plus
`KIOSK_LLM_EXTRA_BODY={"chat_template_kwargs":{"enable_thinking":true}}`
— Gemma 4 E4B calls the chat tools reliably only when it thinks first. A
touch build points at Gemini instead (see
[build.md](../../common/docs/build.md#the-build)). `KIOSK_LLM_MOCK=false` with no base URL disables analysis
entirely, and if the LLM or OCR is unavailable at runtime the step behaves
exactly as before.

## ID card reader (PC/SC / NFC)

The first half of the identity check. The patient presents their card to a
PC/SC reader — a contactless pad (ACR122U and friends) or the contact slot on
the same unit — and the kiosk reads the card's **serial number** with the
pseudo-APDU every reader answers:

```
FF CA 00 00 00   ->   <UID bytes> 90 00
```

The bindings are [`pcsc-mini`](https://npmjs.com/package/pcsc-mini), an
optional dependency carrying prebuilt binaries for Linux, macOS and Windows.
On Debian/Ubuntu the daemon it talks to needs installing once:

```bash
sudo apt install libpcsclite1 pcscd
sudo systemctl start pcscd
pcsc_scan                 # from pcsc-tools — proves the reader works
```

(`npm run drivers:install` does this — and the scanner driver — in one go;
see [Peripheral drivers](#peripheral-drivers).)

**The serial is the card, not the patient.** Which patient a piece of plastic
opens is a registry fact, so `src/app/api/_lib/nfc.ts` only ever reports what
was tapped and `citizenForCard` in `src/app/api/_lib/citizens.ts` decides who
that is. A card no record claims is refused rather than resolved into whoever
is handy — the kiosk never gets to decide who is standing in front of it.

Bind a card to a patient either way:

- **In the CMS** — `Citizens` -> **NFC card serial (UID)** in the admin. This
  is what a real install does.
- **In `config.yaml`** — a few under `nfc.cards:`, keyed by serial and valued
  by patient ID or CitizenKey. No admin session, nothing written to the
  registry, which suits a demo kit and a bag of blank cards.

Either way you need the serial, and `npm run nfc:probe` prints it for whatever
card you tap:

```
$ npm run nfc:probe
reader ready: ACS ACR122U PICC Interface 00 00
watching every reader — present a card (Ctrl-C to stop)

  card serial : 04A2B3C4D5E6
  reader      : ACS ACR122U PICC Interface 00 00
  ATR         : 3B8F8001804F0CA000000306030001000000006A
```

While the kiosk is running, `GET /api/identity/card` does the same job over
HTTP — handy on an installed machine, where the terminal you have is a browser
pointed at the kiosk:

```bash
curl 127.0.0.1:3001/api/identity/card              # wait up to 15s for a tap
curl 127.0.0.1:3001/api/identity/card?timeout=0    # what is on the reader now
```

```json
{
  "readers": ["ACS ACR122U PICC Interface 00 00"],
  "card": {
    "uid": "04A2B3C4D5E6",
    "atr": "3B8F8001804F0CA000000306030001000000006A",
    "reader": "ACS ACR122U PICC Interface 00 00",
    "fromAtr": false
  },
  "boundTo": { "citizenKey": 1, "citizenId": "MY3080592042", "name": "Nadia Rahman" }
}
```

`boundTo` is `null` for a card no record claims, with a `bind` line saying
where to put the serial — or bind it without leaving the browser at the
[registration desk](#registration-desk-enroll), which reads the card and
writes the serial to the patient's record in one go. A failed read answers with its `reason` and the
reader's own `detail`, which is the quickest way to tell "no daemon" from "no
reader" from "nobody tapped".

This route is **never** simulated — no reader means an error saying so. That
is the difference between it and `/api/identity/document`, which is the
identity step and stands a patient in when no reader answers; when you are
testing hardware, that fallback is precisely what you are trying to see past.

The chat's card step watches this route with `?handoff=1`: the card it sees is
handed to the identity read that follows (`takeHandedCard` in
`src/app/api/_lib/nfc.ts`). The two are separate requests a second or two
apart, and a contactless tap is over long before the second one — without the
hand-off the patient taps, the screen says it saw the card, and the kiosk waits
for another tap. The watch also keeps listening while the kiosk reads the step
aloud, and confirms once it has finished speaking.

The MyKad chip's own data files are **not** read: those sit behind JPN's
applet and its keys. A kiosk that is not on that key ceremony can honestly
read the serial and look the patient up, which is what this does. Create
Patient Record, which registers someone with no record yet, simulates what the
chip would say instead — name, IC number, address — from the serial
(`mykad-chip.ts` in its service folder), so the same card always reads as the
same person; `GET /api/enroll/card` reads a card that way.

### No reader attached

Which is where this kiosk is today, and where every development machine is.
The read then stands in a registry patient exactly as the mock reader always
did — `mock.identity.citizen` picks who, or a random patient per session — and
the response carries `"simulated": true` with a synthetic `MOCK…` serial so
nothing downstream has to special-case it.

`nfc.simulate` decides how far that goes:

| | |
| --- | --- |
| `auto` (default) | use the reader if there is one; stand a patient in when the bindings, the daemon or the reader are missing |
| `always` | never touch the hardware — the old mock reader, exactly |
| `never` | no stand-in; the patient is told the reader is unavailable |

**Set `never` once the reader is really attached**: with `auto` a dead reader
looks like a working one.

The stand-in is deliberately narrow either way. It covers only the cases where
the read never *ran* — no bindings, no daemon, no reader. A reader that is
there and saw no card (`timeout`), or saw one it could not read
(`read_failed`), is reported to the patient instead: standing a random patient
in for somebody whose card would not read is the one outcome this step exists
to prevent. Same distinction the face check draws, and for the same reason.

### What the patient is told to do

`nfc.gesture` sets whether the kiosk says "insert your MyKad chip-first" or
"hold it on the pad", and draws the matching piece of hardware on screen — on
the touch kiosk and in the assistant's own words. It has no effect on how the
card is read; a contact slot and a contactless pad both report in as PC/SC
readers, so which one is bolted to this terminal is an install fact rather
than something to guess at. The copy for both lives in `src/lib/id-reader.ts`.

## Face verification (identity step)

The second half of the identity check is a real 1:N face match, not a timer.
Each patient may carry an optional reference portrait (`Citizens` -> **Face
reference photo** in the admin, stored in the `face-photos` upload
collection); the kiosk camera frame is matched against it through the
face-recognition service at `KIOSK_FACE_BASE_URL` — for the Edge AI Demo
Studio gateway, `http://127.0.0.1:8080/api/face-recognition@face-recognition`.

What happens when the patient looks at the camera:

1. The browser grabs a frame from the camera stream (downscaled to 640px,
   unmirrored — the on-screen mirroring is CSS, and a flipped face is a
   different face to an embedding model) and posts it to
   `/api/identity/verify` alongside the document number.
2. The server enrolls that patient's portrait into the worker's gallery under
   their patient ID, prefixed `healthcare:` (`POST {base}/gallery`), once per
   patient per worker lifetime. The gallery lives in the worker's memory, so a
   restart is detected via `gallery_size` and the enrollment is rebuilt
   transparently.
3. The frame goes to `POST {base}/recognize`, which detects every face in it
   and cosine-matches each against the whole gallery.
4. The check passes only if the strongest match for a detected face, among
   this kiosk's `healthcare:` entries, IS the cardholder, at or above the
   model's own threshold (0.4 for the OMZ re-identification model, 0.363 for
   SFace). Matching against the registry rather than against one embedding is
   the point: a lookalike who scores higher than the cardholder is a failure,
   not a pass. The prefix is because the worker is shared — every kiosk in a
   bundle uses the same one — and another kiosk's records are not this
   registry's lookalikes: the same person on file with both under different
   IDs would otherwise fail at whichever kiosk enrolled them second.

The failure modes are deliberately distinct, because they mean different
things to the person at the machine — `no_reference` (no portrait on file),
`no_face` (nothing detectable in frame), `mismatch` (a face, but not theirs)
and `unreachable` each get their own message, and the step shows the server's
reason instead of a blanket "didn't match". Telling somebody with no portrait
on file to try again just loops them.

**A patient with no reference portrait always fails the face check** — there
is nothing to match them against, and reporting "verified" for a check that
cannot distinguish them from anybody else would defeat the step. The same
goes for no face in frame and the wrong face: those are things the check
learned about the person, and no setting turns them into a pass.

Cases where the check never *ran* are different, and by default fall back to
the simulated scan the kiosk has always done: no face service configured
(`base_url` unset), the service unreachable, or a terminal whose camera could
not produce a frame. The response says which happened in `faceMatch`
(`{"checked": false, "reason": "no_capture"}`). Set `face.require_match: true`
for an install where the match is the security control rather than a
demonstration of one — those three become refusals, and a kiosk that cannot
reach the service reports itself out of service rather than failing patients
one at a time.

### Managing portraits from the CMS dashboard

Everything about a patient's portrait is editable in the Payload admin at
[http://127.0.0.1:3001/admin](http://127.0.0.1:3001/admin):

- **Citizens -> a patient -> Face reference photo** — drop an image straight
  onto the field to upload it, or pick one that already exists. The list view
  shows the portrait column, so it is obvious at a glance who has one.
- **Registry -> Face Photos** — the portraits themselves, for uploading a
  batch up front or replacing one in place.
- **Registration desk** — [/enroll](#registration-desk-enroll) takes one with
  the camera on the desk while the patient is standing there, and attaches it
  to their record in the same step.

Two things make this actually work rather than merely appear to:

- **A portrait is checked when it is uploaded.** The same detector that will
  later have to find a face in it runs immediately, and the upload is refused
  with a plain reason if it finds none ("No face could be detected in
  beach.jpg…") or more than one ("2 faces were detected…"). Without this an
  unusable photo looks perfectly fine in the admin and fails days later at the
  kiosk, where the only person it inconveniences is the patient, who can do
  nothing about it. When the face service is unreachable the check is advisory
  — the upload is accepted and a warning is logged — because an install may
  well be populating the registry before the worker is running.
- **Changing a portrait takes effect on the next check.** The worker's gallery
  is keyed by patient ID, so the kiosk also remembers *which* picture it
  enrolled (filename plus `updatedAt`); when that changes, the stale entry is
  deleted from the gallery and the new portrait enrolled in its place. Without
  it, uploading a new photo would silently keep matching against the old one
  until the worker restarted.

If a portrait somehow gets past the upload check and the detector cannot read
it at match time, the kiosk says so specifically (`bad_reference`) instead of
blaming the scanner.

### Seeding portraits

**No portraits ship with the kit.** Out of the box all 100 synthetic patients
start without a reference photo, so the face check has nothing to match against
and refuses — which is the path a demo should walk into by default rather than
have to be steered towards. Pin the mock ID reader with `KIOSK_READER_CITIZEN=3`
(or any key) to see that refusal.

To seed your own, drop images into `data/faces/` and re-seed
(`npm run db:reset`). Files are taken in filename order and attached to
citizenKey 1, 2, 3… so the mapping is reproducible — the first filename always
lands on `MY3080592042` (Nadia Rahman), the second on `VN5635002643` (Hafiz
Omar), and so on. `.jpg`, `.jpeg`, `.png` and `.webp` are accepted, each must
contain exactly one detectable face, and `data/faces/` is gitignored so your
images stay out of the repo. Point `KIOSK_FACES_SEED_DIR` elsewhere to seed
from another directory. Uploading through the dashboard against any patient you
like works just as well and needs no reseed.

A second, different shot of the same person is what you need to stand in for a
camera capture when testing without a live camera:

```bash
curl -s 127.0.0.1:3001/api/identity/verify -H 'content-type: application/json' \
  -d "{\"method\":\"face\",\"documentNumber\":\"MY3080592042\",
       \"image\":\"data:image/jpeg;base64,$(base64 -w0 data/faces/webcam/your-photo.jpg)\"}"
```

To run the worker directly instead of behind the gateway, start it on its own
port and override the base URL in `config.local.yaml`:

```bash
(cd .../workers/face-recognition && ./start.sh --port 8031 --model omz-retail)
```
```yaml
# config.local.yaml
face:
  base_url: http://127.0.0.1:8031
```

## Swapping the backend

All browser calls go through `src/lib/api/client.ts`, whose base URL comes from
`NEXT_PUBLIC_KIOSK_API_URL`. It defaults to the bundled local mock API under
`src/app/api/`; point it at a cloud service that implements the same endpoints
to go live. Mock latency, currency and fees are tunable under `mock:` in
`config.yaml`.
