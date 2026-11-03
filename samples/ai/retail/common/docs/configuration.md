# ⚙️ Configuration Reference

Everything the blueprint can be configured with, where those settings live, and how they
override each other.

- [How configuration is resolved](#how-configuration-is-resolved)
- [The settings page](#the-settings-page)
- [Launcher script configuration](#launcher-script-configuration)
- [Core settings](#core-settings) (API, terminal mode, session)
- [AI services](#ai-services) (LLM, OCR, face, speech)
- [Hardware](#hardware) (NFC reader, document scanner, camera)
- [CMS / database](#cms--database)
- [Mock & demo settings](#mock--demo-settings)
- [Healthcare-only settings](#healthcare-only-settings)
- [Prompt overrides](#prompt-overrides)
- [Env-only variables](#env-only-variables)
- [When a change takes effect](#when-a-change-takes-effect)

---

## How configuration is resolved

All kiosk settings are read through one loader, each kiosk's
`frontend/src/lib/kiosk-config.ts` ([public-service](../../public-service-kiosk/frontend/src/lib/kiosk-config.ts),
[healthcare](../../healthcare-service-kiosk/frontend/src/lib/kiosk-config.ts)), with this
precedence (highest wins):

1. **Real environment variables** — shell exports, CI variables.
2. **`<kiosk>/frontend/config.local.yaml`** — your machine-local overrides. Gitignored,
   layered key-by-key on top of `config.yaml`. **This is the recommended place for
   your own settings.**
3. **`<kiosk>/frontend/config.yaml`** — this terminal's own settings. **Gitignored**: the
   launchers copy it out of the kiosk's `frontend/configs/`
   ([public-service](../../public-service-kiosk/frontend/configs/),
   [healthcare](../../healthcare-service-kiosk/frontend/configs/)) on the first
   run (`--profile`, default `reference`) and generate its admin password there, so
   no credential ever reaches git. Until one exists, the loader falls back to the
   committed `configs/reference.yaml`, the default profile; this page documents
   each of its keys.
4. **Code fallbacks** — hardcoded defaults in the source.

Every YAML key maps 1:1 to an environment variable (listed in the tables below), so
anything you can put in YAML you can also set as an env var — useful for one-off runs:

```bash
KIOSK_LLM_MOCK=true npm run dev
```

A minimal `<kiosk>/frontend/config.local.yaml` for a machine **without** the Edge AI Studio
gateway (fully mocked, zero external dependencies):

```yaml
llm:
  mock: true
documents:
  require_verification: false
  scanner:
    simulate: auto
nfc:
  simulate: auto
ocr:
  base_url: "" # blank = intentionally off; a configured-but-unreachable
face: #         service would fail /api/health (out-of-service screen)
  base_url: ""
  require_match: false
```

> **Note:** the `reference` profile ships with `llm.mock: false`, i.e. it expects a
> live LLM gateway on `http://127.0.0.1:8080`, and is strict about hardware
> (`nfc.simulate` and `documents.scanner.simulate` are `never`,
> `face.require_match` is `true`). Without the gateway (and without the
> override above) the kiosk shows its out-of-service screen. The `./common/scripts/dev/dev.sh --mock` and
> `./start.sh --mock` launchers set the mock variables for you.

The config file location itself can be overridden with `KIOSK_CONFIG_FILE=/path/to/config.yaml`.

---

## The settings page

**`/settings`** edits this terminal's `config.yaml` from the browser — behind the
same CMS admin login as the registration desk, and linked from the admin nav
("Kiosk settings"). Two tabs:

- **Settings** — a form over the documented keys, section by section
  (`frontend/src/lib/settings-schema.ts`: [public-service](../../public-service-kiosk/frontend/src/lib/settings-schema.ts),
  [healthcare](../../healthcare-service-kiosk/frontend/src/lib/settings-schema.ts)).
  A blank field leaves the code default in place. Every key is editable — a
  change takes effect on the next restart ([below](#when-a-change-takes-effect));
  keys that `config.local.yaml` sets are marked as overridden.
- **config.yaml** — the file itself, for the prompts, the CMS credentials and
  anything else without a field. Saving keeps every comment; the previous
  version is kept beside it as `config.yaml.bak`, and keys the kiosk does not
  know are reported (and ignored, as at start).

Settings are read once, at start, so a save shows up as *"N saved settings the
running kiosk does not have yet"* until the kiosk restarts — the **Restart
kiosk** button does that: the server exits with code **77** and whatever
started it starts it again, then the page reloads into the new server. Every
way this kit runs the kiosk handles that code: `next dev` (its own restart
code), `npm run start` (its wrapper `scripts/with-kiosk-env.mjs` re-runs the
server — so `./start.sh` / `start_win.bat` too), the packaged desktop app and
the studio worker of the embedded bundle (`common/scripts/bundle/worker-start.*`),
each of which announces itself with `KIOSK_SUPERVISED=1`. A bare `next start`
is not supervised: the page then says to restart by hand. In the embedded
bundle the studio is the other way to do it — the kiosk service is hidden from
the studio's Services page, but its sample page carries a Stop / Start button
for it.

Which file it edits is the one the loader reads — `<kiosk>/frontend/config.yaml` in a
checkout, `<data dir>/kiosk-studio/workers/<studio.sampleId>/data/config.yaml` in a
`./setup.sh --build` package, `<data dir>/config.yaml` in the standalone desktop shell (see
[build.md](build.md#deploying-a-kiosk-terminal)). It never writes the committed
`configs/reference.yaml` a fresh checkout falls back to; run a launcher once to
create the real file. The route behind it is `GET`/`PUT /api/staff/settings`
and `POST /api/staff/settings/restart`.

---

## Launcher script configuration

The launcher scripts (`setup`, `start`, `build` and `common/scripts/dev` — `.sh` on Linux,
`.bat` → `common/scripts/win/*.ps1` on Windows) read their own settings from environment
variables, or from an optional gitignored **`common/.kioskrc`** file (a plain
shell file, sourced by the bash scripts and parsed line by line by the
PowerShell ones, before defaults are applied). Relative paths in these settings
resolve against `common/`, wherever you run the launcher from:

```bash
# .kioskrc — local launcher settings (not committed)
EDGE_AI_STUDIO_DIR="../../edge-ai-demo-studio"
STUDIO_AUTOSTART=1
```

| Variable | Default | Purpose |
|---|---|---|
| `EDGE_AI_STUDIO_DIR` | `../../edge-ai-demo-studio` from `common/` (a sibling of this repo) | Path to the Edge AI Studio checkout. Setup builds it from here; start/dev launch it from here. |
| `STUDIO_AUTOSTART` | `1` | Set to `0` to never launch the studio: `./start.sh` then only waits for its gateway (as with `--wait-studio`), and `common/scripts/dev/dev.sh` just probes it (as with `--no-studio`). |
| `STUDIO_URL` | `http://127.0.0.1:8080` | Where the studio gateway is expected. Used for the pre-flight health check. |
| `STUDIO_WAIT_SECS` | `600` | How long `start`/`dev` wait for the studio gateway to become healthy before giving up (first launch loads AI models, which is slow). |
| `STUDIO_RUN_MODE` | `auto` | How the studio is launched: `auto` (packaged executable if built, else headless), `packaged` (require the executable from the studio's own `scripts/bash/package.sh`), `headless` (always the studio's `start.sh` server — no app window; right for servers/CI). |
| `STUDIO_DEPLOYMENT_FILE` | *(unset)* | One fixed file the launchers and the embedded-bundle build install as the studio's `deployment.json`, instead of the one they assemble from each kiosk's own `<kiosk>/deployment.json` for its terminal mode (see [Getting started](getting-started.md#the-edge-ai-studio-prerequisite)). Either way the checkout's previous file is kept as `.bak`; set `STUDIO_DEPLOYMENT_MANAGE=0` to keep a hand-managed file untouched. |
| `STUDIO_DEPLOYMENT_MANAGE` | `1` | Set `0` to never touch the studio's `deployment.json`. |
| `STUDIO_LLAMACPP_BACKEND` | `sycl` | The llama.cpp build the studio's Linux setup installs for its multiserve engine: `sycl` (Intel GPUs) or `vulkan`. `./setup.sh`, `./setup.sh --bundle` and a packaged desktop app's first launch pass it on, so the studio setup doesn't ask. Setting it when launching the AppImage changes that app's choice. The studio's Windows setup has no such choice. |
| `KIOSKS` | *(the saved choice)* | Which kiosks the root `./setup.sh`, `./start.sh` and `./uninstall.sh` (and `common/scripts/build.sh`) drive: `kiosk.json` ids or folder names, comma separated, or `all` — the same values `--kiosk` takes (the flag wins). Unset, they follow `common/.kiosks`, the gitignored list `./setup.sh` saves (one kiosk id per line; edit or delete it freely), else `public-service`. |
| `KIOSK_DIR` | *(unset)* | Pins one kiosk, bypassing `KIOSKS` and the saved choice: a repo-root folder holding `kiosk.json` and `frontend/`, by name or absolute path. Each kiosk folder's own launchers (`healthcare-service-kiosk/scripts/start.sh`, …) set it, and so does `common/scripts/dev/dev.sh --kiosk <name>`; without either, `common/scripts/dev/dev.sh` and the bundler default to `public-service-kiosk`. |
| `KIOSK_PROFILE` | `reference` | Which `<kiosk>/frontend/configs/<name>.yaml` the launchers copy to `<kiosk>/frontend/config.yaml` on a checkout that has none (also `./setup.sh --profile <name>`). An existing `config.yaml` is never replaced — delete it to re-pick. |
| `KIOSK_NODE_VERSION` | `v22.18.0` | Portable Node.js release `./setup.sh` falls back on when the machine has no Node ≥ 20 (also `./setup.sh --node-version <v>`). Matches the version the Edge AI Studio unpacks. |
| `KIOSK_NODE_DIR` | `common/thirdparty/node` | Where that portable Node is unpacked. Every launcher prepends its `bin/` to `PATH` when a binary is there, so it also carries `npm`. Gitignored; delete the directory to go back to the machine's Node. |
| `KIOSK_NODE_MIRROR` | `https://nodejs.org/dist` | Where the portable Node and its `SHASUMS256.txt` are downloaded from. Point it at an internal mirror on an air-gapped terminal. |
| `KIOSK_BUNDLE_DIR` | `build/kiosk-studio` | Where `./start.sh --bundle` looks for the [embedded studio bundle](embedded-studio.md) — one studio carrying every chosen kiosk (`build/` is at the repo root). |
| `KIOSK_BUNDLE_PORT` | `kiosk.json` `studio.port` | Port the embedded kiosk listens on inside a one-kiosk bundle (set when the bundle is exported — `./setup.sh --build` / `common/scripts/bundle.mjs`); with several kiosks each keeps its own `studio.port`. |
| `PORT` | `kiosk.json` `"port"` | Port `./start.sh` and `common/scripts/dev/dev.sh` serve on: public-service 3000, healthcare 3001 (also `--port`). With several kiosks it is the first one's port and the rest count up from it. |

Command-line flags always beat `.kioskrc` and env vars. See each script's `--help`.

The desktop shell additionally understands an **external-target mode** (used by
`./start.sh --bundle --desktop`): `KIOSK_SHELL_URL` (window target; the shell skips
spawning its own server), `KIOSK_SHELL_KIOSK_URL` and `KIOSK_SHELL_PLATFORM_URL`
(where the staff menu's *Kiosk* and *Platform* entries point, when they are not the
window target itself), `KIOSK_SHELL_CMD` + `KIOSK_SHELL_CWD` (optional command to
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

YAML keys live in `<kiosk>/frontend/config.yaml` (copied from `<kiosk>/frontend/configs/`); the env
var is the equivalent override.

### API, terminal & session

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `api.base_url` | `NEXT_PUBLIC_KIOSK_API_URL` | `/api` | API base URL used by the browser. Point at a remote backend to split UI and server. |
| `terminal.mode` | `NEXT_PUBLIC_KIOSK_MODE` | `chat` (yaml) | `touch` \| `chat`. UI interaction style. Chat is a tool-calling model driving the kiosk's own MCP server, so it needs a live LLM. |
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
| `country.pack` | `NEXT_PUBLIC_KIOSK_PACK` | `malaysia` | Which country pack this terminal serves. |
| `locale.language` | `NEXT_PUBLIC_KIOSK_LANG` | `en` | BCP-47 tag: `<html lang>`, STT hint, case folding. |
| `locale.money_locale` | `NEXT_PUBLIC_KIOSK_MONEY_LOCALE` | `en-MY` | Intl locale for money amounts. |
| `locale.date_locale` | `NEXT_PUBLIC_KIOSK_DATE_LOCALE` | `en-MY` | Intl locale for record dates ("3 Sep 2027"). |
| `locale.clock_locale` | `NEXT_PUBLIC_KIOSK_CLOCK_LOCALE` | `en-US` | Intl locale for the welcome-screen clock. |
| `locale.currency` | `NEXT_PUBLIC_KIOSK_CURRENCY` | `MYR` | Currency for every fee (ISO 4217). Replaces `mock.currency`, which is still honoured. |

---

## AI services

All five AI services are provided by the **Edge AI Studio** gateway (default
`http://127.0.0.1:8080`). Each has a `base_url` (unset = feature off/mocked), a
timeout, and a health check. `GET /api/health` on the kiosk reports the live status of
all of them; any reply below HTTP 500 counts as *up*, except the studio's 404 for an
instance it does not have.

The studio addresses every service by instance, `/api/<type>@<instance>/…`; a bare
`/api/<type>/…` answers 404. The yaml defaults name the instances each kiosk's
`deployment.json` pins: `kiosk-llm`, `kiosk-stt`, `kiosk-tts-en` and `kiosk-avatar`
(ids shared with other kiosk projects on the same studio, which then reuse them
rather than start a second LLM), `ocr` and `face-recognition`. The studio never
renames an instance, and a pinned id it does not have takes over the type's oldest
instance under that one's id, so a studio set up before the ids were pinned
(`text-generation@text-generation`) keeps its old addresses: delete those instances on
its Services page and restart it. Any other instance is addressed by its own id, which
the Services page shows.

**Behind a proxy.** The kiosk server sends its outbound calls — a remote LLM such as
Gemini, the notification webhook — through the system proxy: `https_proxy` /
`http_proxy` (either case) in the environment it starts with, `/etc/environment` for
a desktop session. Loopback (`localhost`, `127.0.0.1`, `::1`) is added to `no_proxy`
by the kiosk, the launchers and the desktop shell, so the studio on `127.0.0.1:8080`
is always reached directly. A proxy set only in the desktop's network settings is not
seen by the server; put it in `/etc/environment`.

### LLM (document analysis, chat)

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `llm.mock` | `KIOSK_LLM_MOCK` | `false` (yaml) / `true` (code) | Mock the LLM entirely. Any value other than `"false"` means mock. |
| `llm.mock_verdict` | `KIOSK_LLM_MOCK_VERDICT` | `match` | Mocked document-check verdict: `match` \| `mismatch`. |
| `llm.base_url` | `KIOSK_LLM_BASE_URL` | `http://127.0.0.1:8080/api/text-generation@kiosk-llm/v1` | OpenAI-compatible endpoint. Unset disables analysis. Ollama works too: `http://127.0.0.1:11434/v1`. |
| `llm.model` | `KIOSK_LLM_MODEL` | `llamacpp:unsloth/gemma-4-E4B-it-GGUF:Q4_K_M` (yaml) | Model id as known by the gateway. A touch build ships `gemini-3.5-flash-lite` (see [build.md](build.md#the-build)). |
| `llm.api_key` | `KIOSK_LLM_API_KEY` | unset | Sent as a Bearer token if set. Gemini and OpenAI with no key report the LLM `off`. |
| `llm.timeout_ms` | `KIOSK_LLM_TIMEOUT_MS` | `120000` (yaml) | Request timeout. |
| `llm.max_tokens` | `KIOSK_LLM_MAX_TOKENS` | `2048` | Completion cap. |
| `llm.extra_body` | `KIOSK_LLM_EXTRA_BODY` | `{"chat_template_kwargs":{"enable_thinking":true}}` (yaml) | Extra JSON merged into every request body. Gemma 4 E4B needs thinking on to call the chat tools reliably; Gemini rejects `chat_template_kwargs`. The kiosk turns an `enable_thinking` set here off where it decides nothing — document checks, and the chat steps that relay a flow's result or make a call the screen already settled — so the agent thinks only while working out what was said. |
| `llm.tool_call_shim` | `KIOSK_LLM_TOOL_CALL_SHIM` | `auto` | Text-based tool-call parsing for models without native tool support: `auto` \| `off`. |
| `llm.health_path` | `KIOSK_LLM_HEALTH_PATH` | `/models` | Path appended to `base_url` for health checks. |
| `llm.health_check` | `KIOSK_LLM_HEALTH_CHECK` | `true` | Disable to skip health-gating this service. |

### OCR

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `ocr.base_url` | `KIOSK_OCR_BASE_URL` | `http://127.0.0.1:8080/api/ocr@ocr` (yaml) | PaddleOCR worker. Unset disables OCR. |
| `ocr.timeout_ms` | `KIOSK_OCR_TIMEOUT_MS` | `60000` | |
| `ocr.dpi` | `KIOSK_OCR_DPI` | `300` | Rasterization DPI (PDFs are rendered with `pdftoppm`). |
| `ocr.health_path` | `KIOSK_OCR_HEALTH_PATH` | `/healthcheck` (yaml) | |
| `ocr.health_check` | `KIOSK_OCR_HEALTH_CHECK` | `true` | |

> LLM **or** OCR being down is fatal for document flows while
> `documents.require_verification: true`; the kiosk shows the out-of-service screen.

### Face recognition

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `face.base_url` | `KIOSK_FACE_BASE_URL` | `http://127.0.0.1:8080/api/face-recognition@face-recognition` (yaml) | Unset = simulated face scan. |
| `face.require_match` | `KIOSK_FACE_REQUIRE_MATCH` | `false` | If `true`, a failed/unavailable face match blocks verification. |
| `face.min_similarity` | `KIOSK_FACE_MIN_SIMILARITY` | unset (trust model) | Similarity floor, e.g. `0.4` (OMZ) / `0.363` (SFace). |
| `face.timeout_ms` | `KIOSK_FACE_TIMEOUT_MS` | `30000` | |
| `face.max_frame_bytes` | `KIOSK_FACE_MAX_FRAME_BYTES` | `8000000` | Largest accepted camera frame. |
| `face.photos_dir` | `KIOSK_FACE_PHOTOS_DIR` | `<kiosk>/frontend/face-photos` | Where enrolled reference photos are stored. |
| `face.seed_dir` | `KIOSK_FACES_SEED_DIR` | `<cwd>/data/faces` | User-supplied portraits seeded into the registry on first run. Empty by default: the kit ships none. |
| `face.health_path` | `KIOSK_FACE_HEALTH_PATH` | `/healthcheck` | |
| `face.health_check` | `KIOSK_FACE_HEALTH_CHECK` | `true` | |

### Speech-to-text

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `voice.stt.base_url` | `KIOSK_STT_BASE_URL` | `http://127.0.0.1:8080/api/speech-to-text@kiosk-stt/v1` (yaml) | Unset hides the microphone button. |
| `voice.stt.timeout_ms` | `KIOSK_STT_TIMEOUT_MS` | `60000` | |
| `voice.stt.language` | `KIOSK_STT_LANGUAGE` | `auto` | `auto`: Whisper detects each utterance's language (sent as `language=auto`; with a single spoken language the kiosk sends that one instead). A code (`en`) pins it, and is also the language every session starts in. |
| `voice.stt.denoise` | `KIOSK_STT_DENOISE` | `false` | Noise suppression before Whisper (OVMS backend only). |
| `voice.stt.vocabulary` | `KIOSK_STT_VOCABULARY` | unset | Correction hints: `Term=alias\|alias;Term=alias`. |
| `voice.stt.health_path` | `KIOSK_STT_HEALTH_PATH` | `/../healthcheck` (yaml) | |
| `voice.stt.health_check` | `KIOSK_STT_HEALTH_CHECK` | `true` | |

**Listening.** The browser listens the way the pmjb kiosk does: the microphone
runs as 16 kHz mono frames of 32 ms, Silero VAD (v6, ONNX Runtime Web on one
CPU thread) scores each frame, and an endpointer cuts the utterances — speech
starts after 160 ms above `voice.vad_threshold`, keeps the 300 ms before it,
and ends after `voice.vad_silence_ms` below a lower bar, with a 160 ms tail of
the silence kept for Whisper. Each utterance goes up as a 16-bit WAV to
`POST /api/speech/transcribe`, and from there to `/audio/transcriptions` with
`response_format=verbose_json`. Recognition starts at the utterance's first
240 ms pause: when the citizen stays quiet, that transcript is the one used,
ready before the closing silence is over; when they go on, its request is
aborted. The model and runtime are served from `public/vad/`, which
`scripts/vad-assets.mjs` fills before every `npm run dev|build|start` (the
runtime from `node_modules/onnxruntime-web`, the model downloaded once from
the pinned Silero release); without them the browser cuts utterances by
loudness against the room's noise floor (`voice.vad_sensitivity`) instead.

The language is Whisper's: see [Spoken languages](#spoken-languages-chat-mode).
Only the studio's OEP backend (`metadata.sttBackend: oep`, the default) names
the language it heard; on the OVMS and MERaLiON backends the session keeps its
language. Chat mode's `deployment.json` runs Whisper large-v3-turbo on OEP:
Whisper base's language identification is too unreliable for Malay,
Indonesian or Vietnamese.

### Text-to-speech

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `voice.tts.base_url` | `KIOSK_TTS_BASE_URL` | `http://127.0.0.1:8080/api/text-to-speech@kiosk-tts-en/v1` (yaml) | Unset disables read-aloud. |
| `voice.tts.voice` | `KIOSK_TTS_VOICE` | `af_heart` | Kokoro voice id: the pack's own language, and every language without a voice of its own. |
| `voice.tts.speed` | `KIOSK_TTS_SPEED` | `1.3` | |
| `voice.tts.format` | `KIOSK_TTS_FORMAT` | `mp3` | `mp3` \| `wav` \| `opus` \| `flac` \| `pcm`. |
| `voice.tts.max_chars` | `KIOSK_TTS_MAX_CHARS` | `1500` | Longest text sent per request. |
| `voice.tts.timeout_ms` | `KIOSK_TTS_TIMEOUT_MS` | `60000` | |
| `voice.tts.health_path` | `KIOSK_TTS_HEALTH_PATH` | `""` | |
| `voice.tts.health_check` | `KIOSK_TTS_HEALTH_CHECK` | `true` | |

### Lip-synced avatar (chat mode)

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `voice.avatar.base_url` | `KIOSK_AVATAR_BASE_URL` | `http://127.0.0.1:8080/api/lipsync@kiosk-avatar/v1` (yaml) | The studio's lipsync instance. Unset: no avatar tile; replies play from the page. |
| `voice.avatar.timeout_ms` | `KIOSK_AVATAR_TIMEOUT_MS` | `60000` | |
| `voice.avatar.health_path` | `KIOSK_AVATAR_HEALTH_PATH` | `""` (yaml: `/../healthcheck`) | |
| `voice.avatar.health_check` | `KIOSK_AVATAR_HEALTH_CHECK` | `true` | |

With the instance up, the chat's assistant panel shows a real person streamed
by the lipsync worker (Wav2Lip) over WebRTC, and every reply is said by it: the
kiosk server synthesizes the reply with the voice of its language
(`voice.languages`, else `voice.tts.voice`; as WAV) a sentence or two at a time and hands each piece to the worker
(`POST /api/avatar/say`, answered as NDJSON, one line per piece), which queues
them and lip-syncs them into the stream. The voice is heard from the stream, in
step with the lips, under a second after the first piece is handed over. The browser negotiates the stream through
`/api/avatar/offer` (the worker admits only the studio's own origins), and the
media then flows directly between the browser and the worker, so the two must
reach each other; on one machine they meet on its LAN address. The browser
starts connecting as soon as the avatar is configured, without waiting for the
health poll to see the worker up, so a worker still loading at boot is picked up
within seconds of answering. While the stream connects, the tile holds a
softened still of the person (`/api/avatar/preview`, which the browser keeps a
day). Until the stream is up, or if it drops, the tile says it is not connected
and replies play from the page; the browser keeps retrying, and starts over at
once when the network changes. The face is the
worker's sample person; upload another on the studio's Lipsync page. Like voice,
the avatar is report-only in `/api/health`: it never takes the kiosk out of
service.

### Spoken languages (chat mode)

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `voice.languages` | `KIOSK_VOICE_LANGUAGES` | unset | Languages the chat kiosk may follow a citizen into, as a mapping of language code → voice. More than one entry (counting the default language) turns on spoken-language detection. |

```yaml
voice:
  languages:
    en: af_heart                          # Kokoro, on voice.tts
    zh: zf_xiaobei
    ms:                                   # blank: the language's default voice (below)
    vi: Ngọc Huyền@text-to-speech-vi      # another voice, on another studio instance
    id: male_1@http://10.0.0.5:8080/api/text-to-speech@tts-id/v1   # or any base URL
```

A voice is a voice id on `voice.tts`, or `voice@instance` for one on another
of the studio's text-to-speech instances — the instance id is put into
`voice.tts.base_url`'s address in place of its own — or `voice@<base URL>`.
The YAML form `ms: { voice: Husein, instance: text-to-speech-ms }` is the same.
A blank voice is the language's default:

| Code | Language | Default voice | Studio worker | Instance (chat `deployment.json`) |
|---|---|---|---|---|
| `en` | English | `af_heart` (`voice.tts.voice` for the pack's language) | Kokoro | `voice.tts` |
| `zh` `es` `fr` `hi` `it` `ja` `pt` | Mandarin, Spanish, French, Hindi, Italian, Japanese, Portuguese | `zf_xiaobei` `ef_dora` `ff_siwis` `hf_alpha` `if_sara` `jf_alpha` `pf_dora` | Kokoro | `voice.tts` |
| `ms` | Malay | `Shafiqah Idayu` (also `Husein`, `Anwar Ibrahim`) | `malaya` | `text-to-speech-ms` |
| `id` | Indonesian | `female_1` (also `female_2`, `male_1`, `male_2`) | `pocket-tts` | `text-to-speech-id` |
| `vi` | Vietnamese | `Trúc Ly` (25 VieNeu presets, northern and southern) | `vieneu` | `text-to-speech-vi` |
| `ta` | Tamil | `tamil_female` (also `tamil_male`) | `fastspeech2-hs` | `text-to-speech-ta` |

Any other code Whisper knows works with a voice spelled out — the studio's
`piper` worker has voices for dozens more languages; a language with neither
is still detected and replied to, and narrated with `voice.tts.voice`. Chat
mode's `deployment.json` starts the four extra instances (all on the CPU, each
faster than real time); a language whose instance is not running is shown but
not read aloud.

Each utterance's language is the one Whisper names (the studio's OEP backend
reports it — see [i18n.md](i18n.md#spoken-language-detection-chat-mode) for
what follows the citizen and what stays in the pack's language). It becomes an
`Always reply in …` instruction on the conversational prompts and picks the
narration voice for LLM replies. Every language listed is one more Whisper may
land on when it misjudges a short utterance — short Malay is sometimes heard as
Portuguese or Spanish — so list the languages the kiosk's visitors speak, not
every one there is a voice for.

### Voice behaviour

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `voice.hands_free` | `NEXT_PUBLIC_KIOSK_HANDS_FREE` | on | `"false"` disables hands-free voice mode. |
| `voice.read_aloud` | `NEXT_PUBLIC_KIOSK_READ_ALOUD` | on | Read assistant replies aloud. |
| `voice.wait_for_speech` | `NEXT_PUBLIC_KIOSK_WAIT_FOR_SPEECH` | `false` (yaml) | Wait for TTS to finish before listening again. |
| `voice.barge_in` | `NEXT_PUBLIC_KIOSK_BARGE_IN` | off | `"true"` lets the user interrupt TTS by speaking. |
| `voice.vad_silence_ms` | `NEXT_PUBLIC_KIOSK_VAD_SILENCE_MS` | `800` | Silence that ends an utterance (see *Listening* above). Recognition already starts at the first 240 ms pause, so a longer value costs no recognition time — only the wait before the turn is sent. |
| `voice.vad_threshold` | `NEXT_PUBLIC_KIOSK_VAD_THRESHOLD` | `0.5` | Silero speech probability (0–1) that starts an utterance; a frame is silence below it minus 0.15. Lower hears quieter speech, and more noise. |
| `voice.vad_sensitivity` | `NEXT_PUBLIC_KIOSK_VAD_SENSITIVITY` | `2.5` | Only when the Silero model cannot load: how many times the measured noise floor counts as speech. |

### Chat agent (MCP)

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `agent.mcp_url` | `KIOSK_MCP_URL` | `/api/mcp` (same server) | MCP endpoint the agent connects to. |
| `agent.turns` | `KIOSK_AGENT_TURNS` | `single` | `single` — every service's steps, fields and accepted values are fed into the system prompt upfront, so the model starts the right service at once with everything the citizen already said and needs only the two flow tools (the catalog tools are withheld). `multi` — the model sees one line per service and discovers the rest through tool calls. |
| `agent.max_steps` | `KIOSK_AGENT_MAX_STEPS` | `8` | Tool-call steps per turn. |
| `agent.stop` | `KIOSK_AGENT_STOP` | chat-template markers | Extra stop sequences (YAML list / comma-joined env). |

---

## Hardware

All peripheral drivers install in one go with `npm run drivers:install` in
`<kiosk>/frontend/` (or `./setup.sh --hardware`) — see each kiosk's `frontend/README.md`
([public-service](../../public-service-kiosk/frontend/README.md#peripheral-drivers),
[healthcare](../../healthcare-service-kiosk/frontend/README.md#peripheral-drivers)).

### NFC / PC-SC ID card reader

Requires the PC/SC daemon on Linux: `sudo apt install libpcsclite1 pcscd && sudo systemctl start pcscd`.
Probe your reader with `npm run nfc:probe` (in `<kiosk>/frontend/`).

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
| `documents.source` | `NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE` | `scanner` (yaml) | `upload` \| `scanner` \| `mock`. `scanner` uses real hardware when present and (with `scanner.simulate: auto`) falls back to stand-in documents when not. |
| `documents.require_verification` | `KIOSK_REQUIRE_DOCUMENT_VERIFICATION` | `true` | Documents must pass OCR + LLM checks. |
| `documents.single_document_per_capture` | `KIOSK_SINGLE_DOCUMENT_PER_CAPTURE` | `true` | Each document is checked on its own pages. A scan holding different documents is refused on touch; in chat (public-service) it is split and each document filed under the open requirement it satisfies, with anything not needed left out. `false` checks a whole scan as one document. |
| `documents.uploads_dir` | `KIOSK_UPLOADS_DIR` | `../assets/pdf` | Where captured PDFs are written. |
| `documents.max_upload_bytes` | `KIOSK_UPLOAD_MAX_BYTES` | `10485760` | Upload size cap (10 MB). |
| `documents.mocks_dir` | `KIOSK_SCANNER_MOCKS` | public-service: `../assets/mocks/citizens/1-nadia-rahman/good`; healthcare: blank (yaml) | Folder the stand-in documents come from (mock mode, or simulated scans). ⚠️ public-service: keep the citizen here consistent with `mock.identity.citizen`. Healthcare: leave it blank and a simulated scan is the mock paperwork of whoever verified at the terminal, generated on the spot ([patient-journey.md](../../healthcare-service-kiosk/docs/patient-journey.md#test-documents-and-simulated-peripherals)); a folder here is used instead. |
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

Used for face verification.

| Key | Env var | Default | Meaning |
|---|---|---|---|
| `camera.timeout_ms` | `NEXT_PUBLIC_KIOSK_CAMERA_TIMEOUT_MS` | `12000` | How long the UI waits for `getUserMedia` before offering the camera-free check. |

---

## CMS / database

The admin dashboard is Payload CMS backed by SQLite (`<kiosk>/frontend/db.sqlite`). The
database is created and seeded automatically on first run (100 synthetic citizens from
`data/citizens.csv`, public-service's traffic fines, and the admin user). No reference portraits ship
with the kit — drop your own into `data/faces/` to seed them. Reset the database any
time with `npm run db:reset` in `<kiosk>/frontend/`.

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `cms.kiosk_key` | `KIOSK_CMS_KEY` | `dev-kiosk-key` | Shared secret external REST callers (tests, scripts) send as `x-kiosk-key`. The kiosk itself uses Payload's in-process Local API. |
| `cms.payload_secret` | `PAYLOAD_SECRET` | _(generated)_ | Payload signing secret, used for the `/admin` session cookie. Blank in every committed profile: the first boot mints a crypto-random one into `.payload-secret` beside the database (`KIOSK_DATA_DIR` in a packaged kiosk, `<kiosk>/frontend/` in a checkout), so nothing is shared between installs and none of it is committed. Set your own to pin it; changing it signs everyone out. |
| `cms.database_url` | `DATABASE_URL` | `file:./db.sqlite` | Connection string the adapter opens. libSQL (`file:`, `libsql:`, `http(s):`, `ws(s):`) for the SQLite adapter. |
| `cms.database_adapter` | `DATABASE_ADAPTER` | _(from the URL scheme)_ | Which Payload database adapter runs: `sqlite`, `postgres` or `mongodb`. Left unset, the `database_url` scheme decides. Only `sqlite` is built into the kit — see below. |
| `cms.admin_email` | `PAYLOAD_ADMIN_EMAIL` | `admin@demo.local` | The admin login. Created on the first start; a changed email creates a further account. |
| `cms.admin_password` | `PAYLOAD_ADMIN_PASSWORD` | _(generated)_ | The admin password. Every launcher fills it in the gitignored `<kiosk>/frontend/config.yaml` with one crypto-random value (`common/scripts/ensure-admin-password.mjs`) and prints it once; set your own to keep it. **The account follows this value on every start**: change it here (or on the settings page) and restart, and the new password is the login — a password changed inside `/admin` lasts until the next restart. The committed profiles carry no password, so a `KIOSK_CONFIG_FILE=configs/<profile>.yaml` run seeds no admin user — put one in `<kiosk>/frontend/configs/config.local.yaml` if you need `/admin` there. |
| `cms.citizens_csv` | `KIOSK_CITIZENS_CSV` | `<cwd>/data/citizens.csv` | Citizen registry seed file. |

### Running on another database

`<kiosk>/frontend/src/payload/db.ts` is the only place the database is chosen. Its `DRIVERS`
table maps an adapter name to the npm package that provides it and to the URL schemes
that select it; `cms.database_adapter` names the entry, and `cms.database_url` is
handed to it.

SQLite is the only adapter the kit installs, so `postgres` and `mongodb` are declared
but have no `build` — selecting either fails at boot naming the package it wants
rather than quietly opening the wrong database. To move the registry onto Postgres:

```bash
cd <kiosk>/frontend && npm install @payloadcms/db-postgres
```

then give the `postgres` entry a `build` in `src/payload/db.ts`:

```ts
build: (url) => postgresAdapter({ pool: { connectionString: url } }),
```

and point the config at it:

```yaml
cms:
  database_adapter: postgres
  database_url: postgres://kiosk:secret@127.0.0.1:5432/kiosk
```

`config.yaml` alone decides this — no launcher sets `DATABASE_URL` any more. A relative
`file:` URL is resolved inside the kiosk's writable data directory (`KIOSK_DATA_DIR`) on
a packaged install and beside the server in a checkout, so the shipped
`file:./db.sqlite` means the right thing in both without anything overriding it. The env
vars in the table above still win when set, which is how `common/electron/scripts/build.mjs`
seeds the packaged template at build time.

Nothing else in the kiosk talks to the database directly — the collections in
`src/payload/collections/` and every API route go through Payload's Local API. Two
things outside it still assume a SQLite file and want attention on a server database:
the launchers copy a seeded `db.sqlite` into the data directory on first run, and
`npm run mocks:gen` reads the registry directly (it skips any non-`file:` URL).

Both keys are on the `/settings` page under **CMS & database**, so a running terminal can
be repointed without editing the file by hand.

---

## Mock & demo settings

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `mock.currency` | `KIOSK_CURRENCY` | `MYR` | Currency code for fees/fines. |
| `mock.processing_fee` | `KIOSK_PROCESSING_FEE` | `2` | Flat processing fee. |
| `mock.latency_ms` | `KIOSK_MOCK_LATENCY_MS` | `900` | Artificial API latency for demo realism. |
| `mock.clinics_always_open` | `NEXT_PUBLIC_KIOSK_CLINICS_ALWAYS_OPEN` | `false` | Healthcare only. `true`: on a day they consult, every specialist offers every half-hour left today, at any hour, so a same-day visit can be booked, checked in, paid and collected in one demo. `false`: today offers only what is left of a doctor's real clinic times ([patient-journey.md](../../healthcare-service-kiosk/docs/patient-journey.md#bookings-and-appointment-slips)). |
| `mock.identity.read_ms` | `KIOSK_IDENTITY_READ_MS` | `2800` | Simulated card-read duration. |
| `mock.identity.scan_ms` | `KIOSK_IDENTITY_SCAN_MS` | `2300` | Simulated document-scan duration. |
| `mock.identity.citizen` | `KIOSK_READER_CITIZEN` | `1` (yaml; unset = random) | Which registry citizen the simulated reader returns. ⚠️ public-service: must match the person in `documents.mocks_dir` or the LLM holder check fails. Healthcare: staff can put any patient's card on the simulated reader from `/mock-documents`. |

---

## Healthcare-only settings

| YAML key | Env var | Default | Purpose |
|---|---|---|---|
| `wayfinding.start` | `NEXT_PUBLIC_KIOSK_WAYFINDING_START` | the map's default start (`a-l2-information-counter`) | Map place id where this kiosk stands. |
| `wayfinding.search` | `NEXT_PUBLIC_KIOSK_WAYFINDING_SEARCH` | `astar` | Route search: `astar` \| `dijkstra`. |
| `modules.disabled` | `NEXT_PUBLIC_KIOSK_MODULES_DISABLED` | unset | Module ids to switch off (YAML list or comma string) — see [modules.md](../../healthcare-service-kiosk/docs/modules.md). |
| `modules.only` | `NEXT_PUBLIC_KIOSK_MODULES_ONLY` | unset (every part) | Run just these modules and what they need. |
| `queue.visit_minutes` | `KIOSK_QUEUE_VISIT_MIN` | `12` | Minutes per consultation, for the clinic queue's wait estimates. |
| `barcode.driver` | `KIOSK_BARCODE_DRIVER` | `hid` | `hid` (keyboard wedge typing into the page) \| `serial` (USB-CDC scanner the server reads) \| `mock` (simulated scans). |
| `barcode.device` | `KIOSK_BARCODE_DEVICE` | `/dev/ttyACM0` | Serial device, for the `serial` driver only. |
| `printer.enabled` | `NEXT_PUBLIC_KIOSK_PRINTER_ENABLED` | `true` | `false` hides every Print button on the kiosk, the browser's included, and the printer is never probed. Read at start-up: restart, no rebuild. |
| `printer.driver` | `KIOSK_PRINTER_DRIVER` | `off` | `escpos` (an ESC/POS thermal printer prints the patient card and appointment slip) \| `mock` (printing is pretended) \| `off` (Print uses the browser dialog). |
| `printer.device` | `KIOSK_PRINTER_DEVICE` | `usb` | `usb` (the first USB printer), a device path (`/dev/usb/lp0`, a Windows `\\?\USB#…` interface), part of one (`VID_0483&PID_7540`), or `tcp://host:9100`. |
| `printer.width_dots` | `KIOSK_PRINTER_WIDTH_DOTS` | `576` | Printable width in dots: `576` for 80 mm paper, `384` for 58 mm. |
| `notify.driver` | `KIOSK_NOTIFY_DRIVER` | `outbox` | Booking confirmations (SMS and email), lab results by email, payment receipts and arrival notes to the clinic: `outbox` keeps them on this terminal for staff at `/outbox`, `webhook` POSTs each one as JSON, `off` sends nothing. |
| `notify.webhook_url` | `KIOSK_NOTIFY_WEBHOOK_URL` | unset | Where `webhook` posts: the hospital's SMS gateway, mail relay or integration engine. |

The barcode scanner reads MRN cards and signed slips — see
[patient-journey.md](../../healthcare-service-kiosk/docs/patient-journey.md#barcode-scanner-setup). The receipt
printer prints them — see
[patient-journey.md](../../healthcare-service-kiosk/docs/patient-journey.md#receipt-printer-setup).

---

## Prompt overrides

Seven system prompts can be overridden via env vars (or `prompts:` keys in
config.yaml); defaults live in each kiosk's
`frontend/src/app/api/_lib/prompts.ts` ([public-service](../../public-service-kiosk/frontend/src/app/api/_lib/prompts.ts),
[healthcare](../../healthcare-service-kiosk/frontend/src/app/api/_lib/prompts.ts)).
`{{services}}` is templated with the live service catalog; healthcare's agent
prompts also take `{{calendar}}` — today's date and the next two weeks.

`KIOSK_PROMPT_AGENT`, `KIOSK_PROMPT_AGENT_SINGLE`, `KIOSK_PROMPT_DOCUMENT`,
`KIOSK_PROMPT_ADDRESS_PROOF`, `KIOSK_PROMPT_RELATIONSHIP_PROOF`,
`KIOSK_PROMPT_GROUP_CAPTURE`, `KIOSK_PROMPT_REPAIR_TRANSCRIPT`.

---

## Env-only variables

These have no `config.yaml` key — set them in the environment:

| Env var | Default | Purpose |
|---|---|---|
| `KIOSK_CONFIG_FILE` | `<kiosk>/frontend/config.yaml` | Load a different settings file — e.g. `configs/simulated.yaml`. A profile is read whole, *not* layered over `config.yaml`; the `config.local.yaml` beside **it** is what merges on top. |
| `KIOSK_STANDALONE` | unset | `1` makes `next build` emit a standalone server (used by the desktop packager). |
| `KIOSK_DATA_DIR` | unset | Writable data directory for the packaged app (set by the desktop shell). |
| `KIOSK_PORT` | random free port | Pin the packaged app's local server port. |
| `PORT` / `HOSTNAME` | `kiosk.json` `"port"` / — | Standard Next.js server variables. The launchers set `PORT`; healthcare's `npm run dev`/`start` fill it from `kiosk.json` when unset (public-service's `kiosk.json` port is Next's own default, 3000). |
| `KIOSK_PORTRAIT_MAX_BYTES` | `8388608` | Enrollment portrait size cap. |

---

## When a change takes effect

Every setting is read **at startup on the terminal**: change the YAML (or the
environment), restart, done. Nothing in `config.yaml` needs a rebuild — not
`terminal.mode`, not `documents.source`, not the country pack.

The `NEXT_PUBLIC_*` half of the table is the part the browser reads, and Next
would normally freeze those into the JavaScript bundle at `next build`. It does
not here: the kiosk layout serves the live values with each page
(`frontend/src/components/kiosk-env.tsx`) and the browser reads them through
`frontend/src/lib/public-config.ts` (public-service:
[kiosk-env.tsx](../../public-service-kiosk/frontend/src/components/kiosk-env.tsx),
[public-config.ts](../../public-service-kiosk/frontend/src/lib/public-config.ts);
healthcare: [kiosk-env.tsx](../../healthcare-service-kiosk/frontend/src/components/kiosk-env.tsx),
[public-config.ts](../../healthcare-service-kiosk/frontend/src/lib/public-config.ts)), so a
packaged build picks up whatever `config.yaml` says on the terminal it runs on.

A restart is still needed because `config.yaml` is copied into the environment
once, when the server boots. `/settings` has the button; supervised installs
(the desktop shell, the studio worker, `npm run start`) restart themselves —
see [the settings page](#the-settings-page).

One consequence for new code: anything browser-side must read these through
`publicEnv()` **during render**, never into a module-scope constant — the
served values do not exist yet when modules are first evaluated.
