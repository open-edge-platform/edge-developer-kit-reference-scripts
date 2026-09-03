# 📋 Release Notes

Release notes for the **Vertical Reference Solutions Blueprint** and the Public
Service Kiosk it ships.

- [0.8](#08---1-september-2026)
  - [Editions](#editions)
  - [AI services and device assignment](#ai-services-and-device-assignment)
  - [Public services](#public-services)
  - [Validated platforms](#validated-platforms)
  - [Validated peripherals](#validated-peripherals)
  - [System requirements](#system-requirements)
  - [Included in this release](#included-in-this-release)
  - [Legal information](#legal-information)

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
| Build | `scripts/build.sh -- --mode touch` | `scripts/build.sh -- --mode chat` |
| Config key | `terminal.mode: touch` | `terminal.mode: chat` |
| AI services on the terminal | 2 — OCR, face recognition | 5 — LLM, OCR, face recognition, STT, TTS |
| Language model | **Remote** gateway — no local LLM | **Local**, on the terminal's GPU |
| Deployment profile | [studio-deployment.touch.json](../scripts/studio-deployment.touch.json) | [studio-deployment.chat.json](../scripts/studio-deployment.chat.json) |
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
launchers install the profile matching the kiosk mode as the studio's
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
`localhost:8080`, so the two `base_url` settings differ on a Lite terminal.

**Full (chat) — 5 services, all local**

| Service | Used for | Model | Device |
|---|---|---|---|
| Text generation (LLM) | The conversation, document verification, service routing | `OpenVINO/Qwen3.5-4B-int4-ov` (int4, OpenVINO) | **GPU** |
| OCR | Reading scanned documents | PaddleOCR (`ppocrv5`) | **CPU** |
| Face recognition | Matching the citizen to their registry portrait | Open Model Zoo retail (`omz-retail`) | **CPU** |
| Speech-to-text | Hearing the citizen | `openai/whisper-base` | **CPU** |
| Text-to-speech | Speaking replies aloud | Kokoro (`af_heart` default voice) | **CPU** |

The deployment profiles pin the **device** for every service the terminal hosts,
and the chat profile additionally pins the **model** for text generation; the
remaining models are the studio worker defaults recorded in
[frontend/deployment.json](../frontend/deployment.json). Override the whole
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
| **Intel® Panther Lake (PTL), 12 Xe GPU** | Public Service Kiosk **Full** (chat) | GPU | CPU | CPU | CPU | CPU |
| **Intel® Wildcat Lake (WCL)** | Public Service Kiosk **Lite** (touch) | remote | NPU | CPU | — | — |

Only Full runs a language model on the terminal. Lite's LLM column is the remote
gateway it calls; the WCL terminal itself hosts OCR on its NPU and face
recognition on its CPU.

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
./setup.sh --hardware          # or: npm run drivers:install  (in frontend/)
```

### System requirements

| Requirement | Notes |
|---|---|
| OS | Ubuntu / Debian (x86-64) for the packaged kiosk. Windows is supported for the standalone desktop build. |
| Node.js | ≥ 20 with npm. `./setup.sh` downloads a checksum-verified portable Node (v22.18.0) when the machine has none. |
| Edge AI Demo Studio | A checkout of the **Edge AI Demo Studio** at `EDGE_AI_STUDIO_DIR`, on a branch carrying the services the kiosk mode needs. Required for live AI, and as the export source of the packaged bundle (the checkout only — the build does not set it up). Not needed to run with `--mock`. |
| Remote LLM gateway | **Lite only** — a reachable text-generation endpoint for `llm.base_url`. Without it, document verification has nothing to call. |
| Desktop toolchain | None beyond Node — the desktop shell is Electron, installed by `scripts/build.sh` as an npm dependency. |
| OCR support | `poppler-utils` (`pdftoppm`) to rasterize captured PDFs. |
| Network | Required on the packaged app's **first launch** only, to provision worker environments, runtimes and model downloads. |

### Included in this release

| Artifact | Platform | Notes |
|---|---|---|
| `.AppImage` | Linux | ~100 MB — additionally carries the WebKitGTK runtime |
| `.deb` | Linux | ~35 MB — declares WebKitGTK as system dependencies |
| `.exe` (NSIS), `.msi` | Windows | Standalone desktop build |