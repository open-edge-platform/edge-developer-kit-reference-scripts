# Development Guide

## Overview

**Demo Studio** is an AI demo platform with a Next.js frontend that orchestrates Python-based AI worker services (embedding, speech-to-text, text-to-speech, image generation, etc.). The frontend manages service lifecycle, health monitoring, and provides interactive demo UIs for each AI capability.

---

## Prerequisites

- **Node.js** v20+ (bundled in `thirdparty/node/`) ([Install natively](https://nodejs.org/en/download) preferable)
- **UV** package manager (downloaded automatically by `workers/setup.sh`)
- **FFmpeg** (bundled in `thirdparty/ffmpeg/`)

---

## Quick Start

### Full Setup (all components)

```bash
# From the project root
./setup.sh
```

This runs setup scripts for **Workers**, **Frontend**, and optionally **Electron**. Logs are written to `logs/setup/`. Use flags or environment variables to customize (run `./setup.sh --help` for the full list):

```bash
./setup.sh --skip-workers             # Skip worker setup
./setup.sh --skip-frontend            # Skip frontend setup
./setup.sh --enable-electron          # Also set up Electron (skipped by default)
./setup.sh --skip-llm --skip-tts      # Skip individual worker groups
./setup.sh --verbose                  # Print output to terminal instead of log files
./setup.sh --continue-on-error        # Don't stop on first failure
./setup.sh --backend vulkan           # Pick the llama.cpp backend without prompting

# Environment-variable form; accepts true/false, 1/0 or yes/no
SkipWorkers=true SkipFrontend=1 BackendChoice=vulkan ./setup.sh
```

See [Unattended setup (CI)](#unattended-setup-ci) for the full flag reference
and the non-interactive behaviour.

### Unattended setup (CI)

Both root scripts never block on a prompt when there is no TTY, so they can run
unattended in CI and Docker builds. A typical job:

```bash
sudo ./install_dependencies.sh -y                    # system packages + drivers
./setup.sh --backend sycl --continue-on-error        # or: --vulkan
```

An explicit `--backend sycl` is honoured or the setup fails: the multiserve
setup installs the SYCL runtime wheels (the `llamacpp-sycl` dependency group in
`workers/pyproject.toml`) and checks with `ldd -r` that the downloaded
llama.cpp build loads on them. It never quietly falls back to Vulkan, so a CI
job cannot pass while testing the wrong backend. The Intel oneAPI Toolkit is
not used.

#### `install_dependencies.sh`

| Flag | Effect |
| --- | --- |
| `-y`, `--yes` | Install the GPU/NPU drivers without asking. |
| `-n`, `--no` | Skip the driver installation. |
| `-h`, `--help` | List the options. |

The old `--oneapi` and `--no-oneapi` flags are ignored, and `--oneapi-only`
exits without installing anything.

Without a TTY the driver step needs `-y` or `-n`, otherwise the script exits with
an error rather than guessing. `DEBIAN_FRONTEND=noninteractive` is exported
automatically in non-interactive mode.

#### `setup.sh`

| Flag | Effect |
| --- | --- |
| `--backend sycl\|vulkan` (or `--sycl`, `--vulkan`) | Pick the llama.cpp backend without prompting. |
| `--skip-workers`, `--skip-frontend`, `--skip-electron`, `--enable-electron` | Choose which service setups run. Electron is skipped by default. |
| `--skip-stt`, `--skip-embedding`, `--skip-llm`, `--skip-tts` | Legacy flags; worker dependencies are installed on first start. |
| `--continue-on-error` | Run every setup even if one fails; the exit code is still non-zero. |
| `-v`, `--verbose` | Stream output to the terminal instead of `logs/setup/`. |
| `-h`, `--help` | List the options. |

Without `--backend` and without a TTY, the selection saved in
`workers/engines/multiserve/.llamacpp-backend` is kept, or `vulkan` is used when
there is none.

Each flag also has an environment-variable form (`SkipWorkers`, `SkipFrontend`,
`SkipElectron`, `Verbose`, `ContinueOnError`, `BackendChoice`) that accepts
`true`/`false`, `1`/`0` or `yes`/`no`:

```bash
BackendChoice=vulkan SkipFrontend=1 ./setup.sh
```

### Frontend Only

```bash
cd frontend
npm install
npm run dev        # Starts dev server on http://127.0.0.1:8080
```

### Workers Only

```bash
cd workers
./setup.sh         # Downloads UV, OVMS, FFmpeg, then installs each worker
```

Each worker can also be set up individually:

```bash
cd workers/<name>
./setup.sh
```

### Starting the Application

```bash
# Development (hot-reload)
cd frontend
npm run dev

# Production
cd frontend
npm run build
npm run start
```

The dev server runs on **port 8080** by default.

---

## Project Structure

### Monorepo Layout

```
├── frontend/          Next.js 16 app (App Router) + Payload CMS
├── workers/           Standalone Python FastAPI services
├── models/            Downloaded model files
├── logs/              Service and setup logs
├── thirdparty/        Bundled binaries (Node.js, FFmpeg, qmassa, UV, OVMS)
├── electron/          Electron desktop wrapper (optional)
├── scripts/           Root-level build/packaging scripts
├── docs/              Documentation
├── setup.sh           Root setup script (Linux/macOS)
└── start.sh           Root start script (Linux/macOS)
```

### Frontend (`frontend/`)

```
frontend/src/
├── app/                       App Router routes
│   ├── (dashboard)/           Main UI pages
│   │   ├── services/          Service catalog and detail pages
│   │   ├── samples/           Use case / sample pages
│   │   └── settings/          Settings page
│   └── api/                   API route handlers
│       ├── services/          Service CRUD & lifecycle
│       ├── devices/           Hardware detection
│       ├── logs/              Log streaming
│       ├── mcp-servers/       MCP server management
│       └── system-info/       OS/device info
├── components/
│   ├── ui/                    shadcn/ui primitives
│   ├── common/                Generic shared pieces: tones, notices, dialogs, param fields
│   ├── configure/             Configure-sheet primitives
│   ├── shell/                 App shell: dashboard shell, workspace header, page heading
│   ├── sidebar/               Navigation sidebar and command palette
│   ├── services/              Service management: service cards, new-instance sheet, instance lifecycle
│   ├── samples/               Samples gallery and sample pages
│   └── dashboard/             Overview widgets
├── context/                   React context providers
│   ├── providers.tsx                Every app-wide provider
│   ├── service-status-context.tsx   Polls service state (5s interval)
│   ├── sample-instances-context.tsx Which instance of each service the shown sample uses
│   ├── system-info-context.tsx      OS/device detection
│   ├── query-provider.tsx           TanStack React Query provider
│   └── theme-provider.tsx           Theme management
├── engines/                   Inference engine abstraction
│   ├── multiserve/            OpenVINO Model Server engine
│   ├── _generated/            Auto-generated registry (do not edit)
│   ├── registry.ts            Engine registry
│   └── types.ts               Engine/EngineBackend types
├── services/                  Service definitions
│   ├── <name>/                One folder per service
│   │   ├── data.ts            ServiceMeta + optional WorkerConfig
│   │   ├── demo.tsx           Demo UI component
│   │   ├── metrics.tsx        Figures of the demo's Live metrics panel (optional)
│   │   ├── in-use.ts          When a built-in service is listed in the sidebar (optional)
│   │   ├── config.ts          Available models, devices, sources
│   │   └── hooks/             Service-specific hooks
│   ├── common/                Shared across multiple services
│   ├── _generated/            Auto-generated registries (do not edit)
│   ├── types.ts               Core Service types
│   └── config-registry.ts     Service type and engine option lists for Payload fields
├── samples/                   Use case / sample definitions
│   ├── <name>/                One folder per sample
│   │   ├── data.ts            Sample metadata
│   │   ├── demo.tsx           Sample demo component
│   │   └── lib/               Helpers used only by this sample (and its own API route)
│   ├── common/                Shared across samples
│   ├── _generated/            Auto-generated registry (do not edit)
│   └── types.ts               Sample types
├── hooks/                     Global React hooks
├── lib/                       Shared utilities and app plumbing (used across
│   │                          services, samples, engines, routes and Payload)
│   ├── constants.ts           Paths (WORKER_DIR, MODELS_DIR, etc.)
│   ├── logger.ts              Logging utility (replaces console.*)
│   ├── utils.ts               cn() helper, misc utilities
│   ├── app-boot.ts            Startup work once Payload is up: row sync, deployment.json, health poller
│   ├── api/                   Route handler contract: zod body parsing, { error } responses, ApiError
│   ├── browser/               Browser helpers: fetch-json, toast-error, download, poll, format
│   ├── instances/             Pure instance helpers: instances, service-status, service-metadata, cpu-affinity
│   ├── workers/               Server-side worker lifecycle: process-handler, health/ (poller, probes), instance-ports, instance-seed
│   ├── system/                Host checks and hardware utilisation: system-monitoring, docker, can-bind, port-checker
│   ├── settings/              The app-settings and sample-settings globals and their stores
│   ├── deployment/            deployment.json import and the export tooling
│   └── llm/                   Text generation plumbing shared by the chat route: reasoning-parsers, sentence-processor, mcp-tools
├── payload/                   Payload CMS config
│   ├── collections/           Database collections
│   │   └── Services.ts        Service schema + lifecycle hooks
│   ├── globals/               App and sample settings globals
│   └── migrations/            Auto-generated SQLite migrations
├── types/                     Shared TypeScript types
├── payload.config.ts          Payload CMS configuration
└── payload-types.ts           Auto-generated Payload types (do not edit)
```

### Workers (`workers/`)

```
workers/
├── pyproject.toml             uv workspace root: one uv.lock, one .venv for every member
├── common/                    worker-common (shared FastAPI/argparse/devices/audio/OVMS helpers, see workers/common/README.md)
│   ├── downloader/            model-downloader: model fetching (OEP model-download, ModelScope, URLs, ovms --pull)
│   └── ovms-export/           the optimum-cli environment `ovms --pull` converts with (own .venv)
├── services/<name>/           One folder per worker service
│   ├── main.py                FastAPI app entrypoint (built on worker_common)
│   ├── pyproject.toml         UV-managed dependencies (workspace member)
│   ├── start.sh               Linux/macOS start script
│   └── start.ps1              Windows start script
├── engines/multiserve/        OpenVINO Model Server / llama.cpp integration
├── suites/                    Open Edge Platform suite apps (docker compose, Linux only)
├── scripts/                   worker-common.sh / .ps1, sourced by every start script
├── oep-services.json          Catalogue of upstream code: OEP microservices + pinned tag, vendored git sources + pinned refs
├── oep-setup.sh / .ps1        Fetches what the catalogue lists (list / check / fetch / pin)
├── thirdparty/                Bundled tools (UV, OVMS), the edge-ai-libraries cache and the git/<name> source caches
├── setup.sh                   Master worker setup script
└── setup.ps1                  Master worker setup (Windows)
```

#### OEP-backed workers, vendored sources and custom workers

A worker directory is one of four kinds. Run `workers/oep-setup.sh`
(`oep-setup.ps1` on Windows) to list them; `check` also compares every pin
with what is on disk.

| Kind | Declared by | Upstream source | Runs as |
|---|---|---|---|
| Custom | nothing | code in this repository | native `uv` process |
| OEP microservice | a `services` entry in [`workers/oep-services.json`](../workers/oep-services.json) | one service of [`open-edge-platform/edge-ai-libraries`](https://github.com/open-edge-platform/edge-ai-libraries), copied at the catalogue's `tag` into `<worker>/thirdparty/<name>/` (gitignored) by `workers/oep-setup.sh` from its one sparse clone under `workers/thirdparty/edge-ai-libraries` | native `uv` process, no container |
| Custom worker with a vendored package | a `sources` entry in the same catalogue | a plain git repository (`hexgrad/kokoro`, `mesolitica/malaya`, `pnnbao97/VieNeu-TTS`) at a pinned commit or tag, sparse-cloned under `workers/thirdparty/git/<name>` and copied next to the worker, patched (`kokoro.patch`), taken by path in `pyproject.toml` (malaya) or imported from the worker directory without its package's dependencies (vieneu); never a uv git dependency, whose full clone would sit in the uv cache | native `uv` process |
| OEP suite app | `suite.env` with `EDGE_AI_SUITES_REF` | one app of [`open-edge-platform/edge-ai-suites`](https://github.com/open-edge-platform/edge-ai-suites), sparse git clone at that tag into `<app>/src/` by the suite's `setup.sh`/`.ps1` | `docker compose`; docker only, so `supportedOS: ['linux']` and `requiresDocker: true` in `data.ts` gray the service out on Windows |

`workers/oep-services.json` is the single place to maintain for the
microservices: the pinned release tag and a list of services, one object each:

```json
{
  "$schema": "./oep-services.schema.json",
  "repository": "https://github.com/open-edge-platform/edge-ai-libraries.git",
  "tag": "2026.2.1",
  "services": [
    { "worker": "services/speech-to-text/oep", "name": "audio-analyzer",
      "subdir": "microservices/audio-analyzer", "sentinel": "pipeline.py" },
    { "worker": "services/vectordb", "name": "document-ingestion",
      "subdir": "microservices/document-ingestion/pgvector",
      "sentinel": "app/document.py", "home_env": "OEP_DOCUMENT_INGESTION_HOME" }
  ]
}
```

`worker` (the directory under `workers/`) and `subdir` are required; `name`,
`sentinel`, `dir`, `home_env` and a per-service `tag` are optional. The copy
lands in `<worker>/thirdparty/<name>` unless `dir` says otherwise, and carries
the tag it was made from in `.demo-studio-edge-ai-libraries-ref`; `home_env`
names a variable that points at a directory already holding the microservice
(for hacking on upstream), used as is and never fetched into.

A `sources` entry adds `repository` and `ref` (a commit or tag) of its own,
plus optionally `keep_root` (copy the repository's top-level files too, for a
buildable path dependency), `patch` and `patch_strip` (a diff applied to the
copy):

```json
  "sources": [
    { "worker": "services/text-to-speech/kokoro", "name": "kokoro",
      "repository": "https://github.com/hexgrad/kokoro.git", "ref": "dfb907a0…",
      "subdir": "kokoro", "dir": "kokoro", "sentinel": "__init__.py",
      "patch": "kokoro.patch", "patch_strip": 2 }
  ]
```

Every key is described in
[`workers/oep-services.schema.json`](../workers/oep-services.schema.json).
`oep-setup.sh` (via `python3`), `oep-setup.ps1` and `worker_common.oep` all
read this one file. Each worker start fetches its own source before syncing
dependencies, so path dependencies exist when uv uses them. Each such
worker's README lists what Demo Studio changes in its copy.

```bash
workers/oep-setup.sh                    # list catalogued services, sources, suite apps, custom workers
workers/oep-setup.sh check              # exit 1 if a copy is missing or at another pin
workers/oep-setup.sh fetch <worker>     # what start scripts run (oep_fetch); also fetch --all
workers/oep-setup.sh info <worker>      # resolved paths and pins
workers/oep-setup.sh pin <tag>          # bump the edge-ai-libraries "tag" in oep-services.json, then fetch --all
```

Rules for OEP-backed workers:

- **Upstream source is never committed or edited in place.** The copy is
  gitignored and remade from the cache whenever its tag differs from the pin;
  the cache itself is only ever moved between tags.
- **The catalogue is the pin.** `EDGE_AI_LIBRARIES_REF` (microservices) and
  `EDGE_AI_SUITES_REF` (suite apps) override it for one run without editing
  the repository, for example to try a newer release.
- **Overrides live in separate files.** In the order they apply: a `patch`
  named in the catalogue entry (`git apply` right after the copy is made,
  `kokoro.patch`); files under `<worker>/overlay/` (or `overlay/<name>/`)
  copied over the copy on every fetch, a last resort no worker uses today
  (a replaced file also hides upstream's changes to it on a tag bump);
  upstream's own documented settings set as environment variables with
  `setdefault` before upstream is imported, so a value from the shell or
  `deployment.json` wins; and in-memory replacements by the wrapper
  (`main.py`, `utils/oep_upstream.py`). Suite apps write patched configs next
  to `start.sh` and mount them through a generated `compose.override.yml`.
  Record every one of them, and any dependency that deviates from upstream's
  pins, in the worker's README and `pyproject.toml` comments.
- **Native first.** A wrapper `main.py` imports the upstream FastAPI app and
  adds only the worker contract (`--port/--model/--device`, `/healthcheck`,
  models under `models/`) through `worker_common.oep`. Only when upstream
  cannot run outside containers (the DL Streamer based suites) is docker
  used, and then the service is Linux-only in the frontend.
- **Model downloads go through `model_downloader`.** Every worker fetches
  weights with `fetch_snapshot` / `fetch_file` / `fetch_url` / `fetch_omz_ir`
  / `ovms_pull` from the shared `workers/common/downloader` package (the OEP
  model-download microservice used as a library for Hugging Face, the
  `modelscope` SDK for ModelScope, one `ovms --pull` runner), never
  `huggingface_hub`, `modelscope` or the `ovms` binary directly.

Adding a worker that wraps an OEP microservice (the generic worker steps are
in [`workers/README.md`](../workers/README.md#adding-a-worker)):

1. Add an object to `services` in `workers/oep-services.json`.
2. Create `workers/services/<name>/` with `main.py` (imports the upstream app
   through `worker_common.oep`, adds `--port/--model/--device` and
   `/healthcheck`), `pyproject.toml` (upstream `requirements.txt` on the
   workspace's standardized versions), an optional `overlay/`, and
   `.gitignore` with `/thirdparty`.
3. In `start.sh` / `start.ps1`, call `oep_fetch <name>` /
   `Invoke-OepFetch <name>` before `run_worker` / `Start-Worker`.
4. Wire the frontend. A worker that sits next to built-in workers of the same
   service is picked by model (`workerSubDir: (doc) => ...`, text-to-speech)
   or by a backend stored in the service metadata and switched with a button
   group at the top of the Runtime Settings sheet (`metadata.sttBackend`,
   speech-to-text: `workers/services/speech-to-text/oep` next to `.../ovms`).
   A worker that sits next to a multiserve **engine** is a second execution
   mode instead: `execution: { mode: ['multiserve', 'worker'], options: [...] }`
   in `data.ts`, the service's stored `engine` decides, and the Runtime
   Settings sheet opens on engine tabs that swap the rest of the sheet to the
   chosen engine's settings (`EngineTabs`; `embeddings` and
   `workers/services/embeddings`).

---

## Tech Stack

### Frontend

| Technology | Purpose |
|---|---|
| Next.js 16 | App Router, React Server Components |
| React 19 | UI framework (React Compiler enabled) |
| TypeScript 5 | Type safety |
| Tailwind CSS 4 | Utility-first styling |
| shadcn/ui (New York) | Component library (Radix UI + lucide icons) |
| Payload CMS 3.x | Database + admin (SQLite backend) |
| TanStack React Query | Data fetching and server state |
| AI SDK | LLM streaming integration |

### Workers

| Technology | Purpose |
|---|---|
| Python 3.11+ | Runtime |
| FastAPI + Uvicorn | HTTP server |
| UV | Package manager (replaces pip) |
| OVMS | OpenVINO Model Server |
| Pytorch XPU | Pytorch model with XPU support |
| HuggingFace  | Model ecosystem |

---

## Commands Reference

All frontend commands run from the `frontend/` directory:

```bash
npm run dev          # Start dev server (port 8080)
npm run build        # Production build (stop dev server first — .next/lock conflict)
npm run start        # Start production server
npm run lint         # ESLint check + TypeScript type check
npm run lint:fix     # ESLint auto-fix
npm run codegen      # Regenerate service/sample/engine registries
npm run db:reset     # Reset the SQLite database
npm run test         # Every Playwright project (hours: the full preset × device matrix)
npm run test:ui      # Run Playwright tests with UI (port 8081)
```

**Always run `npm run lint` before committing.**

---

## Architecture

### Service Lifecycle

Services follow this status flow:

```
inactive → prepare → active
              ↓
            error
```

With `restart` as a transition state (`active → restart → prepare → active`).

- **Start/Stop**: `PATCH /api/services/[id]` with `{ action: "start" | "stop" | "restart" }`
- **Process management**: Payload CMS hooks in `src/payload/collections/hooks/service-hooks.ts` call `src/lib/workers/worker-lifecycle.ts`, which spawns/kills processes via `src/lib/workers/process-handler.ts`
- **Health checks**: A background service polls worker endpoints every 10 seconds using JSONata-based response validation (`src/lib/workers/health/` — `probes.ts`, `status.ts`, `poller.ts`)
- **UI polling**: `ServiceStatusContext` polls `/api/services` every 5 seconds for live status updates

### Execution Modes

Services run in one of two execution modes:

| Mode | Description |
|---|---|
| `"worker"` | Standalone FastAPI process spawned and managed by the frontend |
| `"multiserve"` | Served through a shared OpenVINO Model Server engine |
| `"none"` | No backend process (frontend-only service, e.g., MCP Manager) |

### API Proxying

Workers have no fixed ports and services have no fixed address. `next.config.ts` rewrites `/api/<service-name>@<instanceId>/*` to the proxy route handler `app/api/instance-proxy/[instance]/[...path]`, which looks the instance's current port up in the `services` collection (cached briefly, invalidated by the collection hooks) and streams the request to `http://127.0.0.1:<port>/*`. A stopped instance answers 503. A bare `/api/<service-name>/*` is not an address: it answers 404 listing the service's instance addresses. Browser code takes the address from the enriched service (`service.apiBase`, or `useServiceApiBase(type)` for a type's running instance); a worker calling a sibling service asks `GET /api/services/address?type=<type>` (via `EDGE_AI_STUDIO_URL`), because which instance is running, and its id, can change. Server-side code that must call a worker directly uses `getWorkloadEndpoint()` from `src/lib/workers/instance-lookup.ts`; a few browser features that cannot go through an HTTP proxy (the STT WebSocket, the file-watcher WebSocket, the suites' HTTPS UIs) read the live port from the enriched service (`service.instancePort`).

The proxy's timeout (**Settings → Proxy Timeout**, 300 s by default) bounds how long a worker may go **without sending anything** — while an upload streams to it, while it works on an answer, and between two chunks of that answer — not the whole call: every chunk in either direction restarts it. A stream that keeps sending (tokens, audio, progress events, MJPEG frames) runs for as long as it needs, while a call that stays silent past the timeout answers 504. Server-side fetches to workers pass `untimedDispatcher` (`lib/workers/untimed-dispatcher.ts`) so Node's own hidden 300 s header and body-gap limits do not cut a call short first.

### Long-running calls: streams and status events

A call that can run for tens of seconds or more does not answer once at the end. Either its output streams as it is produced, or it runs as a background job whose status the client follows as a stream. Both use Server-Sent Events (`event: <name>` plus one `data:` line of JSON) from `worker_common.sse`, which also sends keep-alive comments while the worker is busy between two events, so the proxy timeout above never fires on a working stream:

| Shape | Worker | Browser |
|---|---|---|
| **Output stream** — the answer itself arrives in pieces (TTS audio per sentence, OCR-VL tokens, vector DB ingestion progress). Opt-in per request, so API clients keep the one-shot JSON; the final event carries what the one-shot answer would have. | `sse_response(generator)` — a plain generator runs in the threadpool, so it may block on model work | `readSse(body)` / `readSseJson(body)` (`lib/browser/sse.ts`) |
| **Job status events** — the request returns a job at once; `GET …/events` next to the job's poll endpoint sends its status whenever it changes and ends after the final one. The poll endpoint stays for API clients. | `sse_response(watch_status(read, is_final))` | `followStatusEvents(url, { onStatus, isFinal, signal })` |
| **Push stream** — one long-lived stream of live state in place of fast polling. | `sse_response(async generator)` | `readSseJson(body)`, one shared connection per instance |

Where each is used:

| Service | Shape | Endpoint |
|---|---|---|
| text-to-speech (all four workers) | output stream: audio per sentence as it is synthesized — `stream: true` sends WAV (placeholder sizes) / PCM / per-sentence MP3 or AAC; `stream_format: "sse"` sends `speech.audio.delta` then `speech.audio.done` (`duration`, `perf`) | `POST /v1/audio/speech` |
| ocr (PaddleOCR-VL) | output stream: `delta` tokens, then `done` with the plain `/ocr` body | `POST /ocr?stream=true`; jobs carry `partial_text` |
| vectordb | output stream (`Accept: text/event-stream`): `queued`, `loading`, `splitting`, `embedding` (batch *i*/*N*), `storing`, per-file events for `/create`, `done` with the plain JSON | `POST /v1/kb/{id}/files/embed`, `POST /v1/kb/{id}/create` |
| image-generation | job status events (`pending` with queue position → `in_progress` with `seconds_per_image` / `image_started`, a per-size seconds-per-step rate learned on this device → `completed`); one OVMS call at a time for the whole worker; finished images are PNGs on disk, read from `/images/{index}` (`/result` still answers `b64_json`) | `GET /v1/images/jobs/{id}/events` |
| synthetic-image-generation | job status events (`queued` → `running` with stage and step → `completed`) | `GET /image-gen/job/{id}/events` |
| diarization | job status events (`pending` with queue position → `running` with pyannote stage and progress → `completed`) | `GET /v1/diarize/{job_id}/events` |
| frame-generation | job status events (progress, frames done of total) | `GET /v1/tasks/{id}/events` |
| lipsync | job status events for avatar creation (stage, per-frame progress) | `GET /v1/tasks/{taskId}/events` |
| ocr | job status events | `GET /ocr/jobs/{id}/events` |
| geti-classifier | job status events for model setup (connecting → preparing → downloading with bytes → extracting → compiling) | `POST /setup-{cls,seg}/jobs`, `GET /setup-jobs/{id}/events` |
| ppt-translator | job status events (progress per translated batch) | `GET /status/{job_id}/events` |
| wake-word-detection | push stream: `events`, `detection`, `cleared`, `level` (~10 Hz while detecting) | `GET /v1/wake-word-detection/events/stream` |
| export bundle (app route) | progress events while the export script runs, ending in `done` with a download id and its `expiresAt`; the zip streams from `GET /api/export-bundle/download/{id}` as often as needed until it expires (30 min; `HEAD` checks it is still there), and closing the stream cancels a running export | `POST /api/export-bundle` with `Accept: text/event-stream` |

Jobs are kept for a while after they finish (so a lost event or poll does not lose the result) and then evicted.

**Cancelling.** A client that stops following a job does not stop it, so a job nobody wants any more is cancelled explicitly: `DELETE` on the job's status path (`worker_common.cancel`; `cancelJob(url)` in `lib/browser/sse.ts`). A job still queued is dropped at once; a running one reports `cancel_requested: true` until its work reaches the next safe point (between images, frame chunks, translation batches, pipeline steps or tokens), where `CancelToken.check()` raises `JobCancelled` and the job removes what it half-made; a finished job is left as it is. `cancelled` is a final status on every worker, carries no `perf` block, and ends the status stream. Demos show a Cancel button while a job runs, and cancel on unmount the jobs whose result only the page could pick up; jobs whose result is kept server-side (a lipsync avatar, a Geti model setup, vector DB ingestion) are not cancelled when the page goes away.

Handlers must keep blocking work (inference, file IO, `requests`, subprocesses) off the event loop — a sync `def` route, `asyncio.to_thread`, or a generator handed to `sse_response` — because one blocked loop stalls every request, stream and healthcheck of that worker.

### Live metrics

The **Live metrics** panel under a service demo shows how fast the instance handled the latest request **that demo sent from this browser tab**. The demo measures the calls it sends itself, in the hooks that send them: no route is declared anywhere and nothing on the server reads responses. Calls from samples, other services or external clients are not measured.

| File | Does |
|---|---|
| the service's request hooks (`services/<id>/hooks/`) | time each call that is the model's work, with `services/common/metrics/work.ts` |
| `services/<id>/metrics.tsx` — `export const figures` | the figures of the panel, computed from the latest work |

A service without `metrics.tsx` shows no panel. Codegen collects the figures in `services/_generated/metrics.ts`.

**Measuring a call.** `work.ts` keeps, per instance address (`/api/<type>@<id>`), the latest successful unit of work — `MeasuredWork`: `{ at, responseMs?, inferenceMs?, firstOutputMs?, quantities, reported? }` — and the demo's calls in flight and failed. What a call handled is a set of **named quantities** — `{ inputTokens, outputTokens }`, `{ audioSeconds }`, `{ items, steps }` — which only the service's `metrics.tsx` gives a meaning. The timer starts when the hook sends the request:

| Helper | For | Used by |
|---|---|---|
| `fetchWork(apiBase, path, init, measure)` | a JSON answer: `fetchJson` timed from sending to the parsed body, with the worker's `Server-Timing` and the quantities `measure` returns (`{ items: input.length }`, `{ audioSeconds: body.duration }`) | embeddings, rerank, face-recognition, speech-to-text (batch) |
| `startWork(apiBase)` | a call the hook reads itself: `firstOutput()` at the first token, then `finish({ inferenceMs?, quantities? })`, `failed()` or `aborted()` (`settleError(signal)` picks) | text-to-speech (to the WAV's last byte, `audioSeconds` from `WavStreamReader.seconds`), text-generation |
| `recordJob(apiBase, jobId, perf)` | a background job followed to its end: the `perf` block of its final status (below); a job followed again counts once | OCR, diarization, frame-generation, image-generation |
| `recordWork(apiBase, { inferenceMs?, responseMs?, quantities })` | work that is not one call | speech-to-text (live) |

Text generation: `useTextGenChat` wraps the chat transport's `fetch`, takes the first `text-delta`, `reasoning-delta` or `tool-input-start` event of the stream as the first token, and finishes with the token counts the chat route sends as the answer's message metadata (`chatUsageMetadata` in `lib/llm/chat-usage.ts`): `inputTokens`, `outputTokens` and `prefillTokens`, the prompt less the `prompt_tokens_details.cached_tokens` OVMS and llama.cpp report, which the prefill speed is over. An answer that used MCP tools sums every step, the tool calls in its time. Live transcription runs on a WebSocket straight to the worker: the OVMS backend's `transcript` message carries the utterance's audio span (`start`, `end`) and model time (`latency.stt_ms`); on the OEP backend the demo times an utterance from its `input_audio_buffer.committed` event to its transcript.

A hook that samples share (`useTranscribe`, `useDiarize`, `useTextGenChat` with a `sessionKey`) records for its instance there too, which only the service page shows. The work lives in the tab's memory, so it outlasts switching demos; the panel clears it when the instance starts again (its model or device may have changed) and on Reset.

**Figures** show the latest call only — no history, averages or trend. A figure (`MetricFigure` in `services/common/metrics/types.ts`) renders a tile from the latest work (`null` until there is some) and may give a one-line `headline` for the collapsed panel (the first figure with one stands in). `services/common/metrics/calc.ts` has the math (`workMs(work)`, `rate(work, 'audioSeconds')`, `rate(work, 'outputTokens', 'after-first-output')`), `stat-tile.tsx` the tile, and `figures.tsx` the figures several services share — only the ones people benchmark that kind of model with, in the standard terms:

| Figure | Shows | Used by |
|---|---|---|
| `rtfx()` | seconds of audio per second of processing, with the RTF and the audio length | speech-to-text, text-to-speech, diarization |
| `fps()` | frames (`items`) per second of processing, with the frames and time | face-recognition, OCR, frame-generation |
| `throughput({ unit })` | `items` per second of processing, with the items and time | embeddings, rerank |
| `latency({ label?, source? })` | the model time the worker reports ("Inference time"), a job's processing time ("Processing time"), else the response time ("Latency"); `source: 'response'` always the response time, end to end | all but image-generation (text-generation's "E2E latency" with `source: 'response'`) |

A figure only one service shows lives in that service's `metrics.tsx` — TPS (with TPOT and the tokens generated), TTFT and prefill TPS in text-generation's, generation time per image and it/s in image-generation's — and moves to `figures.tsx` once a second service needs it. A new service times its model calls in its hooks and lists its figures in `metrics.tsx`.

**Background jobs.** A worker that runs a request as a job reports the job itself, because the request returns at once and only the status sees it finish: once the job is done, its status body carries a flat `perf` object —

```json
"perf": { "seconds": 26.1, "items": 1, "steps": 30, "audio_seconds": 42.5, "started": 1726380000.5 }
```

`seconds` is the processing time (required); every other number says what it produced, as a quantity of that name in camelCase (`audio_seconds` → `audioSeconds`) — the workers use `items`, `steps` and `audio_seconds` — except `started` (epoch seconds). A job's status event stream carries the same body in its final `status` event, `perf` included. The image-generation, synthetic-image-generation, frame-generation, OCR and diarization workers add it.

**Where the time comes from.** The response time a demo measures includes the hop through the app, so a worker that knows how long its model call took reports that with a standard header, which the figures prefer ("Inference time") and which browsers show in their developer tools:

```
Server-Timing: inference;dur=123.4
```

`worker_common.server_timing(seconds)` builds it and `worker_common.timed()` measures a block (a streamed answer sends its headers before the work is done, so it cannot carry the header: a streamed WAV is timed by the demo to its last byte); the speech-to-text (OVMS backend), text-to-speech, embeddings (OEP backend), face-recognition and OCR workers report it. Text generation is different: engines report exact token counts but no per-request timing, so TTFT, TPS and the E2E latency are the demo's own on both OVMS and llama.cpp, to within the loopback hops. A streamed OVMS answer carries the counts only in a final `usage` chunk, sent when the request asks for `stream_options: { include_usage: true }`; `createOvmsProvider`, which the chat, robotics and exam-marking routes use, always asks for it, and llama.cpp accepts the option too.

**Calls between workers.** A worker calls a sibling through the app: either it looks the sibling up itself (`worker_common.service_base_url`), or the app hands it the sibling instance's path on the app, `/api/<type>@<id>/v1` (`siblingWorkerAddress` in `lib/instances/instances.ts`), which the worker turns into a URL with `worker_common.studio_address` — lipsync's `tts_url` and the vector database's embeddings and reranker URLs work this way, and stay right when the sibling restarts on another port.

### Service Instances

A service type can run several **instances** at once when its `data.ts` sets `multiInstance: true`. Each instance is one row in the `services` collection (`type` + `instanceId`), with its own model, device, port, process, log file and writable data directory. The rule: every **visible** service is multi-instance, so the flag is set on `text-generation`, `embeddings`, `rerank`, `vectordb`, `text-to-speech`, `ocr`, `diarization`, `face-recognition`, `frame-generation`, `image-generation`, `speech-to-text`, `lipsync` and `wake-word-detection` (one instance per microphone: `metadata.audioDevice` becomes the instance's default input device via `--audio-device`, and the demo can still pick a device at runtime). **Hidden** services back a sample, samples are not multi-instance, so those stay single (`file-watcher`, `geti-classifier`, `medical-scribe-database`, `ppt-translator`, `synthetic-image-generation`, `robotics-ai` and the docker suites) — their workers still honour the instance contract below, so flipping the flag later is a one-line change. `mcp` has no process (`mode: 'none'`), so there is nothing to instantiate.

Every instance is handled the same way and none is marked special. Where a caller names only a type (a sample, a worker calling a sibling service, `startService(type)`), `pickPrimaryInstance` in `lib/instances/instances.ts` picks the running instance — a started one over one still starting — or, while none runs, the first instance in creation order:

| | Every instance |
|---|---|
| `instanceId` | slug of its name when it is created (`Text Generation` → `text-generation`, `CPU fallback` → `cpu-fallback`, `-2` on a clash); fixed from then on — a rename changes only the label |
| Port | none while stopped; a free port (plus the ports it needs next to it: `portBlock` from `data.ts`, or an engine's `getSubPorts` — multiserve needs none) is picked from `INSTANCE_PORT_RANGE` on every start and released on stop (`lib/workers/instance-ports.ts`) |
| Address | `/api/<type>@<instanceId>/*` (rewritten to the dynamic proxy `app/api/instance-proxy/[instance]/[...path]`) |
| Process / log name | `<type>@<instanceId>` |
| Multiserve logs dir | `logs/multiserve/<type>/<instanceId>/` |
| Data dir | `data/<type>/<instanceId>/` (removed with the instance) |

Models are shared per type (`models/multiserve/<type>/`), so instances never download a model twice; the engine serialises the first download or conversion of a model across instances with a file lock (`models/multiserve/<type>/OV/.locks/`). GGUF models, downloaded or uploaded, live in one folder per repository, `models/multiserve/<type>/GGUF/<task>/<org>/<model>/`, with the quant only in the file name (`…-Q4_K_M.gguf`), so several quants of a model sit side by side and no path ever contains a `:` (which Windows forbids). An uploaded model's id stays `org/model:QUANT` — the quant taken from the file name when the name gives none, and an upload whose name and file disagree is refused — and is recorded in `GGUF/user_uploads.json`; the engine moves uploads left in the old `<model>:<QUANT>/` folders into this layout when it starts. Model ids, tags and uploaded file names that Windows could not store (`<>:"|?*`, control characters, a trailing dot or space, reserved names such as `CON`) are refused before anything is written. Samples and `getWorkloadInstance()` target the running instance (else the first) unless a caller passes an `instanceKey` (`<type>@<id>`), e.g. in the body of `/api/services/text-generation/chat`.

#### Which instance a sample uses

A sample names its dependencies by type, so by default it gets the primary instance above. A user can pin a sample to one instance per service type: the Services panel on the sample page and the demo's Configure sheet show an **Instance** picker (Automatic, or one of the instances) for every dependency whose type has two or more instances. Bindings are stored in the `sample-settings` Payload global as `{ [sampleId]: { [type]: <services row id> } }` (`lib/settings/sample-settings.ts`, `GET`/`PATCH /api/samples/settings`; the row id survives a rename, and the services delete hook unbinds a deleted instance). `SampleInstancesProvider` (`context/sample-instances-context.tsx`) wraps the sample detail and demo pages: under it, `useGetService`, `useServiceApiBase`, `useServiceLiveStatus` and `useGetServices` answer with the bound instance for a bare type, so feature providers and service hooks follow the choice unchanged, and readiness, logs, Start and Configure act on the bound instance. Requests a sample sends to its own routes carry `instances: { [type]: "<type>@<id>" }`, which the chat and exam-marking routes read through `boundInstanceKey()` (`src/lib/workers/instance-lookup.ts`) for text generation, the RAG vector database, lipsync and text-to-speech. Workers that call a sibling themselves (ppt-translator and robotics-ai → text-generation, lipsync → frame-generation) still get the primary instance.

#### What a worker process receives

Two instances of one type share the worker's code directory (`cwd` is still `workers/<type>`), so nothing a worker writes may be a relative path. `lib/workers/instance-runtime.ts` hands every worker its identity and a private directory (`startWorkerProcess` in `lib/workers/worker-lifecycle.ts`):

| | |
|---|---|
| env `INSTANCE_ID` | the instance id |
| env `INSTANCE_KEY` | `<type>@<instanceId>` |
| env `INSTANCE_DATA_DIR` | `<repo>/data/<type>/<instanceId>`, created before spawn |
| env `EDGE_AI_STUDIO_URL` | loopback URL of the app, for calling sibling services through `/api/<type>@<id>/…` instead of a worker port (look a type's running instance up with `GET /api/services/address?type=<type>`, or turn an address the app handed over into a URL with `worker_common.studio_address`) |
| args `--instance-id <id> --data-dir <dir>` | the same two values, for workers that parse them (every worker in `workers/` does; a `WorkerConfig` can set `acceptsInstanceArgs: false`, which the docker suites do because their start scripts reject unknown flags) |

Every worker roots its temp files, uploads, outputs, databases and indexes in `INSTANCE_DATA_DIR` (falling back to its old location when the variable is unset, so a worker still runs on its own). Workers that embed an OVMS (`speech-to-text`, `image-generation`) run it on `--port + 1` and declare `portBlock: 2` in `data.ts`, so the allocator reserves both ports; `reservedPorts` is only for genuinely fixed ports a worker cannot move. The multiserve engine gets `--instance-dir <data dir>` in addition to the shared `--model-dir`: the live OVMS `config.json` and the llama.cpp `config.yaml` live there, one per instance, with absolute model paths — two engine instances sharing one model directory must never share those files. An engine instance takes one port, its own: the model servers it starts — its OVMS, started with the first OpenVINO model rather than with the engine, and one llama-server per task — each pick a free loopback port when they start (`pick_free_loopback_port` in the engine's `modules/utils.py`, retried once more when another process grabs the port first), so the engine declares no `getSubPorts`, and `/v1/status` is where their URLs are known. The engine's `/v1/health` therefore means "both backends can start a model", not "a model server is running".

Instances of one type are started one at a time: "Start selected" in the service page's Manage instances sheet (`useStartInstances`) and the boot autostart from `deployment.json` both wait for an instance to leave `prepare` before starting the next of the same type. A row that reaches `error` releases its port and has its process stopped, so a retry or a sibling can use the port.

`deployment.json` can declare extra instances too: `services.<type>` lists a type's instances, first instance first. Every entry is matched to an instance by its `instanceId` first, then by `label` (`lib/deployment/deployment-match.ts`); the first entry otherwise takes the oldest instance left, and a differing `label` renames only the display name — the address, data and sample bindings stay. An entry that matches nothing is created as a copy of the first instance under its `instanceId`, or the id derived from its name. Saved deployments write each instance's `instanceId`, so a renamed instance is found again on every boot. The file is the whole setup: before applying a listed type, every instance its entries do not name is deleted (`deleteUndeclaredInstance`, through `payload.delete`, so the afterDelete hook stops it and removes its data directory), and after the listed types every unlisted type with an added row is reset the way deleting its last instance is (`removeUnlistedServices`); a file that fails validation, or a type whose first entry does, changes nothing. The repository ships `deployment.example.json`, not a `deployment.json`. `lib/deployment/` (`deployment-schema.ts`, `deployment-file.ts`, `deployment-apply.ts`, `deployment-snapshot.ts`) applies the first entry first, then the rest in file order, honours `multiInstance` / `maxInstances`, and queues every `"status": "online"` row into the per-type serial autostart. The older object form (`services.<type>.instances.<instanceId>`, matched by id) is still read; the Settings export writes lists. `lib/deployment/deployment-docs.ts` emits both forms into `docs/deployment.schema.json`. See [deployment-config.md](deployment-config.md#multiple-instances).


#### Startup reports

While an instance starts, its page names the step it is in — Downloading, Preparing, Loading model, Checking readiness — with progress only where it can be measured (a percentage only when a total was reported), and a failed start shows a short summary with a **View errors** link to the error-filtered logs. Producers that report nothing keep the generic **Starting**.

- **Protocol**: one stdout line per report, `EDGE_AI_STUDIO_STARTUP {"event":"stage"|"progress"|"stage-end"|"failure", …}`. The app sets `EDGE_AI_STUDIO_STARTUP_EVENTS=1` for workers it starts (not for the multiserve engine, whose stages the Node side reports itself while it drives the download and start). `lib/workers/process-handler.ts` takes these lines out of the log and writes a readable `Startup: …` info line, or a `Startup failed: …` error line, instead.
- **Python side**: `worker_common.startup` (see `workers/common/README.md`). The shared download paths (`model_downloader` fetches and `ovms_pull`), `OvmsServer.wait_model_ready()`, `create_app()`'s lifespan and the shell `prepare_worker`/`ovms_prepare` helpers report, so most workers need no code of their own; a worker adds a step with `with startup_stage("loading-model", model_id): …`.
- **Attempts**: every start or retry begins a new attempt id (`lib/workers/startup-events.ts`, `startup-telemetry.ts`); reports from another attempt, progress for a stage that is no longer current and progress that goes backwards are ignored, so a retry never shows the previous attempt's progress. The attempt is forgotten when the row becomes `active` or is stopped, and kept (frozen) while it is `error`.
- **API**: `GET /api/services` adds `startup` to each row from server memory (the current attempt while `prepare`/`restart`, the failed one while `error`, else `null`; type `StartupTelemetry` in `lib/instances/runtime-fields.ts`), next to `applied` — what the running process was started with, which the service page compares with the saved settings to say a restart is needed. Neither is stored on the row.
- **Safety**: a failure summary is one sanitised line — tokens and credentials masked, URLs cut to host and path, absolute paths cut to the file name, at most 200 characters — cleaned in Python and again on the server.
#### Health of a multiserve instance

The app checks a multiserve instance through the engine's `/v1/status` (the `healthcheck` in `engines/multiserve/backends.ts` maps it with jsonata and expects the instance's configured model in the list). The engine builds that list from the models it *started* but verifies each one against the model server before answering — OVMS's `/v1/config` state, or the llama-server's `/health` — and leaves out anything the server no longer holds, so a model that was unloaded behind the engine's back shows up as unhealthy instead of a stale success. In the app, an `active` instance that stays unhealthy for three consecutive checks (`lib/workers/health/`, ~30 s, enough to ride out a reload; an engine that does not answer at all is counted at once rather than after the check's retry ladder) moves to `error` with a `statusMessage` saying whether the engine is unreachable or which model is gone; the `error` transition stops what is left of the process and releases its port (serialised against a start or restart that arrives while it runs, so an immediate retry keeps the port it just allocated), a start or restart clears the message, and the instance row shows it.

`tests/services/instances.spec.ts` covers the API and the detail page, and also starts two real instances seconds apart, restarts one under the other and checks that worker instances keep disjoint `data/` directories. `tests/services/multi-instance.spec.ts` runs every multi-instance service two at a time: both instances start together (one on the CPU, one on the discrete GPU where the service runs there), get their own ports and data directories, answer the same real request with the output the service's own spec expects, keep their state apart (face galleries, knowledge bases), and one keeps answering while the other is stopped. `tests/services/deployment-config.spec.ts` covers the `deployment.json` presets for instances: because presets only apply at boot, it spawns its own `next start` on a free port with a throwaway database and a generated file (so it needs a production build, `npm run build`, and is skipped without one), boots twice per form, and checks creation, the guards (cap, id pattern, the first instance's own id, missing and duplicate names, single-instance services), in-place updates, that a list boot never duplicates an instance, that unlisted instances and services are removed (a renamed entry without an `instanceId` replaces its instance; one with an id keeps it), and that the Settings export recreates every instance under its name and id on a fresh database; it also auto-starts a face-recognition instance.

A service is only its rows: nothing is seeded at startup, and a type with no row is a service nobody added (its page and the sample panels offer to add it; `startService(type)` on such a type adds one instance from the defaults and starts it). API: `POST /api/services` creates an instance — the first one adds the service, from `seedInstanceSettings()` in `lib/workers/instance-seed.ts` (the engine, model and health check for this OS); further ones copy settings from `copyFrom` or the first instance; no port yet — `DELETE /api/services/:id` deletes an instance (deleting the last one removes the service; its settings are not kept), `PATCH /api/services/:id` with `{ label }` renames — only the display name: the `instanceId`, address, data and running process stay (an address never moves; to get another one, duplicate the instance under a new name and delete the old one). At startup `syncServiceRows()` in `lib/app-boot.ts` only brings existing rows' engine and health check in line with the registry. Databases from before 2026-09-15 held a settings-template row per type (`added: false`): migration `20260915_120000` deletes them and drops the column, and `payload/legacy-template-rows.ts` does the same for push-mode development databases before their schema is pushed. Port allocation happens in the `afterChange` hook when a row moves to `prepare` (and in `POST /api/services/:id/engine`, which starts a multiserve engine without a model, answers 202 at once, and is followed with `GET` → `{ starting, healthy }`), release when it moves to `inactive`. Existing databases are migrated (`20260908_100000`) and renamed on startup: a row still at the old id `default` gets an id derived from its name (the old placeholder name "Default" becomes the service's name) and its `data/`, `logs/<type>.log` and engine logs move with it; any port still recorded on a row is cleared at startup. `reservedPorts` in `data.ts` only lists genuinely fixed ports a worker cannot move; workers that embed an OVMS derive its port from their own (`portBlock: 2`) instead.

In the UI the enriched `Service` for a type is its primary instance (the running one, else the first) plus `instances[]` (creation order) and `aggregateStatus`; `useGetService()` accepts a type or an instance key, and `startService()` / `stopService()` take an instance key (a type means its primary instance).

### Model precision

A worker that converts its model on first start lets the user pick the precision (weight format) it converts to: **Runtime Settings → Advanced settings → Precision**. A model whose weights come at a fixed precision shows that precision as the only option, so it is always known. The choice is stored per instance as `models.default.quant` (also settable in `deployment.json`), and changing it shows under **Restart to apply**.

How it fits together:

- **Config.** `ServiceConfig.availableWeightFormats` plus `defaultWeightFormat` give a service a choice (`offersPrecision` in `services/model-config.ts`). `ModelOption.availableWeightFormats` overrides it per model, and a single entry marks the model as fixed.
- **Panel.** `WorkerConfigurePanel` renders `PrecisionSection` (`services/common/configure/precision-section.tsx`) for the drafted model and lists the saved model's precision in the summary (`getModelPrecision`). It sends the saved `quant` with every save, because `PATCH /api/services/:id` replaces `models.default` with what it gets. Panels that replace the model section (`modelSection`, e.g. wake word) show no precision.
- **Start.** `buildArgs` passes `getEffectivePrecision(config, quant)` (the saved value when the service offers it, else the default) to the worker, and only for models that convert. Some workers' argument parsers are strict, so a flag sent to the wrong worker kills it.
- **On disk.** Every worker keeps each precision's export apart, so a new precision converts once on the next start and switching back reuses the earlier export. An OVMS pull of a model its repository already holds keeps the weights, so OVMS-backed workers use a repository per precision. `list_models.py` counts a model converted at any precision as on disk, because the instance's precision is not known there.

Services with a choice:

| Service | Models | Choices | Default | Worker flag | Where each precision is kept |
|---|---|---|---|---|---|
| Speech to Text (OEP backend) | Whisper presets, custom ids | fp32, fp16, int8, int4 | int8 | `--precision` → upstream `weight_format` | `models/stt/openvino/<name>-<precision>/` (fp32: `<name>/`) |
| Speech to Text (OVMS backend) | Whisper, Qwen3-ASR, custom ids (pre-converted `OpenVINO/*`, `*-ov` keep their own) | fp32, fp16, int8, int4 | int8 | `--precision` → `ovms --pull --weight-format` | `models/stt/ovms-<precision>/` (fp32 and pre-converted: `models/stt/ovms/`) |
| Text to Speech | SpeechT5 (OEP worker) | fp32, fp16, int8, int4 | int8 | `--dtype` | `models/tts/oep-tts/openvino/<model>__<precision>/` |
| Image Generation | Stable Diffusion XL, custom ids that are not OpenVINO IR | fp32, fp16, int8, int4 | int8 | `--precision` → `ovms --pull --weight-format` | `models/ovms/` (int8 and pre-converted), `models/ovms/precision-<precision>/` |
| Lipsync | Wav2Lip | auto, fp16, int8 | auto: INT8 on CPU, NPU and integrated GPUs, FP16 elsewhere | `--int8` / `--no-int8` (auto sends neither) | `models/wav2lip/checkpoints/wav2lipv2_ov/`, `…/wav2lipv2_ov_int8/` |
| Embeddings | Qwen3 Embedding | fp16, int8 | int8 | `--precision` → upstream `MODEL_CONFIGS` `weight_format` | `models/embeddings/ov-models/<model>/<PRECISION>/` |
| OCR | PaddleOCR-VL, PaddleOCR-VL-1.5 (the language model) | fp16, int8, int4 | int8 | `--precision` → load options `llm_int8` / `llm_int4` | `models/ocr/paddleocr_vl/<model>/llm_stateful{,_int8,_int4}.xml` |

Models at a fixed precision, measured from the files on disk on 2026-10-14 (weight bytes by element type in the IR or ONNX graph):

| Service | Model | Precision | Why it is fixed |
|---|---|---|---|
| Text to Speech | Kokoro | FP16 (about 30% of the weights kept FP32) | converted from PyTorch with `ov.save_model`'s FP16 compression |
| Text to Speech | Piper | FP16 | ONNX converted with `ov.save_model` |
| Text to Speech | Malaya | FP32 | converted from PyTorch to OpenVINO IR without FP16 compression (2026-10-19) |
| Text to Speech | Pocket TTS (Indonesian) | INT8 (the transformer; the codec decoder FP32) | the transformer's weights compressed by NNCF at export, more than twice as fast on the CPU as FP32 (2026-10-19) |
| Text to Speech | VieNeu-TTS v3 Turbo | INT8 (embeddings and heads FP32) | upstream's int8 ONNX graphs, run on ONNX Runtime (2026-10-19) |
| Text to Speech | FastSpeech2 HS (Tamil) | FP32 | converted from PyTorch to OpenVINO IR without FP16 compression (2026-10-19) |
| Image Generation | Stable Diffusion 1.5 INT8, SDXL Turbo | INT8 | downloaded as OpenVINO IR with an INT8 UNet (SDXL Turbo's text encoders and VAE are FP32) |
| Lipsync | MuseTalk | FP16 | the worker has no INT8 MuseTalk |
| Embeddings | CLIP presets | FP32 | optimum export, uncompressed |
| Embeddings | SigLIP presets | FP16 | `ov.save_model` |
| OCR | PP-OCRv5, PP-OCRv5 Server, PP-OCRv3 | FP32 | ONNX / Paddle graphs read as they ship |
| Face Recognition | Open Model Zoo pipelines (`omz-retail`, `omz-adas`) | FP16 | IR downloaded at FP16 (FP32 and FP16-INT8 also exist upstream) |
| Face Recognition | YuNet + SFace | FP32 | OpenCV Zoo ONNX (INT8 versions also exist upstream) |
| Frame Generation | RIFE | FP16 | converted with `compress_to_fp16` |
| Diarization | pyannote Speaker Diarization Community-1 | FP32 | PyTorch weights |

Caveats:

- **Embeddings has no INT4.** Upstream asks for it with `load_in_4bit`, which optimum-intel ignores, so the export comes out uncompressed. Its fp16 option is upstream's uncompressed export, which keeps the checkpoint's 16-bit weights.
- **Text to Speech INT4 on an integrated GPU produces noise** (upstream's note).
- **Not covered:**
  - Wake word: its panel picks several FP32 ONNX models.
  - The docker suites.
  - Multiserve: it has its own weight-format field. That field appears only for models that need conversion, is free text with no default, and a re-pull of a converted model reuses the existing export.

To add precision to a service:

1. **Worker.** Add a flag defaulting to the service's default. Keep each precision's export in its own place, and give OVMS pulls a repository per precision. Make `list_models.py` accept an export at any precision.
2. **`config.ts`.** Set `availableWeightFormats` and `defaultWeightFormat`. Give every model with fixed weights a single-entry `availableWeightFormats`, measured from its files rather than guessed.
3. **`data.ts`.** In `buildArgs`, pass `getEffectivePrecision(…)` only for the models whose worker converts.
4. **Panel.** It must be, or wrap, `WorkerConfigurePanel` with a model list of its own.
5. **Tests.** Cover it in `tests/services/configure-ui.spec.ts` (`Runtime Settings: precision`).

### Registries

Three auto-generated registries power the service/engine/sample discovery:

| Registry | Location | Generated from |
|---|---|---|
| Services | `src/services/_generated/` | `src/services/<name>/data.ts` |
| Engines | `src/engines/_generated/` | `src/engines/<name>/data.ts` |
| Samples | `src/samples/_generated/` | `src/samples/<name>/data.ts` |

The services registry also auto-discovers per-service `configure-panel.tsx`,
`feature-provider.tsx`, `metrics.tsx` and `in-use.ts` files (see `_generated/configure-panels.ts`,
`_generated/feature-providers.ts`, `_generated/metrics.ts` and `_generated/in-use.ts`). Feature providers are how a sample integrates
an **optional** service so it can be pruned from `--no-optional` exports — see
[OPTIONAL-SERVICES.md](./OPTIONAL-SERVICES.md). A built-in service (execution mode `none`) is never added, so the
sidebar leaves it out unless its `in-use.ts` hook, `export function useInUse(): boolean`, says something is set up
in it (MCP Manager: a registered server); it is then listed as Available.

**Never edit `_generated/` files.** Run `npm run codegen` after adding, removing, or renaming any service, engine, or sample.

---

## Coding Conventions

### TypeScript / React

- **2-space indentation**, organized imports, trailing commas, no semicolons, single quotes
- **Path aliases**: `@/*` → `src/*`, `@payload-config` → `src/payload.config.ts`
- **Server Components by default** — only add `"use client"` when interactivity is needed
- **No `console.*`** — use `logger` from `@/lib/logger` instead (ESLint enforces `no-console: error`)
- **`cn()`** from `@/lib/utils` for conditional class merging (clsx + tailwind-merge)
- **No eslint-disable comments** unless absolutely necessary — fix the underlying issue

### Naming

ESLint enforces `@typescript-eslint/naming-convention`:
- Variables: `camelCase`, `PascalCase`, or `UPPER_CASE`
- Leading underscores allowed (for unused params: `_foo`)
- Trailing underscores forbidden

### Prettier

Prettier is integrated via ESLint with these settings:
- Trailing commas: `all`
- No semicolons
- Tab width: 2
- Single quotes
- Print width: 80
- Arrow parens: `always`
- Tailwind CSS class sorting via `prettier-plugin-tailwindcss`

### Import Safety

- **Config contexts** (e.g., `next.config.ts`, `payload.config.ts`): Import from `_generated/meta.ts`, never from `_generated/services.ts` — the latter pulls in React dependencies
- **Dependency direction**: `engines ← services ← samples` — never import backwards
- **Optional-service code stays in its own folder**: shared/required code must not statically import an optional service's folder, or `--no-optional` exports break. Integrate optional services via feature providers + neutral contexts — see [OPTIONAL-SERVICES.md](./OPTIONAL-SERVICES.md)

### API Calls — TanStack Query

All API calls **must** use TanStack React Query. Never fetch directly inside components.

```tsx
// ✅ Dedicated hook for each API call
export function useTranscribe(options?: UseMutationOptions) {
  return useMutation({
    mutationFn: (file: File) =>
      fetch(`${apiBase}/v1/stt/transcribe`, { ... }).then(r => r.json()), // apiBase: service.apiBase
    ...options,
  })
}

// ✅ Handle all three states in the UI
const { mutate, isPending, isError, data } = useTranscribe()
```

- Wrap every API call in a dedicated hook (`useQuery` or `useMutation`)
- Always handle loading, error, and success states
- Co-locate hooks with the feature they serve

---

## Modularity & Shared Code

### Dependency Direction

```
engines  ←  services  ←  samples
```

- **Samples** may import from **services** and **engines**
- **Services** may import from **engines**
- **Engines** must not import from services or samples
- Cross-cutting violations are always wrong

### Shared Code Placement

| Shared by | Location |
|---|---|
| Multiple **services** only | `src/services/common/` |
| Multiple **samples** only | `src/samples/common/` |
| Multiple **engines** only | `src/engines/common/` |
| UI components (no business logic) | `src/components/` |
| Across services, samples, **and** engines | `src/types/` (types) or `src/lib/` (utilities) |

Don't hoist code to a broader scope unless genuinely needed.

---

## How-To Guides

### Adding a New Service

1. **Create service metadata** — `src/services/<name>/data.ts`

   ```ts
   import { SomeIcon } from 'lucide-react'
   import type { ServiceMeta, WorkerConfig } from '@/services/types'
   import type { Service as PayloadService } from '@/payload-types'

   export const service: ServiceMeta = {
     id: '<name>',
     name: 'Display Name',
     description: 'Short description.',
     longDescription: 'Detailed description.',
     icon: SomeIcon,
     supportedOS: ['linux', 'windows'],
     execution: { mode: 'worker' },        // or 'multiserve' or 'none'
     defaultModel: { name: '...', device: 'CPU' },
     logSources: [{ type: 'service', label: '<name>', target: '<name>' }],
     healthCheck: { url: '/healthcheck' },
   }

   export const worker: WorkerConfig = {
     buildArgs: (doc: PayloadService) => [
       '--port', String(doc.port),
       '--model', doc.models?.default?.name ?? 'default-model',
     ],
     workerSubDir: 'services/<name>',     // relative to workers/
   }
   ```

2. **Create the demo component** — `src/services/<name>/demo.tsx`

   The component receives `{ service: Service }` and uses `DemoParameterSidebar` for controls.

3. **Create the params hook** — `src/services/<name>/hooks/use-params.ts`

   ```ts
   export function use<Name>Params(initial?: Partial<ParamValues>) {
     const [param, setParam] = useState(initial?.param ?? DEFAULT)

     const params: DemoParam[] = [
       { type: 'slider', label: '...', value: param, onValueChange: setParam, ... },
     ]

     return { values: { param }, params }
   }
   ```

4. **Optionally create** `config.ts` (available models/devices, and the precisions a converting worker offers — see [Model precision](#model-precision)) and `docs.ts`

5. **Run codegen** — `npm run codegen`

6. **Add the worker** — `workers/services/<name>/` (if using `"worker"` execution mode; see [Adding a New Worker](#adding-a-new-worker))

### Adding a New Worker

[`workers/README.md`](../workers/README.md#adding-a-worker) has the layout,
templates for `pyproject.toml`, `main.py`, `start.sh` and `start.ps1`, and the
`worker_common` imports a worker builds on.

### Adding a New Sample

1. Create `src/samples/<name>/data.ts` — export a `sample` object
2. Optionally add `demo.tsx` for the demo component
3. Reuse hooks/components from `src/services/` — don't duplicate
4. Run `npm run codegen`

Sample hooks wrap service params hooks with `ServiceParamGroup` metadata:

```tsx
import { useTextGenParams } from '@/services/text-generation/hooks'

export function useTextGenerationParams(online: boolean) {
  const { values, params } = useTextGenParams()
  const group: ServiceParamGroup = { name: 'Text Generation', online, params }
  return { values, group }
}
```

### Adding a New Engine

1. Create `src/engines/<name>/data.ts` — export `engine: Engine`
2. Create `src/engines/<name>/server.ts` — export the `EngineServer` members (`start`, `cancelStart`, `isStarting`, …; see `src/engines/types.ts`)
3. Run `npm run codegen`

### Database Migrations

Payload CMS auto-generates SQLite migrations in `src/payload/migrations/`.

- **Released migration exists**: Do **not** modify it. Create a new migration via `next build` or the Payload CLI.
- **No release yet** (development): You may modify the latest migration directly instead of stacking a new one.
- **Never edit `payload-types.ts`** — it's regenerated from the schema automatically.

To reset the database during development:

```bash
npm run db:reset
```

---

## Testing

End-to-end tests use **Playwright** and live in `frontend/tests/`, split into projects (see `playwright.config.ts`):

| Project | Directory | What it covers |
|---|---|---|
| `services`, `embedding-service`, `vectordb-service`, `oep-services` | `tests/services/`, `tests/settings/` | The full live matrix: every preset × device × model source, downloads/uploads, invalid configurations, API contracts, instance flows. |
| `samples` | `tests/samples/` | The samples list and every detail page; and live, from the sample's own page, every sample except Robotics AI, AI Exam Marking, Geti Classification and Medical Scribe — each with only its required services and again with every optional one (voice input, wake word, RAG with reranking, voice output, MCP tools, frame generation), checked by what it produces. The Edge AI Suites need Docker; Synthetic Image Generation needs an Intel GPU (XPU). |

```bash
npm run test           # every project (what CI runs)
npm run test:services  # full live service matrix
npm run test:samples   # live sample runs
npm run test:ui        # Interactive test runner (port 8081)
npx playwright test tests/services/ocr.spec.ts --project=services -g "PP-OCRv5"   # one case
```

The live sample specs share `tests/samples/support/`: `services.ts` sets each service up on its page with a small preset (CPU or GPU, never the NPU), `demo.ts` launches a sample and drives its Parameters sheet, chat and knowledge base, `media.ts` gives Chromium a fake camera (a red disc) and microphone (`shaoboon-dialogue.wav`), and `mcp-server.ts` runs an MCP server with one tool whose answer no model could guess.

Configuration: `playwright.config.ts` targets Chrome and starts a local server on the configured port (`PORT`, 8080 by default; 8081 under `CI`), reusing one that is already running outside CI. Tests require a production build (`npm run build`) since Playwright uses `npm run start`. Every action and navigation is bounded (`actionTimeout`/`navigationTimeout`), and the server is started with `NO_PROXY` covering loopback so a proxy exported in the shell never intercepts a worker's calls to the app or to its own OVMS child.

To run the live projects without touching your working database, point the server at a scratch one and a free port range:

```bash
npm run build
PORT=8090 DATABASE_URL=file:./e2e-db.sqlite INSTANCE_PORT_RANGE=8300-8399 npm run start &
PORT=8090 npx playwright test --project=samples --output=/tmp/e2e-results
```

---

## Key Files Reference

| File | Purpose |
|---|---|
| `src/services/types.ts` | Core `Service`, `ServiceMeta`, `WorkerConfig` types |
| `src/engines/types.ts` | `Engine`, `EngineBackend` types |
| `src/samples/types.ts` | Sample types |
| `src/lib/workers/process-handler.ts` | Worker process lifecycle management |
| `src/lib/workers/health/` | Health polling with JSONata evaluation (probes, status transitions, poller) |
| `src/lib/constants.ts` | Paths (`WORKER_DIR`, `MODELS_DIR`, `LOGS_DIR`, `UV_PATH`) |
| `src/lib/logger.ts` | Logging utility (replaces `console.*`) |
| `src/lib/utils.ts` | `cn()` helper and miscellaneous utilities |
| `src/payload/collections/Services.ts` | Payload CMS service schema and hooks |
| `src/services/config-registry.ts` | Port map used by `next.config.ts` for API proxying |
| `scripts/generate-registries.mjs` | Auto-discovery codegen script |
| `next.config.ts` | Next.js config with API rewrite rules |
| `payload.config.ts` | Payload CMS configuration |

---

## Common Pitfalls

| Pitfall | Fix |
|---|---|
| Editing `_generated/` files | Always run `npm run codegen` instead |
| Using `console.log` | Use `logger` from `@/lib/logger` |
| Importing `_generated/services.ts` in server config | Import `_generated/meta.ts` (no React deps) |
| Port conflicts between services | Each service must have a unique `port` in `data.ts` |
| Editing `payload-types.ts` manually | It's auto-generated by Payload CMS |
| Fetching directly in components | Use TanStack React Query hooks |
| Importing samples from services | Respect direction: `engines ← services ← samples` |
| Adding eslint-disable comments | Fix the underlying issue instead |
| Building while dev server runs | Stop dev server first (`.next/lock` conflict) |
| Forgetting `npm run codegen` | Run after adding/removing/renaming services, samples, or engines |
