# 📋 Release Notes

Release notes for the **Vertical Reference Solutions Blueprint** and the kiosks
it ships: the **Public Service Kiosk** and, from 0.9, the **Hospital Concierge
Kiosk**.

- [0.9 - 3 November 2026](#09---3-november-2026)
  - [What's new since 0.8](#whats-new-since-08)
  - [Kiosks](#kiosks)
  - [Editions](#editions)
  - [AI services and device assignment](#ai-services-and-device-assignment)
  - [Public Service Kiosk services](#public-service-kiosk-services)
  - [Hospital Concierge Kiosk services](#hospital-concierge-kiosk-services)
  - [Validated platforms](#validated-platforms)
  - [Validated peripherals](#validated-peripherals)
  - [System requirements](#system-requirements)
  - [Upgrading from 0.8](#upgrading-from-08)
  - [Known limitations](#known-limitations)
  - [Included in this release](#included-in-this-release)
- [0.8 - 1 September 2026](#08---1-september-2026)
  - [Editions](#editions-1)
  - [AI services and device assignment](#ai-services-and-device-assignment-1)
  - [Public services](#public-services)
  - [Validated platforms](#validated-platforms-1)
  - [Validated peripherals](#validated-peripherals-1)
  - [System requirements](#system-requirements-1)
  - [Included in this release](#included-in-this-release-1)
- [Legal information](#legal-information)

---

## 0.9 - 3 November 2026

0.9 adds a second kiosk. The **Hospital Concierge Kiosk** is a patient
self-service terminal: a patient identifies with their MyKad and a face match, or
with a patient card, appointment slip or typed MRN and their date of birth, then
registers, books, checks in, pays, collects a prescription or finds their way
round the hospital. It is built from the same kit as the Public Service Kiosk,
runs the same step engine and AI stack, and comes in the same two editions.

Both kiosks now package as **one desktop app**: an Edge AI Demo Studio export
with every kiosk you chose as a tile of its samples gallery, so one studio, and
one language model, serves them all. In chat mode each kiosk is now a single
tool-calling agent over its own MCP server, voiced by a lip-synced avatar that
follows the citizen into any of twelve spoken languages.

### What's new since 0.8

**New kiosk**

- **Hospital Concierge Kiosk** ([healthcare-service-kiosk/](../../healthcare-service-kiosk/))
  — 20 patient services in seven categories, a mock hospital information system
  behind them, 2D/3D indoor navigation, a queue board, a staff outbox for SMS,
  email and clinic notes, and support for a barcode scanner and a receipt
  printer. See [Hospital Concierge Kiosk services](#hospital-concierge-kiosk-services).

**Packaging and setup**

- **One app for every kiosk.** `./setup.sh --build` packages the embedded
  bundle: the studio, with each chosen kiosk injected as a sample and run as its
  own worker. The window opens on the samples gallery or on one kiosk
  (`--opens-on`); **F2** returns to the gallery, and the staff menu (**F9**, or
  five taps in the top-right corner) reaches every kiosk's staff pages.
- **Electron replaces the Tauri shell.** The package carries its own Chromium
  runtime, so WebKitGTK is no longer a dependency and nothing beyond glibc is
  needed from the system. Windows builds the same bundle as Linux
  (`setup_win.bat --build`).
- **Choose the kiosks.** `./setup.sh` asks which kiosks to set up
  (public-service, healthcare or both) and remembers the answer; `./start.sh`,
  `./uninstall.sh` and the build follow it, and `--kiosk` overrides it for one
  run. It can also go straight on to start, dev mode or a build (`--start`,
  `--dev`, `--build`).
- **A terminal mode per kiosk.** The build asks each kiosk's mode
  (`--mode public-service=chat --mode healthcare=touch`), and the studio starts
  the services the most demanding of them needs.
- **Touch builds ship a cloud LLM.** A build with no chat kiosk points the
  kiosks at Gemini (`gemini-3.5-flash-lite`) and leaves the API key to be set at
  `/settings` on the terminal. `--llm remote|local` overrides the default.
- **Mocked desktop builds.** `./setup.sh --build --mock` packages each kiosk on
  its own with its AI mocked and its devices simulated, with no studio checkout
  needed; `./start.sh --desktop --mock` opens them side by side.
- **Pinned studio instances.** Every service in `deployment.json` has an
  `instanceId` (`kiosk-llm`, `kiosk-stt`, `kiosk-tts-en`, `kiosk-avatar`, `ocr`,
  `face-recognition`), and the kiosks call `/api/<type>@<instance>/…`. Other
  kiosk projects on the same studio share these instances, so they reuse one LLM
  rather than start a second.
- **Proxy support.** Outbound calls (a remote LLM, the notification webhook) go
  through the system proxy (`https_proxy` / `http_proxy`). Loopback stays off
  it, so the studio on `127.0.0.1:8080` is always reached directly.
- **Test documents page.** `/mock-documents` on both kiosks hands out a
  citizen's or patient's test documents, to download or to present to the
  simulated card reader and scanners.

**Chat terminal, both kiosks**

- **One agent over MCP.** Chat mode is a single tool-calling agent driving the
  kiosk's services through its own MCP server (`/api/mcp`), briefed with every
  service's steps, fields and accepted values. The keyword routing and the
  separate agent route are gone.
- **Gemma 4 E4B** (Q4_K_M on llama.cpp, on the GPU) replaces Qwen3.5-4B
  (int4, OpenVINO) as the local model.
- **Say it all at once.** A service starts with whatever the citizen has already
  said ("renew road tax for WXY 1234 for a year", "Dr Lim on Thursday at 10").
  Several services asked for in one sentence are queued and run one after
  another, up to three waiting, with the card read once.
- **Signed in for the visit.** A citizen verified in chat stays signed in for
  their next service and for My Requests.
- **Lip-synced avatar.** The assistant beside the conversation is a person
  streamed over WebRTC by the studio's lipsync service (Wav2Lip), who says each
  reply a sentence or two at a time, in step with the lips. It replaces the drawn
  figure. Without the stream the tile says *Not connected* and replies play from
  the page; with `voice.avatar` unset the conversation takes the full width.
- **Listening.** Silero VAD in the browser cuts each utterance, and Whisper
  large-v3-turbo on the GPU transcribes it (it was Whisper base on the NPU).
- **Twelve spoken languages.** Whisper names each utterance's language and the
  reply follows the citizen's latest one. Kokoro speaks English, Spanish,
  French, Hindi, Italian, Japanese, Portuguese and Chinese; Malay, Indonesian,
  Vietnamese and Tamil each have their own text-to-speech instance
  (`voice.languages`).
- **The card goes in when it is asked for.** A card tapped or inserted while the
  kiosk is still talking is taken as soon as the reply asking for it has
  arrived.

**Peripherals**

- The NFC reader reads a card once per tap (after three failed reads it waits
  for the card to be lifted), and a failed read reports its PC/SC code.
- The Hospital Concierge Kiosk adds a **barcode scanner** for patient cards and
  appointment slips, and an **ESC/POS receipt printer** for printing them.

### Kiosks

| | **Public Service Kiosk** | **Hospital Concierge Kiosk** |
|---|---|---|
| For | Citizens using government services | Patients at a hospital |
| Folder | [public-service-kiosk/](../../public-service-kiosk/) | [healthcare-service-kiosk/](../../healthcare-service-kiosk/) |
| `--kiosk` id | `public-service` | `healthcare` |
| Services | 10, in six categories | 20, in seven categories |
| Identity | NFC ID card + face match | MyKad or passport + face match; or a patient card, appointment slip, scanned letter or typed MRN + date of birth |
| Documents | Scanner, upload or mock | Scanner, upload or mock |
| Payment | Simulated card, QR or cash terminal | Simulated card, QR or cash terminal |
| What the visitor takes away | Receipt | Queue ticket, appointment slip or patient card: on screen, by QR to a phone, or printed |
| Peripherals | NFC reader, document scanner, webcam | The same, plus a barcode scanner and a receipt printer |
| Port, from a checkout / packaged | `3000` / `8035` | `3001` / `8036` |
| Studio sample id | `public-service-kiosk` | `hospital-concierge-kiosk` |

Both carry the Malaysia country pack, both run the touch and the chat terminal
with the on-screen toggle between them, and both have the staff registration
desk (`/enroll`), settings page (`/settings`), test documents (`/mock-documents`)
and CMS admin (`/admin`). The Hospital Concierge Kiosk adds `/staff`, the staff
outbox (`/outbox`) and the queue board (`/queue`).

### Editions

The two editions of 0.8 carry over and now apply to either kiosk: a kiosk's
edition is the terminal mode it is built in.

| | **Lite** | **Full** |
|---|---|---|
| Terminal it opens in | Touch: guided screens | Chat: conversational, voice in and out, lip-synced avatar |
| Build | `--mode touch` (LLM defaults to `remote`) | `--mode chat` (LLM defaults to `local`) |
| Config key | `terminal.mode: touch` | `terminal.mode: chat` |
| AI services on the terminal | 2: OCR, face recognition | 6: LLM, OCR, face recognition, STT, TTS, lipsync |
| Language model | **Remote**: Gemini by default | **Local**: Gemma 4 E4B on the terminal's GPU |
| Speech and avatar | Not deployed, so the chat terminal is text-only | Whisper in, text-to-speech in twelve languages out, Wav2Lip avatar |
| Validated platform | Intel® Wildcat Lake (WCL) | Intel® Core™ Ultra X7 358H, Panther Lake (PTL), 12 Xe GPU |

Either edition runs both terminals, switched on screen; switching drops the
session in progress. One studio serves every kiosk in a build, so a build with
any kiosk in chat mode runs the Full stack, and its touch kiosks use the local
model too.

As in 0.8, speech, the avatar and the peripherals are reported by
`/api/health` but never take a terminal out of service. On the Hospital
Concierge Kiosk the LLM and OCR only count when an enabled service takes
documents.

### AI services and device assignment

Both kiosks ship the same `deployment.json`
([public service](../../public-service-kiosk/deployment.json),
[healthcare](../../healthcare-service-kiosk/deployment.json)). The launchers and
the build write the block for the kiosk's mode into the studio's
`deployment.json`, so the right services auto-start on the right devices; with
kiosks in different modes, the studio gets the chat block.

**Lite (touch): 2 services on the terminal, LLM remote**

| Service | Instance | Used for | Model | Device |
|---|---|---|---|---|
| Text generation (LLM) | not started | Document checks; in healthcare also lab-test search, health answers, lab-result wording and survey sentiment | Gemini `gemini-3.5-flash-lite` in a touch build | **remote** |
| OCR | `ocr` | Reading scanned documents | PaddleOCR (studio default) | **NPU** |
| Face recognition | `face-recognition` | Matching the visitor to their registry portrait | studio default | **CPU** |
| Speech-to-text, text-to-speech, lipsync | — | not deployed | — | offline |

A touch build points `llm.base_url` at Gemini's OpenAI-compatible endpoint and
leaves `llm.api_key` blank. Set the key at `/settings` on the terminal (a key
in `config.yaml` would ship inside the package); until then `/api/health`
reports the LLM `off` and the terminal stays out of service. From a checkout,
set `llm.base_url`, `llm.model` and `llm.api_key` to any OpenAI-compatible
endpoint.

**Full (chat): 6 services, all local**

| Service | Instance | Used for | Model | Device |
|---|---|---|---|---|
| Text generation (LLM) | `kiosk-llm` | The chat agent, document checks | `unsloth/gemma-4-E4B-it-GGUF` (Q4_K_M, llama.cpp) | **GPU** |
| OCR | `ocr` | Reading scanned documents | PaddleOCR (studio default) | **CPU** |
| Face recognition | `face-recognition` | Matching the visitor to their registry portrait | studio default | **CPU** |
| Speech-to-text | `kiosk-stt` | Hearing the visitor, and which language they speak | `openai/whisper-large-v3-turbo` (OEP backend) | **GPU** |
| Text-to-speech | `kiosk-tts-en` | Replies in English and seven more languages | Kokoro (`af_heart` default voice) | **CPU** |
| | `text-to-speech-ms`, `-id`, `-vi`, `-ta` | Replies in Malay, Indonesian, Vietnamese, Tamil | Malaya, Pocket TTS, VieNeu-TTS, FastSpeech2-HS | **CPU** |
| Lipsync | `kiosk-avatar` | The avatar | Wav2Lip (FP16, batch 1) | **NPU** |

Why these devices, as measured on a Core Ultra X7 358H (Arc B390 GPU):

- **Lipsync on the NPU** keeps OpenVINO work off the GPU while llama.cpp
  decodes there, since OpenVINO GPU work fails during a llama.cpp decode. Batch 1
  keeps the lips in time, and FP16 keeps the person's own skin tone, where INT8
  renders the mouth area darker.
- **Speech-to-text on the GPU**: Whisper on the NPU failed every transcription
  on this platform, and the GPU is free when it runs, because the microphone is
  paused while a reply is generated. large-v3-turbo replaces Whisper base,
  whose language identification was too unreliable for Malay, Indonesian and
  Vietnamese.
- **The LLM** runs with `-c 16384 -np 1 --swa-full --reasoning-budget 128` and
  needs thinking on (`chat_template_kwargs.enable_thinking: true`); without it
  the agent answers in prose instead of calling its tools. Gemma's MTP drafter
  roughly doubles decode speed but needs a machine-specific path, so it is left
  out of `deployment.json`; [getting-started.md](getting-started.md#the-edge-ai-studio-prerequisite)
  says how to add it.

Override the whole selection with `STUDIO_DEPLOYMENT_FILE`, or turn off
deployment management with `STUDIO_DEPLOYMENT_MANAGE=0`.

### Public Service Kiosk services

The ten services, their agencies and fees are unchanged from 0.8 (see
[Public services](#public-services)). In chat mode a service now starts with
whatever the citizen has already said: "renew road tax for WXY 1234 for a
year" opens Road Tax Renewal with the plate and the period filled in, with or
without the space in the plate.

### Hospital Concierge Kiosk services

Twenty services in seven categories: the 19 of
[service-hierarchy.xlsx](../../healthcare-service-kiosk/docs/service-hierarchy.xlsx),
carried out step by step, plus Way to My Appointment. Each runs in touch and in
chat through the same flow engine, and the information services (lab prices,
estimates, directions, hospital information, doctors, health questions,
feedback) need no identity.
[service-coverage.md](../../healthcare-service-kiosk/docs/service-coverage.md)
maps each one to the spreadsheet's steps.

| # | Service | Category | What it does |
|---|---|---|---|
| 1 | Create Patient Record | Patient Registration | Registers a new patient from their MyKad: reads the card, confirms the details, takes the record photo, issues an MRN and a patient card |
| 2 | Patient Verification | Patient Registration | Confirms identity and contact details, checks insurance, balance and today's appointment, issues a registration queue number |
| 3 | Eligibility Check | Patient Registration | Reads the insurance card, checks the payer panel and the policy, shows coverage and co-pay |
| 4 | New Specialist Visit | Appointments | Books a clinic, doctor and time, today included; confirms by SMS and email with a signed, barcoded slip |
| 5 | Follow-up Visit | Appointments | Books the follow-up the doctor recommended |
| 6 | Same-Day Check-In | Appointments | Checks in for today's visit, issues the clinic's queue number, notifies the clinic and shows the way there |
| 7 | Medication Lookup | Clinical Information | Each prescription's dosage, price, refills left and last fill |
| 8 | Refill Request | Clinical Information | Checks the refill is due, files it for the pharmacy, bills the insurer or takes payment |
| 9 | Lab Test Pricing | Clinical Information | Price, preparation and turnaround of a test asked for by name, synonym or description |
| 10 | Lab Results | Clinical Information | Results explained in plain words, to print or email |
| 11 | Estimate Procedure Cost | Financial Services | Standard charges line by line, the insurer's share and the co-pay |
| 12 | Outstanding Balance | Financial Services | Unpaid invoices, paid at the kiosk with an emailed receipt |
| 13 | Indoor Navigation | Navigation & Help | A route to any department, ward, room or facility |
| 14 | Way to My Appointment | Navigation & Help | Finds today's visit and routes to that doctor's clinic (an addition to the spreadsheet) |
| 15 | Service Discovery | Navigation & Help | Departments' places, hours, services and what to bring, from the hospital guide |
| 16 | Find a Doctor | Navigation & Help | By specialty, name or language, with clinic days and the next free slots |
| 17 | Referral Validation | Diagnostics | Reads a referral letter and checks the patient, the doctor's MMC number and the dates; anything unusual goes to staff review |
| 18 | Medical Document Intake | Diagnostics | Files a scan, PDF or photo against the patient, after recognising what kind of document it is |
| 19 | General Q&A | Patient Support | Red flags first, then answers from a trusted health guide, always with the disclaimer |
| 20 | Patient Survey | Patient Support | Rating, area and comment; poor, urgent or safety feedback becomes a staff ticket |

**Identifying.** The identity screen listens to every way in at once: a MyKad
or passport on the card reader (confirmed by a face match), a patient card or
appointment slip under the barcode scanner, a letter in the document scanner
(OCR reads the MRN or ID number), or an MRN typed on the keypad (its check
digit catches typos). A code, a letter or a typed MRN is confirmed by date of
birth; three wrong tries lock the record for 10 minutes. Touch mode keeps the
patient signed in for 10 minutes, and chat carries the sign-in on to the next
service.

**Booking and check-in.** Booking offers today's remaining clinic times first,
then four times a clinic day over the next six days. A doctor, clinic ("a
cardiologist", "jantung"), day ("Thursday", "5 Disember") or time named in
English or Malay goes straight to that slot when it is free; otherwise the
kiosk says why and offers the four free times nearest to it. A booking's slip
carries a 20-digit Code 128 code that checks the patient in on the day.
Check-in issues a queue number per clinic per day, notifies the clinic, shows
the live position on the ticket and the `/queue` board, and bills the
consultation and readies the clinic's prescription at the pharmacy. A visit
can be booked, checked in, paid for and collected in one session
(`mock.clinics_always_open` lets every specialist take same-day visits for
demos).

**Wayfinding.** The map is a fictional hospital of four blocks. Routes run from
the kiosk to any department, ward, ward room or facility on a 2D floor plan, a
stacked 3D view or both, with turn-by-turn steps, a walk-through, a step-free
(lifts only) option and the steps as a QR for the phone. A check-in in chat
brings up the map to the clinic. The floor plan is generated by a script:
[hospital-map.md](../../healthcare-service-kiosk/docs/hospital-map.md) covers
changing it.

**What the patient takes away.** A queue ticket, appointment slip or patient
card, on screen and in the chat. The card and the slip print on the receipt
printer with their Code 128, so the paper scans at any kiosk later.
Confirmations and clinic notes go to the staff outbox, or to a real gateway
through `notify.webhook_url`.

**Parts you can switch off.** Every service, the assistant, the MCP server and
the shared wayfinding, queue, booking and Q&A pieces is a module. Switch one off
in `config.yaml` (`modules.disabled`, `modules.only`) or at
**/settings → Modules**, or take it out of the code with
`npm run modules -- remove <id>`. See
[modules.md](../../healthcare-service-kiosk/docs/modules.md).

**Stand-ins for the hospital's systems.** No HIS, scheduler, payment gateway or
SMS gateway sits behind the kiosk. Each patient's record is derived from their
ID number, with what the kiosk filed applied on top, so every service runs end
to end.

The patient screens adapt to portrait (1080×1920) and landscape displays
without a setting, and rotating keeps the session.

### Validated platforms

| Platform | Edition validated | LLM | OCR | Face | STT | TTS | Lipsync |
|---|---|---|---|---|---|---|---|
| **Intel® Core™ Ultra X7 358H, Panther Lake (PTL), 12 Xe GPU** | **Full** (chat) | GPU | CPU | CPU | GPU | CPU | NPU |
| **Intel® Wildcat Lake (WCL)** | **Lite** (touch) | remote | NPU | CPU | — | — | — |

Full's device assignment was measured on a Core Ultra X7 358H (Arc B390 GPU)
under Windows 11. Lite's LLM column is the remote endpoint it calls; the WCL
terminal itself hosts OCR on its NPU and face recognition on its CPU.

Operating systems: Ubuntu / Debian (x86-64) and Windows 11. Other Intel
platforms exposing a GPU and NPU are expected to work with the same profiles but
are not validated in this release.

### Validated peripherals

| Device | Model validated | Interface | Driver requirement |
|---|---|---|---|
| **NFC ID card reader** | **ACS ACR122U** (PICC contactless interface) | PC/SC (USB) | Linux: `libpcsclite1` + the `pcscd` daemon running (`pcsc-tools` for `pcsc_scan`). Windows: the Smart Card service running; `npm run nfc:probe` says how to start it. Select a specific reader with `nfc.reader`. |
| **Document scanner** | **Ricoh / PFU fi-800R** | SANE (USB) | `sane-utils` (`scanimage`) **plus** PFU's proprietary `pfufs` SANE backend (fi Series Linux driver, licensed download from PFU support), which also ships the `pfufsgetscstatus` paper-detect tool. On Windows: PaperStream IP. |
| **Camera** | Any standard UVC webcam | USB | None: read in the browser via `getUserMedia`. |
| **Barcode scanner** (healthcare) | Any reader of Code 128; a 2D imager also reads codes off a phone screen | HID keyboard wedge, or USB-CDC serial (`barcode.driver`) | None for `hid`. For `serial` on Linux: the kiosk user in `dialout`, and a udev rule naming the device and keeping ModemManager off it. |
| **Receipt printer** (healthcare) | **YK ET80** (80 mm ESC/POS, auto-cutter, USB `0483:7540`) | ESC/POS over USB, or TCP 9100 (`printer.driver`, `printer.device`) | Windows: the in-box USB Printing Support driver, no print queue or vendor driver. Linux: the `usblp` module (`/dev/usb/lp0`) and the kiosk user in `lp`. |

Every device falls back to simulation when absent (`--mock`, or the `simulated`
profile). Install the Linux driver stack in one step with `./setup.sh --hardware`
(or `npm run drivers:install` in `<kiosk>/frontend/`).

### System requirements

| Requirement | Notes |
|---|---|
| OS | Ubuntu / Debian (x86-64) or Windows 11. The same app builds for both. |
| Node.js | ≥ 20 with npm. `./setup.sh` downloads a checksum-verified portable Node (v22.18.0) when the machine has none. |
| Edge AI Demo Studio | A checkout at `EDGE_AI_STUDIO_DIR`, on a branch carrying the services the kiosks' modes need: text generation (llama.cpp), OCR, face recognition, speech-to-text (OEP backend), text-to-speech (Kokoro, Malaya, Pocket TTS, VieNeu-TTS, FastSpeech2-HS) and lipsync (Wav2Lip). Required for live AI and as the export source of the packaged app; not needed with `--mock`. On Linux, run its `install_dependencies.sh` once on each terminal. |
| Remote LLM | **Lite only**: a Gemini API key, or another OpenAI-compatible endpoint. Use a billed key; a free-tier key's daily cap runs out quickly. |
| Desktop toolchain | None beyond Node: Electron and electron-builder install as npm dependencies of `common/electron/`. |
| OCR support | `poppler-utils` (`pdftoppm`) to rasterize captured PDFs. |
| Network | Required on the packaged app's first launch, and the first launch after an upgrade, to set up worker environments, runtimes and model downloads. |
| Disk | Tens of GB in the app's data directory for the unpacked platform, worker environments and models. |

### Upgrading from 0.8

- **Service addresses.** The studio now answers only instance addresses
  (`/api/<type>@<instance>/…`); the bare `/api/<type>/…` addresses a 0.8
  `config.yaml` calls return 404. A checkout keeps its gitignored `config.yaml`
  across a pull, so copy the `base_url` keys from the kiosk's
  `frontend/configs/reference.yaml` into it: `llm`, `ocr`, `face`, `voice.stt`,
  `voice.tts`, and the new `voice.avatar`.
- **Model.** On a Full terminal set `llm.model` to
  `llamacpp:unsloth/gemma-4-E4B-it-GGUF:Q4_K_M`, with
  `llm.extra_body.chat_template_kwargs.enable_thinking: true`. The build warns
  when `llm.model` is not the model the platform runs.
- **A studio set up before the ids were pinned** keeps its old instances
  (`text-generation@text-generation`, …). Delete them on the studio's Services
  page and restart it, and it starts the pinned ones.

### Known limitations

- The Hospital Concierge Kiosk runs on stand-ins: the patient record is derived
  from the ID number rather than read from a HIS, payment is a simulated
  terminal, and SMS and email reach a phone or inbox only through
  `notify.webhook_url`; no gateway client ships.
- Its chat terminal needs a live model. Under `--mock` the chat screen says so,
  and its mocked build opens in touch.
- There is no clinic console: the queue moves by the clock, with no call,
  recall or no-show.
- Only the patient card and the appointment slip go to the receipt printer;
  queue tickets, receipts and routes use the browser's print dialog. The
  printer's font is ASCII, so accents are dropped, and on Linux its paper status
  cannot be read.
- Phone QR codes carry text rather than a link to a map, which would need a
  public web host. Decoding codes with the camera, and GS1 DataMatrix
  wristbands, are not built.
- The avatar's WebRTC stream needs a network interface up: neither the browser
  nor the studio worker offers loopback-only WebRTC by default.
- A cloud LLM that is briefly overloaded (HTTP 503) or out of quota (429)
  leaves that document unverified, and the visitor is asked to capture it again.

### Included in this release

| Artifact | Platform | Notes |
|---|---|---|
| `.AppImage` | Linux | ~115 MB: the studio export with every chosen kiosk, plus the Electron shell's Chromium runtime |
| `.deb` | Linux | The same app as a package |
| `.exe` (NSIS), `.msi` | Windows | The same app; the NSIS installer is ~160 MB |
| `-mock` builds | Linux, Windows | Optional, one per kiosk: the kiosk on its own with its AI mocked and its devices simulated |

The package ships pre-setup. First launch unpacks the platform into the app's
data directory (`~/.local/share/VRSB/`, `%APPDATA%\VRSB` on Windows) and runs the
studio's setup there, which takes a while and needs network; later launches
start straight away.

---

## 0.8 - 1 September 2026

The Public Service Kiosk is a self-service government terminal: a citizen walks
up, verifies their identity with an NFC ID card and a face match, submits
supporting documents from a scanner, pays, and receives a receipt. The AI behind
that flow — the language model, OCR, face recognition and speech — is served
through an **Edge AI Demo Studio** gateway. Where that gateway runs is what
separates the two editions: Full hosts all five services on the terminal itself,
while Lite runs OCR and face recognition locally and calls a **remote** gateway
for the language model.

This release publishes the kiosk in **two editions built from one codebase**:

- **Public Service Kiosk Lite** — opens on the touch terminal. Two AI services on
  the terminal (OCR, face recognition); the LLM is remote.
- **Public Service Kiosk Full** — opens on the conversational terminal with voice
  in and out. All five AI services on the terminal, including a local LLM, and it
  supports **both** the chat and the touch terminal, switched on screen.

Both editions offer the **same ten public services**. Lite is validated on
**Intel® Wildcat Lake (WCL)** and Full on **Intel® Panther Lake (PTL) with the
12 Xe GPU**.

### Editions

| | **Public Service Kiosk Lite** | **Public Service Kiosk Full** |
|---|---|---|
| Terminal it opens in | Touch — guided screens | Chat — conversational, voice in and out |
| Terminals available | Touch, plus a text-only chat terminal | **Both** — chat and touch, switched on screen |
| Build | `common/scripts/build.sh -- --mode touch` | `common/scripts/build.sh -- --mode chat` |
| Config key | `terminal.mode: touch` | `terminal.mode: chat` |
| AI services on the terminal | 2 — OCR, face recognition | 5 — LLM, OCR, face recognition, STT, TTS |
| Language model | **Remote** gateway — no local LLM | **Local**, on the terminal's GPU |
| Deployment profile | `touch` in [deployment.json](../../public-service-kiosk/deployment.json) | `chat` in [deployment.json](../../public-service-kiosk/deployment.json) |
| Speech | Not deployed (STT/TTS explicitly offline) | Whisper speech-to-text, Kokoro text-to-speech, both local |
| Public services | All 10 | All 10 |
| Identity verification | NFC ID card + face match | NFC ID card + face match |
| Document capture | Scanner, upload or mock | Scanner, upload or mock |
| Validated platform | Intel® Wildcat Lake (WCL) | Intel® Panther Lake (PTL), 12 Xe GPU |

The split is the interaction model and the AI stack behind it, not the services
on offer.

**Full runs both terminals.** Every build compiles the touch kiosk and the chat
kiosk; `terminal.mode` names the one the terminal opens in and returns to on
reload or idle restart, and an on-screen toggle — in the chat header, and on the
touch welcome screen and header — crosses between them at any time. Switching
drops the session in progress and starts the other terminal fresh. Because Full
deploys all five AI services, both of its terminals are fully featured: the touch
flow reads documents and matches faces, and the chat flow additionally listens
and speaks.

Lite carries the same two terminals, but with speech-to-text and text-to-speech
not deployed its chat terminal is **text-only** — the microphone button is hidden
and replies are not read aloud. Speech is reported but not gated by the kiosk's
health check, so a Lite terminal never goes out of service for the missing voice
services.

### AI services and device assignment

Both editions consume their AI from an **Edge AI Demo Studio** gateway. The
launchers write the kiosk's `deployment.json` block for its mode into the studio's
`deployment.json`, so the right services auto-start on the right devices.

**Lite (touch) — 2 services on the terminal, LLM remote**

| Service | Used for | Model | Device |
|---|---|---|---|
| Text generation (LLM) | Document verification, service routing | as deployed on the remote gateway | **remote** — not started locally |
| OCR | Reading scanned documents | PaddleOCR (`ppocrv5`) | **NPU** |
| Face recognition | Matching the citizen to their registry portrait | Open Model Zoo retail (`omz-retail`) | **CPU** |
| Speech-to-text | — | not deployed | offline |
| Text-to-speech | — | not deployed | offline |

A Lite terminal starts no language model of its own: point `llm.base_url` (env
`KIOSK_LLM_BASE_URL`) at the remote gateway's `/api/text-generation/v1`, and set
`llm.model` to the model that gateway serves. OCR and face recognition stay on
`127.0.0.1:8080`, so the two `base_url` settings differ on a Lite terminal.

**Full (chat) — 5 services, all local**

| Service | Used for | Model | Device |
|---|---|---|---|
| Text generation (LLM) | The conversation, document verification, service routing | `OpenVINO/Qwen3.5-4B-int4-ov` (int4, OpenVINO) | **GPU** |
| OCR | Reading scanned documents | PaddleOCR (`ppocrv5`) | **CPU** |
| Face recognition | Matching the citizen to their registry portrait | Open Model Zoo retail (`omz-retail`) | **CPU** |
| Speech-to-text | Hearing the citizen | `openai/whisper-base` | **NPU** |
| Text-to-speech | Speaking replies aloud | Kokoro (`af_heart` default voice) | **CPU** |

The deployment profiles pin the **device** for every service the terminal hosts,
and the chat profile additionally pins the **model** for text generation; the
remaining models are the studio worker defaults recorded in
the 0.8 tree's `frontend/deployment.json`. Override the whole
selection with `STUDIO_DEPLOYMENT_FILE`, or disable profile management with
`STUDIO_DEPLOYMENT_MANAGE=0`.

### Public services

Ten services across six categories, available in both editions. Fees are in MYR;
services with a pricing table charge by the answer given during the flow.

| # | Service | Category | Agency | Fee |
|---|---|---|---|---|
| 1 | MyKad Issuance / Replacement | Identity Services | JPN | RM10 application; RM0 first card, RM110/310/1,010 by loss tier, RM20 particulars change |
| 2 | Birth Registration (NRD.LM01) | Civil Registration | JPN | Free within 60 days; RM50 late (Peninsular) |
| 3 | Marriage Registration (Non-Muslim) | Civil Registration | JPN | RM30; RM530 for an outside venue (KC01E licence) |
| 4 | MyKad Address Change | Residence & Address | JPN | RM10 (card is reprinted) |
| 5 | New Driving License Application | Transport & Licensing | JPJ | RM60 (class D/DA); RM2 (class B2, MADANI rate) |
| 6 | Driving License Renewal / Replacement | Transport & Licensing | JPJ | RM30/year (1, 2, 3 or 5 years); RM20 replacement |
| 7 | Road Tax Renewal (LKM) | Transport & Licensing | JPJ | Computed from engine capacity; 6- or 12-month period |
| 8 | Traffic Fine (Saman) Payment | Transport & Licensing | JPJ & PDRM | Per summons; repeatable within a session |
| 9 | Welfare Aid Application (Bantuan JKM) | Family & Social Services | JKM | Free (BKK, BWE, BTB, EPOKU schemes) |
| 10 | Certificate of Good Conduct (SKB) | Certificates & Records | KLN e-Konsular / PDRM | RM20 |

Every service runs the same step engine — consent, identity, application,
documents, payment, receipt — with services that need no supporting document
(road tax, traffic fines) or no typed answers (address change, where the new
address is read off the proof document) omitting the step they do not need.

### Validated platforms

| Platform | Edition validated | LLM | OCR | Face | STT | TTS |
|---|---|---|---|---|---|---|
| **Intel® Panther Lake (PTL), 12 Xe GPU** | Public Service Kiosk **Full** (chat) | GPU | CPU | CPU | NPU | CPU |
| **Intel® Wildcat Lake (WCL)** | Public Service Kiosk **Lite** (touch) | remote | NPU | CPU | — | — |

Only Full runs a language model on the terminal. Lite's LLM column is the remote
gateway it calls; the WCL terminal itself hosts OCR on its NPU and face
recognition on its CPU. Full's speech-to-text runs on the NPU by profile; the
NPU Whisper export has not yet been exercised on the validated PTL unit.

Operating system for both: Ubuntu / Debian (x86-64) with the WebKitGTK runtime.
Other Intel platforms exposing a GPU and NPU through OpenVINO are expected to
work with the same profiles but are not validated in this release.

### Validated peripherals

| Device | Model validated | Interface | Driver requirement |
|---|---|---|---|
| **NFC ID card reader** | **ACS ACR122U** (PICC contactless interface) | PC/SC (USB) | `libpcsclite1` + the `pcscd` daemon running (`pcsc-tools` for `pcsc_scan`). The kiosk's `pcsc-mini` bindings talk to that daemon — no daemon, no reads. Select a specific reader with `nfc.reader`. |
| **Document scanner** | **Ricoh / PFU fi-800R** | SANE (USB) | `sane-utils` (`scanimage`) **plus** PFU's proprietary `pfufs` SANE backend (fi Series Linux driver, guide `P2U3-0200-08ENZ0.pdf`, licensed download from PFU support). It also ships `pfufsgetscstatus`, the paper-detect tool the `fi-800r` scanner profile polls before every scan. On Windows: PaperStream IP. |
| **Camera** | Any standard UVC webcam | USB | None — read in the browser via `getUserMedia`. |

The fi-800R is driven in `Adf-duplex` with `--page-auto`, multifeed detection and
blank-page skip; the generic SANE backends do not drive it that way. For terminals
without the reference hardware, the SANE `test` backend and the `none` scanner
profile are supported, and every device falls back to simulation when absent.

Install the Linux driver stack in one step:

```bash
./setup.sh --hardware          # or: npm run drivers:install  (in <kiosk>/frontend/)
```

### System requirements

| Requirement | Notes |
|---|---|
| OS | Ubuntu / Debian (x86-64) for the packaged kiosk. Windows is supported for the standalone desktop build. |
| Node.js | ≥ 20 with npm. `./setup.sh` downloads a checksum-verified portable Node (v22.18.0) when the machine has none. |
| Edge AI Demo Studio | A checkout of the **Edge AI Demo Studio** at `EDGE_AI_STUDIO_DIR`, on a branch carrying the services the kiosk mode needs. Required for live AI, and as the export source of the packaged bundle (the checkout only — the build does not set it up). Not needed to run with `--mock`. |
| Remote LLM gateway | **Lite only** — a reachable text-generation endpoint for `llm.base_url`. Without it, document verification has nothing to call. |
| Desktop toolchain | None beyond Node — the desktop shell is Electron, installed by `common/scripts/build.sh` as an npm dependency. |
| OCR support | `poppler-utils` (`pdftoppm`) to rasterize captured PDFs. |
| Network | Required on the packaged app's **first launch** only, to provision worker environments, runtimes and model downloads. |

### Included in this release

| Artifact | Platform | Notes |
|---|---|---|
| `.AppImage` | Linux | ~100 MB — additionally carries the WebKitGTK runtime |
| `.deb` | Linux | ~35 MB — declares WebKitGTK as system dependencies |
| `.exe` (NSIS), `.msi` | Windows | Standalone desktop build |

---

## Legal information

Copyright (C) 2026 Intel Corporation. Licensed under the Apache License 2.0;
every source file carries its own SPDX header.

Intel, the Intel logo and other Intel marks are trademarks of Intel Corporation
or its subsidiaries. Other names and brands may be claimed as the property of
others.
