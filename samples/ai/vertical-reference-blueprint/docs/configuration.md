# ⚙️ Configuration Reference

Everything the blueprint can be configured with, where those settings live, and how they
override each other.

- [How configuration is resolved](#how-configuration-is-resolved)
- [Launcher script configuration](#launcher-script-configuration)
- [Core settings](#core-settings) (API, terminal mode, session)
- [AI services](#ai-services) (LLM, OCR, face, speech)
- [Hardware](#hardware) (NFC reader, document scanner, camera)
- [CMS / database](#cms--database)
- [Mock & demo settings](#mock--demo-settings)
- [Prompt overrides](#prompt-overrides)
- [Env-only variables](#env-only-variables)
- [Build-time vs runtime settings](#build-time-vs-runtime-settings)

---

## How configuration is resolved

All kiosk settings are read through one loader
([frontend/src/lib/kiosk-config.ts](../frontend/src/lib/kiosk-config.ts)), with this
precedence (highest wins):

1. **Real environment variables** — shell exports, CI variables.
2. **`frontend/config.local.yaml`** — your machine-local overrides. Gitignored,
   layered key-by-key on top of `config.yaml`. **This is the recommended place for
   your own settings.**
3. **`frontend/config.yaml`** — this terminal's own settings. **Gitignored**: the
   launchers copy it out of [`frontend/configs/`](../frontend/configs/) on the first
   run (`--profile`, default `reference`) and generate its admin password there, so
   no credential ever reaches git. Until one exists, the loader falls back to the
   committed [`configs/reference.yaml`](../frontend/configs/reference.yaml) — heavily
   commented; read that one as documentation.
4. **Code fallbacks** — hardcoded defaults in the source.

Every YAML key maps 1:1 to an environment variable (listed in the tables below), so
anything you can put in YAML you can also set as an env var — useful for one-off runs:

```bash
KIOSK_LLM_MOCK=true npm run dev
```

A minimal `frontend/config.local.yaml` for a machine **without** the Edge AI Studio
gateway (fully mocked, zero external dependencies):

```yaml
llm:
  mock: true
documents:
  require_verification: false
ocr:
  base_url: "" # blank = intentionally off; a configured-but-unreachable
face: #         service would fail /api/health (out-of-service screen)
  base_url: ""
```

> **Note:** the `reference` profile ships with `llm.mock: false`, i.e. it expects a
> live LLM gateway on `http://localhost:8080`. Without the gateway (and without the
> override above) the kiosk shows its out-of-service screen. The `./scripts/dev/dev.sh --mock` and
> `./start.sh --mock` launchers set the mock variables for you.

The config file location itself can be overridden with `KIOSK_CONFIG_FILE=/path/to/config.yaml`.

---

## Launcher script configuration

The launcher scripts (`setup`, `start`, `build` and `scripts/dev` — `.sh` on Linux,
`.bat` → `scripts/win/*.ps1` on Windows) read their own settings from environment
variables, or from an optional gitignored **`.kioskrc`** file at the repo root (a
plain shell file, sourced by the bash scripts and parsed line by line by the
PowerShell ones, before defaults are applied):

```bash
# .kioskrc — local launcher settings (not committed)
EDGE_AI_STUDIO_DIR="$HOME/workspace/applications.ai.tools.edge-ai-studio"
STUDIO_AUTOSTART=1
```

| Variable | Default | Purpose |
|---|---|---|
| `EDGE_AI_STUDIO_DIR` | `~/workspace/applications.ai.tools.edge-ai-studio` | Path to the Edge AI Studio checkout. Setup builds it from here; start/dev launch it from here. |
| `STUDIO_AUTOSTART` | `1` | Set to `0` to never auto-start the studio (same as passing `--no-studio`). |
| `STUDIO_URL` | `http://localhost:8080` | Where the studio gateway is expected. Used for the pre-flight health check. |
| `STUDIO_WAIT_SECS` | `600` | How long `start`/`dev` wait for the studio gateway to become healthy before giving up (first launch loads AI models, which is slow). |
| `STUDIO_RUN_MODE` | `auto` | How the studio is launched: `auto` (packaged executable if built, else headless), `packaged` (require the executable from the studio's own `scripts/bash/package.sh`), `headless` (always the studio's `start.sh` server — no app window; right for servers/CI). |
| `STUDIO_DEPLOYMENT_FILE` | *(auto by kiosk mode)* | Service presets the launchers install as the studio's `deployment.json`. Unset, the kiosk's terminal mode picks a profile: `touch` → [scripts/studio-deployment.touch.json](../scripts/studio-deployment.touch.json) (**LLM, OCR and face**, the speech services explicitly offline); `chat`/`agent` → [scripts/studio-deployment.chat.json](../scripts/studio-deployment.chat.json) (**all five services**). Both hardcode devices and the model the kiosk's `config.yaml` expects — LLM on `GPU`, face and speech on `CPU`, OCR on `NPU` in touch mode and `CPU` in chat/agent. Set this to force a specific file. A preset file the scripts installed earlier is upgraded in place when the mode changes; one written by hand is never overwritten. |
| `STUDIO_DEPLOYMENT_MANAGE` | `1` | Set `0` to never touch the studio's `deployment.json`. |
| `KIOSK_PROFILE` | `reference` | Which `frontend/configs/<name>.yaml` the launchers copy to `frontend/config.yaml` on a checkout that has none (also `./setup.sh --profile <name>`). An existing `config.yaml` is never replaced — delete it to re-pick. |
| `KIOSK_NODE_VERSION` | `v22.18.0` | Portable Node.js release `./setup.sh` falls back on when the machine has no Node ≥ 20 (also `./setup.sh --node-version <v>`). Matches the version the Edge AI Studio unpacks. |
| `KIOSK_NODE_DIR` | `<repo>/thirdparty/node` | Where that portable Node is unpacked. Every launcher prepends its `bin/` to `PATH` when a binary is there, so it also carries `npm`. Gitignored; delete the directory to go back to the machine's Node. |
| `KIOSK_NODE_MIRROR` | `https://nodejs.org/dist` | Where the portable Node and its `SHASUMS256.txt` are downloaded from. Point it at an internal mirror on an air-gapped terminal. |
| `KIOSK_BUNDLE_DIR` | `<repo>/build/kiosk-studio` | Where `./start.sh --bundle` looks for the [embedded studio bundle](embedded-studio.md). |
| `KIOSK_BUNDLE_PORT` | `8035` | Port the embedded kiosk listens on inside the bundle (set when the bundle is exported — `./build.sh` / `scripts/bundle.sh`). |

Command-line flags always beat `.kioskrc` and env vars. See each script's `--help`.

The desktop shell additionally understands an **external-target mode** (used by
`./start.sh --bundle --tauri`): `KIOSK_SHELL_URL` (window target; the shell skips
spawning its own server), `KIOSK_SHELL_CMD` + `KIOSK_SHELL_CWD` (optional command to
launch the stack), `KIOSK_SHELL_TIMEOUT_SECS` (how long to wait for the target port;
default 180, the bundle launcher uses 900).

Whatever the shell starts it also stops: closing the window (or Ctrl+C in the
terminal that launched it) signals the whole process group, so the studio can
shut its AI workers down before the app goes. `KIOSK_SHELL_SHUTDOWN_SECS`
(default 20) is how long that gets before what is left is killed outright, and
`KIOSK_SHELL_KEEP_ALIVE=1` leaves the stack running instead — a studio that was
already up before the shell launched is never touched either way.

---

## Core settings

YAML keys live in `frontend/config.yaml` (copied from `frontend/configs/`); the env
var is the equivalent override.

### API, terminal & session

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `api.base_url` | `NEXT_PUBLIC_KIOSK_API_URL` | `/api` | API base URL used by the browser. Point at a remote backend to split UI and server. |
| `terminal.mode` | `NEXT_PUBLIC_KIOSK_MODE` | `chat` (yaml) | `touch` \| `chat` \| `agent`. UI interaction style. ⚠️ **Baked in at build time.** |
| `session.restart_ms` | `NEXT_PUBLIC_KIOSK_RESTART_MS` | `30000` | Countdown on the receipt screen before restarting the session. |
| `session.idle_ms` | `NEXT_PUBLIC_KIOSK_IDLE_MS` | `60000` | Idle time before the session is wiped. |
| `session.verification_ttl_ms` | `KIOSK_VERIFICATION_TTL_MS` | `900000` | How long a completed identity verification stays valid (15 min). |

### Country & locale

The country pack owns everything country-shaped — identity documents and
their names, on-screen copy, speech vocabulary, the service catalog itself
(see [country-packs.md](country-packs.md)). The `locale:` block tunes
formatting; every default is what the kiosk always did, so leaving it unset
changes nothing.

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `country.pack` | `NEXT_PUBLIC_KIOSK_PACK` | `malaysia` | Which country pack this terminal serves. ⚠️ **Baked in at build time.** |
| `locale.language` | `NEXT_PUBLIC_KIOSK_LANG` | `en` | BCP-47 tag: `<html lang>`, STT hint, case folding. ⚠️ **Baked in at build time.** |
| `locale.money_locale` | `NEXT_PUBLIC_KIOSK_MONEY_LOCALE` | `en-MY` | Intl locale for money amounts. |
| `locale.date_locale` | `NEXT_PUBLIC_KIOSK_DATE_LOCALE` | `en-MY` | Intl locale for record dates ("3 Sep 2027"). |
| `locale.clock_locale` | `NEXT_PUBLIC_KIOSK_CLOCK_LOCALE` | `en-US` | Intl locale for the welcome-screen clock. |
| `locale.currency` | `NEXT_PUBLIC_KIOSK_CURRENCY` | `MYR` | Currency for every fee (ISO 4217). Replaces `mock.currency`, which is still honoured. |

---

## AI services

All five AI services are provided by the **Edge AI Studio** gateway (default
`http://localhost:8080`). Each has a `base_url` (unset = feature off/mocked), a
timeout, and a health check. `GET /api/health` on the kiosk reports the live status of
all of them; any reply below HTTP 500 counts as *up*.

### LLM (document analysis, chat, agent)

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `llm.mock` | `KIOSK_LLM_MOCK` | `false` (yaml) / `true` (code) | Mock the LLM entirely. Any value other than `"false"` means mock. |
| `llm.mock_verdict` | `KIOSK_LLM_MOCK_VERDICT` | `match` | Mocked document-check verdict: `match` \| `mismatch`. |
| `llm.base_url` | `KIOSK_LLM_BASE_URL` | `http://localhost:8080/api/text-generation/v1` | OpenAI-compatible endpoint. Unset disables analysis. Ollama works too: `http://localhost:11434/v1`. |
| `llm.model` | `KIOSK_LLM_MODEL` | `openvino:OpenVINO/Qwen3.5-4B-int4-ov` (yaml) | Model id as known by the gateway. |
| `llm.api_key` | `KIOSK_LLM_API_KEY` | unset | Sent as a Bearer token if set. |
| `llm.timeout_ms` | `KIOSK_LLM_TIMEOUT_MS` | `120000` (yaml) | Request timeout. |
| `llm.max_tokens` | `KIOSK_LLM_MAX_TOKENS` | `2048` | Completion cap. |
| `llm.extra_body` | `KIOSK_LLM_EXTRA_BODY` | `{"chat_template_kwargs":{"enable_thinking":false}}` (yaml) | Extra JSON merged into every request body. |
| `llm.tool_call_shim` | `KIOSK_LLM_TOOL_CALL_SHIM` | `auto` | Text-based tool-call parsing for models without native tool support: `auto` \| `off`. |
| `llm.health_path` | `KIOSK_LLM_HEALTH_PATH` | `/models` | Path appended to `base_url` for health checks. |
| `llm.health_check` | `KIOSK_LLM_HEALTH_CHECK` | `true` | Disable to skip health-gating this service. |

### OCR

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `ocr.base_url` | `KIOSK_OCR_BASE_URL` | `http://localhost:8080/api/ocr` (yaml) | PaddleOCR worker. Unset disables OCR. |
| `ocr.timeout_ms` | `KIOSK_OCR_TIMEOUT_MS` | `60000` | |
| `ocr.dpi` | `KIOSK_OCR_DPI` | `300` | Rasterization DPI (PDFs are rendered with `pdftoppm`). |
| `ocr.health_path` | `KIOSK_OCR_HEALTH_PATH` | `/healthcheck` (yaml) | |
| `ocr.health_check` | `KIOSK_OCR_HEALTH_CHECK` | `true` | |

> LLM **and** OCR being down is fatal for document flows while
> `documents.require_verification: true`; the kiosk shows the out-of-service screen.

### Face recognition

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `face.base_url` | `KIOSK_FACE_BASE_URL` | `http://localhost:8080/api/face-recognition` (yaml) | Unset = simulated face scan. |
| `face.require_match` | `KIOSK_FACE_REQUIRE_MATCH` | `false` | If `true`, a failed/unavailable face match blocks verification. |
| `face.min_similarity` | `KIOSK_FACE_MIN_SIMILARITY` | unset (trust model) | Similarity floor, e.g. `0.4` (OMZ) / `0.363` (SFace). |
| `face.timeout_ms` | `KIOSK_FACE_TIMEOUT_MS` | `30000` | |
| `face.max_frame_bytes` | `KIOSK_FACE_MAX_FRAME_BYTES` | `8000000` | Largest accepted camera frame. |
| `face.photos_dir` | `KIOSK_FACE_PHOTOS_DIR` | `frontend/face-photos` | Where enrolled reference photos are stored. |
| `face.seed_dir` | `KIOSK_FACES_SEED_DIR` | `<cwd>/data/faces` | User-supplied portraits seeded into the registry on first run. Empty by default: the kit ships none. |
| `face.health_path` | `KIOSK_FACE_HEALTH_PATH` | `/healthcheck` | |
| `face.health_check` | `KIOSK_FACE_HEALTH_CHECK` | `true` | |

### Speech-to-text

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `stt.base_url` | `KIOSK_STT_BASE_URL` | `http://localhost:8080/api/speech-to-text/v1` (yaml) | Unset hides the microphone button. |
| `stt.timeout_ms` | `KIOSK_STT_TIMEOUT_MS` | `60000` | |
| `stt.language` | `KIOSK_STT_LANGUAGE` | `en` | |
| `stt.denoise` | `KIOSK_STT_DENOISE` | `false` | |
| `stt.vocabulary` | `KIOSK_STT_VOCABULARY` | unset | Correction hints: `Term=alias\|alias;Term=alias`. |
| `stt.health_path` | `KIOSK_STT_HEALTH_PATH` | `/../healthcheck` (yaml) | |
| `stt.health_check` | `KIOSK_STT_HEALTH_CHECK` | `true` | |

### Text-to-speech

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `tts.base_url` | `KIOSK_TTS_BASE_URL` | `http://localhost:8080/api/text-to-speech/v1` (yaml) | Unset disables read-aloud. |
| `tts.voice` | `KIOSK_TTS_VOICE` | `af_heart` | Kokoro voice id. |
| `tts.speed` | `KIOSK_TTS_SPEED` | `1.3` | |
| `tts.format` | `KIOSK_TTS_FORMAT` | `mp3` | `mp3` \| `wav` \| `opus` \| `flac` \| `pcm`. |
| `tts.max_chars` | `KIOSK_TTS_MAX_CHARS` | `1500` | Longest text sent per request. |
| `tts.timeout_ms` | `KIOSK_TTS_TIMEOUT_MS` | `60000` | |
| `tts.health_path` | `KIOSK_TTS_HEALTH_PATH` | `""` | |
| `tts.health_check` | `KIOSK_TTS_HEALTH_CHECK` | `true` | |

### Spoken languages (chat mode)

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `voice.languages` | `KIOSK_VOICE_LANGUAGES` | unset | Languages the chat kiosk may follow a citizen into, as a mapping of language code → TTS voice. More than one entry (counting the default language) turns on spoken-language detection. |

```yaml
voice:
  languages:
    en: af_heart      # Kokoro American English
    zh: zf_xiaobei    # Kokoro Mandarin
    ms:               # no voice configured — narrated with tts.voice
```

With this set, each recognized utterance is language-detected (an LLM call
against the configured set — see [i18n.md](i18n.md#spoken-language-detection-chat-mode)
for exactly what follows the citizen and what stays in the pack's language).
The detected language becomes the recognizer hint for the next utterance, an
`Always reply in …` instruction on the conversational prompts, and the
narration voice for LLM replies. A language whose voice is left empty is
still detected and replied to, just narrated with the default `tts.voice`.

**Which voices exist depends on the deployed TTS worker.** The default
Kokoro worker keys its voices by prefix: `a`/`b` American/British English
(`af_heart`, `bf_emma`, …), `e` Spanish, `f` French, `h` Hindi, `i` Italian,
`j` Japanese, `p` Portuguese, `z` Mandarin (`zf_xiaobei`). It has no Malay
or Vietnamese voice — the studio's `malaya` worker (VITS voices `Husein`,
`Shafiqah Idayu`, `Anwar Ibrahim`) or the `piper` worker covers those, and
which worker serves `tts.base_url` is a studio `deployment.json` choice.
STT is Whisper (multilingual) and accepts any of the codes; only the
languages listed here are ever chosen, so a deployment with a Kokoro-only
studio simply lists the languages Kokoro can speak.

### Voice behaviour (browser-side)

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `voice.hands_free` | `NEXT_PUBLIC_KIOSK_HANDS_FREE` | on | `"false"` disables hands-free voice mode. |
| `voice.read_aloud` | `NEXT_PUBLIC_KIOSK_READ_ALOUD` | on | Read assistant replies aloud. |
| `voice.wait_for_speech` | `NEXT_PUBLIC_KIOSK_WAIT_FOR_SPEECH` | `false` (yaml) | Wait for TTS to finish before listening again. |
| `voice.barge_in` | `NEXT_PUBLIC_KIOSK_BARGE_IN` | off | `"true"` lets the user interrupt TTS by speaking. |
| `voice.vad_silence_ms` | `NEXT_PUBLIC_KIOSK_VAD_SILENCE_MS` | `1200` | Silence that ends an utterance. |
| `voice.vad_sensitivity` | `NEXT_PUBLIC_KIOSK_VAD_SENSITIVITY` | `2.5` | Voice-activity-detection threshold. |

### Agent mode (MCP)

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `agent.mcp_url` | `KIOSK_MCP_URL` | `/api/mcp` (same server) | MCP endpoint the agent connects to. |
| `agent.turns` | `KIOSK_AGENT_TURNS` | `multi` | `multi` — the model decides after each citizen action, discovering steps through tool calls. `single` — every service's complete step map is fed into the system prompt upfront, so the model plans the whole path, asks for several answers at once and batches them into one flow call (the catalog tools are withheld). |
| `agent.max_steps` | `KIOSK_AGENT_MAX_STEPS` | `8` | Tool-call steps per turn. |
| `agent.stop` | `KIOSK_AGENT_STOP` | chat-template markers | Extra stop sequences (YAML list / comma-joined env). |

---

## Hardware

All peripheral drivers install in one go with `npm run drivers:install` in
`frontend/` (or `./setup.sh --hardware`) — see
[frontend/README.md](../frontend/README.md#peripheral-drivers).

### NFC / PC-SC ID card reader

Requires the PC/SC daemon on Linux: `sudo apt install libpcsclite1 pcscd && sudo systemctl start pcscd`.
Probe your reader with `npm run nfc:probe` (in `frontend/`).

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `nfc.gesture` | `NEXT_PUBLIC_KIOSK_ID_GESTURE` | `insert` | UI wording/animation: `insert` \| `tap`. |
| `nfc.driver` | `KIOSK_NFC_DRIVER` | `pcsc` | `pcsc` (real reader) \| `mock` (never touch hardware; same effect as `simulate: always`). |
| `nfc.simulate` | `KIOSK_NFC_SIMULATE` | `auto` | `auto` (simulate when no reader/bindings) \| `always` \| `never`. |
| `nfc.reader` | `KIOSK_NFC_READER` | first reader | Substring match to pick a specific reader. |
| `nfc.timeout_ms` | `KIOSK_NFC_TIMEOUT_MS` | `30000` | Wait for a card. |
| `nfc.uid_command` | `KIOSK_NFC_UID_COMMAND` | `FFCA000000` | APDU used to read the card serial. |
| `nfc.unknown_card` | `KIOSK_NFC_UNKNOWN_CARD` | `reject` | `reject` unknown serials, or `any` to accept them. |
| `nfc.cards` | `KIOSK_NFC_CARDS` | unset | Card→citizen bindings: `UID=citizen;UID=citizen` (alternative to binding in the CMS). |

### Document scanner (SANE)

Requires `sane-utils` (`scanimage` on PATH) **and**, for the reference
Ricoh/PFU fi-800R, PFU's proprietary `pfufs` SANE backend — the fi Series
Linux driver, which also ships the `pfufsgetscstatus` paper-detect tool
(driver guide: `P2U3-0200-08ENZ0.pdf`). For development
without a scanner, use SANE's virtual `test` backend or `documents.source: mock`.

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `documents.source` | `NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE` | `scanner` (yaml) | `upload` \| `scanner` \| `mock`. `scanner` uses real hardware when present and (with `scanner.simulate: auto`) falls back to the `mocks_dir` stand-ins when not. ⚠️ **Baked in at build time.** |
| `documents.require_verification` | `KIOSK_REQUIRE_DOCUMENT_VERIFICATION` | `true` | Documents must pass OCR + LLM checks. |
| `documents.single_document_per_capture` | `KIOSK_SINGLE_DOCUMENT_PER_CAPTURE` | `true` | One document per scan/upload. |
| `documents.uploads_dir` | `KIOSK_UPLOADS_DIR` | `../assets/pdf` | Where captured PDFs are written. |
| `documents.max_upload_bytes` | `KIOSK_UPLOAD_MAX_BYTES` | `10485760` | Upload size cap (10 MB). |
| `documents.mocks_dir` | `KIOSK_SCANNER_MOCKS` | `../assets/mocks/citizens/1-nadia-rahman/good` (yaml) | Folder the stand-in documents come from (mock mode, or simulated scans). ⚠️ Keep the citizen here consistent with `mock.identity.citizen`. |
| `documents.scanner.bin` | `KIOSK_SCANNER_BIN` | `scanimage` | |
| `documents.scanner.device` | `KIOSK_SCANNER_DEVICE` | first SANE device | e.g. `pfufs:fi-800R:003:004`, or `test:0`. |
| `documents.scanner.resolution` | `KIOSK_SCANNER_RESOLUTION` | driver default (300) | |
| `documents.scanner.mode` | `KIOSK_SCANNER_MODE` | `Color` (yaml) | |
| `documents.scanner.source` | `KIOSK_SCANNER_SOURCE` | `Adf-duplex` (yaml) | |
| `documents.scanner.args` | `KIOSK_SCANNER_ARGS` | `--page-auto=yes --multifeed-detection Stop --blank-page-skip=yes` (yaml) | Extra `scanimage` args. |
| `documents.scanner.timeout_ms` | `KIOSK_SCANNER_TIMEOUT_MS` | `120000` | |
| `documents.scanner.simulate` | `KIOSK_SCANNER_SIMULATE` | `auto` | `auto` \| `always` \| `never`. |
| `documents.scanner.driver` | `KIOSK_SCANNER_DRIVER` | `sane` | `sane` (scanimage) \| `mock` (always stand in a document). |
| `documents.scanner.profile` | `KIOSK_SCANNER_PROFILE` | `fi-800r` | Paper-detection profile: `fi-800r` (PFU status word via `pfufsgetscstatus`) \| `none` (scan immediately — SANE `test:0`, or any scanner without a status tool). `status_bin`/`status_args` override the profile's tool. |
| `documents.scanner.status_bin` | `KIOSK_SCANNER_STATUS_BIN` | `pfufsgetscstatus` | Paper-detect helper (fi-800R). |
| `documents.scanner.status_args` | `KIOSK_SCANNER_STATUS_ARGS` | `""` | |
| `documents.scanner.wait_ms` | `KIOSK_SCANNER_WAIT_MS` | `30000` | Wait for paper (0 = don't wait). |
| `documents.scanner.poll_ms` | `KIOSK_SCANNER_POLL_MS` | `2000` | Paper-poll interval (min 1000). |

### Camera

Used for face verification. `NEXT_PUBLIC_KIOSK_CAMERA_TIMEOUT_MS` (default `12000`)
bounds how long the UI waits for `getUserMedia`.

> Packaged-app gotcha: WebKitGTK asks for camera permission with a native prompt — on
> a kiosk nobody is there to click it. If the identity step can't open the camera in
> the packaged app, this is the first thing to check.

---

## CMS / database

The admin dashboard is Payload CMS backed by SQLite (`frontend/db.sqlite`). The
database is created and seeded automatically on first run (100 synthetic citizens from
`data/citizens.csv`, matching fines, and the admin user). No reference portraits ship
with the kit — drop your own into `data/faces/` to seed them. Reset the database any
time with `npm run db:reset` in `frontend/`.

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `cms.kiosk_key` | `KIOSK_CMS_KEY` | `dev-kiosk-key` | Shared secret external REST callers (tests, scripts) send as `x-kiosk-key`. The kiosk itself uses Payload's in-process Local API. |
| `cms.payload_secret` | `PAYLOAD_SECRET` | _(generated)_ | Payload signing secret, used for the `/admin` session cookie. Blank in every committed profile: the first boot mints a crypto-random one into `.payload-secret` beside the database (`KIOSK_DATA_DIR` in a packaged kiosk, `frontend/` in a checkout), so nothing is shared between installs and none of it is committed. Set your own to pin it; changing it signs everyone out. |
| `cms.database_url` | `DATABASE_URL` | `file:./db.sqlite` | libSQL connection string. |
| `cms.admin_email` | `PAYLOAD_ADMIN_EMAIL` | `admin@demo.local` | Seeded admin login. |
| `cms.admin_password` | `PAYLOAD_ADMIN_PASSWORD` | _(generated)_ | Seeded admin password. Every launcher fills it in the gitignored `frontend/config.yaml` with one crypto-random value (`scripts/ensure-admin-password.mjs`) and prints it once; set your own to keep it. The committed profiles carry no password, so a `KIOSK_CONFIG_FILE=configs/<profile>.yaml` run seeds no admin user — put one in `frontend/configs/config.local.yaml` if you need `/admin` there. |
| `cms.citizens_csv` | `KIOSK_CITIZENS_CSV` | `<cwd>/data/citizens.csv` | Citizen registry seed file. |

---

## Mock & demo settings

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `mock.currency` | `KIOSK_CURRENCY` | `MYR` | Currency code for fees/fines. |
| `mock.processing_fee` | `KIOSK_PROCESSING_FEE` | `2` | Flat processing fee. |
| `mock.latency_ms` | `KIOSK_MOCK_LATENCY_MS` | `900` | Artificial API latency for demo realism. |
| `mock.identity.read_ms` | `KIOSK_IDENTITY_READ_MS` | `2800` | Simulated card-read duration. |
| `mock.identity.scan_ms` | `KIOSK_IDENTITY_SCAN_MS` | `2300` | Simulated document-scan duration. |
| `mock.identity.citizen` | `KIOSK_READER_CITIZEN` | `1` (yaml; unset = random) | Which registry citizen the simulated reader returns. ⚠️ Must match the person in `documents.mocks_dir` or the LLM holder check fails. |

---

## Prompt overrides

Eleven system prompts can be overridden via env vars (or `prompts:` keys in
config.yaml); defaults live in
[frontend/src/app/api/_lib/prompts.ts](../frontend/src/app/api/_lib/prompts.ts).
`{{services}}` is templated with the live service catalog.

`KIOSK_PROMPT_ASSISTANT`, `KIOSK_PROMPT_AGENT`, `KIOSK_PROMPT_AGENT_SINGLE`, `KIOSK_PROMPT_DOCUMENT`,
`KIOSK_PROMPT_ADDRESS_PROOF`, `KIOSK_PROMPT_RELATIONSHIP_PROOF`,
`KIOSK_PROMPT_GROUP_CAPTURE`, `KIOSK_PROMPT_ROUTE_SERVICE`,
`KIOSK_PROMPT_EXTRACT_ANSWERS`, `KIOSK_PROMPT_REPAIR_TRANSCRIPT`,
`KIOSK_PROMPT_DETECT_LANGUAGE`.

---

## Env-only variables

These have no `config.yaml` key — set them in the environment:

| Env var | Default | Purpose |
|---|---|---|
| `KIOSK_CONFIG_FILE` | `frontend/config.yaml` | Load a different settings file — e.g. `configs/simulated.yaml`. A profile is read whole, *not* layered over `config.yaml`; the `config.local.yaml` beside **it** is what merges on top. |
| `KIOSK_STANDALONE` | unset | `1` makes `next build` emit a standalone server (used by the Tauri packager). |
| `KIOSK_DATA_DIR` | unset | Writable data directory for the packaged app (set by the Tauri shell). |
| `KIOSK_PORT` | random free port | Pin the packaged app's local server port. |
| `PORT` / `HOSTNAME` | `3000` / — | Standard Next.js server variables. |
| `NEXT_PUBLIC_KIOSK_CAMERA_TIMEOUT_MS` | `12000` | Camera acquisition timeout. |
| `KIOSK_PORTRAIT_MAX_BYTES` | `8388608` | Enrollment portrait size cap. |
| `APPIMAGE_EXTRACT_AND_RUN` | set by packager | Run AppImages on FUSE3-only hosts. |

---

## Build-time vs runtime settings

Almost everything is read **at startup on the terminal** — change the YAML/env and
restart. A handful of settings are **baked into the frontend at build time** (they are
`NEXT_PUBLIC_*` values inlined by `next build`):

- `terminal.mode` (`NEXT_PUBLIC_KIOSK_MODE`) — touch / chat / agent
- `documents.source` (`NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE`) — upload / scanner / mock
- `country.pack` (`NEXT_PUBLIC_KIOSK_PACK`) — which country pack the terminal serves
- `locale.language` (`NEXT_PUBLIC_KIOSK_LANG`) and the other `locale.*` display settings
- `nfc.gesture` (`NEXT_PUBLIC_KIOSK_ID_GESTURE`) — insert / tap

To change either of these in a production build or a packaged desktop app you must
rebuild (see [build.md](build.md)).
