# 🚀 Getting Started — Setup & Normal Start

How to go from a fresh clone to a running kiosk. This is the "just start the
blueprint" path; for hot-reload development see [dev-mode.md](dev-mode.md), and for
packaging see [build.md](build.md).

- [Prerequisites](#prerequisites)
- [1. Setup](#1-setup)
- [2. Start](#2-start)
- [What start.sh actually does](#what-startsh-actually-does)
- [The Edge AI Studio prerequisite](#the-edge-ai-studio-prerequisite)
- [Verifying everything is up](#verifying-everything-is-up)
- [Stopping](#stopping)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js ≥ 20** + npm | Needed to run the kit. If the machine has none (or an older one), `./setup.sh` downloads a portable Node into `common/thirdparty/node` — checksum-verified against `SHASUMS256.txt` — and every launcher picks it up from there. `start`, dev mode and the build never download; they use the machine's Node, or the one setup unpacked. |
| **Edge AI Studio** checkout | The AI gateway providing LLM, OCR, face, STT and TTS. `./setup.sh` sets it up and `./start.sh` launches it by default, and both fail when the checkout is missing — pass `--skip-studio` / `--no-studio` to leave it alone. Default location `../edge-ai-demo-studio` from the repo root (a sibling of this checkout); configurable via `EDGE_AI_STUDIO_DIR`. The packaged build exports the bundle from the checkout, so `./setup.sh --build` needs it present but does not set it up. Not needed to run with `--mock`. |
| Linux (Debian/Ubuntu assumed) or Windows | Each launcher ships twice: `setup.sh`/`start.sh`/`uninstall.sh` for bash, and `setup_win.bat`/`start_win.bat`/`uninstall_win.bat` for Windows (the `_win` suffix keeps the root ones distinguishable when Explorer hides extensions), which run [scripts/win/](../scripts/win/)'s PowerShell equivalents with `-ExecutionPolicy Bypass`. Flags are spelled the same. |
| `poppler-utils` (`pdftoppm`) | Needed for live OCR of PDFs. `./setup.sh --hardware` installs it. |
| Hardware | PC/SC NFC reader (`pcscd`), SANE document scanner, webcam. The `reference` profile expects them (`nfc.simulate` and `documents.scanner.simulate` are `never`, `face.require_match` is `true`); `--mock` or the `simulated` profile stands in for them — see [configuration.md](configuration.md). |

---

## 1. Setup

```bash
./setup.sh      # Windows: setup_win.bat
```

Setup first asks what you want to do once everything is installed:

```text
What would you like to do?
  1) setup            set up only — start, develop or build later
  2) start            set up, then start serving (production build), as start.sh does
  3) dev              set up, then run one kiosk in development mode (hot reload)
  4) build            set up, then package desktop apps into build/
Pick one [setup]
```

Then which kiosks this checkout runs:

```text
Which kiosks should this checkout run?
  1) public-service   Public Service Kiosk
  2) healthcare       Hospital Concierge Kiosk
  3) all              all of the above
Pick one or more, e.g. 1 or 1,2 [public-service]
```

Development mode runs one kiosk at a time, so with `dev` and several kiosks it
asks which one to run (all of them are still set up). Last, where the AI comes
from:

```text
Where should the AI come from?
  1) studio           live AI from the Edge AI Studio at /path/to/edge-ai-demo-studio
  2) mock             mocked AI and simulated hardware — no studio needed
Pick one [studio]
```

`mock` is the default when there is no studio checkout. After the installs,
`start` hands over to `./start.sh` (every chosen kiosk), `dev` to
`common/scripts/dev/dev.sh --kiosk <name>`, both with `--mock` if you picked it; the line before the
hand-over names the command to use next time. Each answer has a flag:
`--start`, `--dev` or `--build`; `--kiosk`; `--mock`. `--yes`, or no
terminal, asks nothing.

The kiosk answer is saved in `common/.kiosks` (Enter keeps the saved one) and the
root `./start.sh` and `./uninstall.sh` follow it. Answer up
front with `--kiosk public-service`, `--kiosk healthcare` or `--kiosk all`;
`--yes` without `--kiosk` keeps the saved choice (public-service on a fresh
checkout). A kiosk folder's own `scripts/setup.sh` (`healthcare/scripts/setup.sh`) sets up
that kiosk alone and leaves the saved choice untouched.

It then installs npm dependencies for each chosen kiosk's `frontend/`, then sets up the
**Edge AI Studio** prerequisite from `EDGE_AI_STUDIO_DIR` (system dependencies via
sudo, bundled runtimes, AI workers, gateway build). The script fails up front if no
studio checkout is at that path. The studio step is long on first run since it
downloads models and toolchains — pass `--skip-studio` on any terminal that talks
to a gateway running elsewhere. The desktop shell in [electron/](../electron/) is
not set up here: the build installs its npm dependencies itself, when you
actually package the app.

**Building instead of running natively?** `./setup.sh --build` installs the
kiosk dependencies and goes straight into [the build](build.md), one per chosen kiosk. The
studio is *not* set up on that path — the build only exports the bundle from
its checkout, so the checkout has to exist but none of its long setup runs
(add `--studio` if you want both). Everything after `--` goes to the build.
Whatever the run has to ask — which kiosks, setup's own question about the
studio's system packages, the build's kiosk mode / window / package format for
each kiosk — comes before the first install; after that it runs unattended.

Useful variants:

```bash
./setup.sh --start                # set up, then start the kiosks (./start.sh)
./setup.sh --dev --kiosk healthcare --mock   # set up, then common/scripts/dev/dev.sh --kiosk healthcare --mock
./setup.sh --yes                  # non-interactive (CI / provisioning)
./setup.sh --skip-studio          # kiosk dependencies only, no Edge AI Studio
./setup.sh --package-studio       # the studio plus its distributable executable
./setup.sh --hardware             # also install pcscd (NFC), sane-utils (scanner), poppler-utils (OCR)
./setup.sh --build                # kiosk dependencies, then the production build (no studio setup)
./setup.sh --build -- --yes --mode touch --targets=appimage,deb   # …non-interactive
./setup.sh --mock                 # no studio at all (no checkout needed); run with ./start.sh --mock
./setup.sh --build --mock         # …and a mocked desktop app per kiosk; open with ./start.sh --desktop --mock
```

On Windows the same flags reach `common\scripts\win\setup.ps1`. One behaves differently
there, because there is nothing to apt-install: `--hardware` prints the vendor
drivers to install by hand (Smart Card service, PaperStream IP for the fi-800R,
poppler on PATH).

If your studio checkout lives somewhere else, set it once in `common/.kioskrc`
(gitignored; relative paths resolve against `common/`):

```bash
EDGE_AI_STUDIO_DIR="$HOME/somewhere/else/edge-ai-studio"
```

---

## 2. Start

```bash
./start.sh      # Windows: start_win.bat
```

This brings the Edge AI Studio up (unless its gateway is already live at
`STUDIO_URL`), waits for the gateway, then builds (if needed) and serves every
kiosk setup chose — each on its own port, all against the one studio. With
both kiosks running, their output is interleaved and tagged
(`[public-service] …`, `[healthcare] …`), and Ctrl+C stops both; if one of them
exits, the other is stopped too. A missing studio checkout is an error.
`--no-studio` skips the studio entirely: the kiosks then use whatever is live at
`STUDIO_URL` and report the rest on their health page.

| Kiosk | Port (`kiosk.json` `"port"`) |
|---|---|
| public-service | **http://localhost:3000** |
| healthcare | **http://localhost:3001** |

Other entry points (shown for public-service; healthcare has the same on :3001,
plus `/staff`, the staff hub, and `/queue`, the queue board):

| URL | What |
|---|---|
| http://localhost:3000 | Kiosk terminal UI |
| http://localhost:3000/enroll | Staff registration desk |
| http://localhost:3000/settings | Settings page — edits `config.yaml`, restarts the kiosk to apply (same login as `/admin`) |
| http://localhost:3000/mock-documents | Mock documents — a registered citizen's genuine and tampered test documents, as PDFs or a zip (same login as `/admin`) |
| http://localhost:3000/admin | Admin dashboard (Payload CMS) — `admin@demo.local`, password generated on first setup/start and printed by the launcher (`cms.admin_password` in the gitignored `<kiosk>/frontend/config.yaml`) |
| http://localhost:3000/api/health | Aggregated health of all AI services |
| http://localhost:8080 | Edge AI Studio gateway UI |

Variants:

```bash
./start.sh --kiosk healthcare  # just that kiosk, this run only (or: healthcare/scripts/start.sh)
./start.sh --no-studio   # don't start or wait for the studio; use whatever gateway is live
./start.sh --wait-studio # don't start it, but wait for a gateway someone else launches
./start.sh --desktop     # launch the packaged desktop app (one kiosk: --kiosk <name> when both are set up)
./start.sh --rebuild     # force a fresh production build first
./start.sh --port 4000   # serve on another port (several kiosks: 4000, 4001, …)
./start.sh --mock        # explicit opt-in to mocked AI: no studio, verification off
./start.sh --desktop --mock  # open the mocked desktop apps of ./setup.sh --build --mock, every kiosk at once
```

`--studio` is still accepted and is now the default. When the gateway runs on
another machine, point `STUDIO_URL` at it (env or `.kioskrc`) and start with
`--no-studio` or `--wait-studio`.

**Everything defaults to the real, live setup** — live LLM/OCR/face/speech via the
studio, real scanner and NFC hardware. Mocking never happens unless you
explicitly pass `--mock`, and the `reference` profile does not simulate absent
hardware either; `--mock` relaxes `nfc.simulate`, `documents.scanner.simulate`
and `face.require_match` to `auto`, `auto` and `false`.

`--desktop` launches the desktop shell built by `./setup.sh --build` (usually combined
with `--bundle`). The studio is handled exactly as for the web server — started and
waited for unless you pass `--no-studio`.

---

## What start.sh actually does

1. **Checks Node ≥ 20** and that each kiosk's dependencies (`<kiosk>/frontend/node_modules`) are installed (installs if not).
2. **Brings the Edge AI Studio up.** If its gateway isn't already answering at
   `STUDIO_URL` (default `http://localhost:8080`), launches the studio from
   `EDGE_AI_STUDIO_DIR` — failing if no checkout is there — preferring the packaged
   executable under `out/EdgeAIDemoStudio/` if you built one, falling back to the
   studio's headless `start.sh` — and waits until the gateway answers
   (`STUDIO_WAIT_SECS`, default 600 s; the first launch loads AI models). Then warns
   about any service the kiosk's mode needs that isn't active (OCR + face for touch,
   all five for chat/agent). Two flags change
   this: `--wait-studio` only waits, for a gateway something else launches;
   `--no-studio` only probes the gateway and carries on regardless.
3. **Primes the database on first run.** Payload CMS only creates and seeds the
   SQLite schema outside production mode, so if `<kiosk>/frontend/db.sqlite` doesn't exist
   yet the script boots a temporary dev server once, waits for the seeded database
   (100 synthetic citizens — patients in healthcare — public-service's traffic
   fines, and the admin user), and shuts it down.
4. **Builds the frontend** (`npm run build`) if there is no production build yet
   (or if you passed `--rebuild`).
5. **Serves** with `npm run start`, each kiosk on its `kiosk.json` port (or `--port`
   and up). Steps 3–4 run per kiosk, one after the other, before any of them serves.

---

## The Edge AI Studio prerequisite

The kiosk itself has no AI models — every AI feature is an HTTP call to the studio
gateway on port 8080:

| Kiosk feature | Studio service | Endpoint |
|---|---|---|
| Document analysis, chat, agent | text-generation | `/api/text-generation@text-generation/v1` |
| Document OCR | ocr (PaddleOCR) | `/api/ocr@ocr` |
| Face verification | face-recognition | `/api/face-recognition@face-recognition` |
| Voice input | speech-to-text | `/api/speech-to-text@speech-to-text/v1` |
| Voice output | text-to-speech | `/api/text-to-speech@text-to-speech/v1` |

**The gateway being up is not enough — the individual services must be started.**
The launcher scripts handle this whenever they set up or start the studio for you
(`./setup.sh`, `./start.sh` — unless skipped with `--skip-studio` / `--no-studio`): they write the
studio's `deployment.json` from each kiosk's own **`<kiosk>/deployment.json`**, taking the block for the
kiosk's **terminal mode** (from `NEXT_PUBLIC_KIOSK_MODE` / `config.local.yaml` / `config.yaml`):

```json
{
  "modes": {
    "touch": { "services": { "ocr": { "status": "online", "models": { "default": { "device": "NPU" } } }, "…": {} } },
    "chat": { "services": { "text-generation": { "status": "online", "…": {} }, "…": {} } },
    "agent": "chat"
  }
}
```

Each mode's `services` is written in the studio's own `deployment.json` format (the studio's
`docs/deployment-config.md`): `"status": "online"` auto-starts a service, `models` pins its model and
device. A string in place of a block reuses another mode's services. Both kiosks ship the same blocks
today:

| Kiosk mode | Services auto-started |
|---|---|
| `touch` | **ocr + face-recognition** only (text-generation/STT/TTS offline) |
| `chat` (and public service's `agent`) | all five services |

`touch` puts OCR on `NPU` and face on `CPU` and starts **no local LLM at all**: a touch
terminal calls a cloud LLM — a touch build ships Gemini (`gemini-3.5-flash-lite`) with the
API key left for `/settings` (see [build.md](build.md#the-build)); from a checkout, set
`llm.base_url`, `llm.model` and `llm.api_key` yourself or document analysis has nothing to
talk to. Its text-generation entry still carries the model preset, offline, for bundles built
with `--llm local`. `chat`/`agent` run everything locally — LLM on `GPU`, speech-to-text on
`NPU`, the rest on `CPU` — and pin text-generation to Gemma 4 E4B
(`unsloth/gemma-4-E4B-it-GGUF`, Q4_K_M on llama.cpp), the model the kiosk's `config.yaml`
asks for as `llamacpp:unsloth/gemma-4-E4B-it-GGUF:Q4_K_M`. Edit a kiosk's file to retarget its devices or models;
to add a terminal mode, add its block — the launchers, the health check, the embedded bundle and
the desktop build's questions all follow the file. A kiosk with no `deployment.json`, or none
for its mode, stops the launcher with an error naming the file.

When several kiosks share one studio their blocks are merged: the kiosk running the most
services sets the presets, the others add the services it leaves off, and the launcher warns
when two kiosks want the same service with different presets.

The launchers — and the embedded-bundle build, which installs the block of the mode being
built — replace whatever `deployment.json` the checkout holds (the previous file is kept
as `.bak`). To keep a hand-managed file untouched set `STUDIO_DEPLOYMENT_MANAGE=0`,
or force one fixed file with `STUDIO_DEPLOYMENT_FILE`.

The presets are read on every studio boot — if the studio was already running before
they were installed, restart it (or start the services by hand in the studio UI at
http://localhost:8080) for them to take effect.

With LLM or OCR down and document verification required (the default), or face
recognition down while `face.require_match: true` (the `reference` profile), the
kiosk shows its out-of-service screen by design. Healthcare waits on LLM and OCR
only when one of its enabled services takes documents.

---

## Verifying everything is up

```bash
curl -s localhost:3000/api/health | python3 -m json.tool
```

returns `{ ok, services: { llm, ocr, verification, face, stt, tts, nfc, scanner } }`
(healthcare adds `barcode`). `ok: true` means the kiosk is fully operational;
`false` drives the out-of-service screen. Speech and the peripherals are
report-only — they never flip `ok`.
`start.sh` prints per-service warnings on launch, so a bad state is visible before
you ever open the browser.

---

## Stopping

`Ctrl+C` stops the kiosk server. The studio is deliberately **left running** (it's
slow to start and other apps may use it). To stop it too:

```bash
pkill -f edge-ai-demo-studio   # packaged app
pkill -f "next start"          # headless studio server (also matches a kiosk left running)
```

Studio logs from launches made by these scripts land in `common/.studio.log`.

---

## Troubleshooting

- **Out-of-service screen** — some AI service is down; see
  [Verifying](#verifying-everything-is-up) and start the missing service in the
  studio UI, or use `./start.sh --mock`.
- **Studio never becomes healthy** — check `common/.studio.log`. First launches download
  and load models; raise `STUDIO_WAIT_SECS` if needed.
- **Port 3000 (or 3001) already in use** — `./start.sh --port 4000` (with both kiosks:
  4000 and 4001).
- **Reset demo data** — `cd <kiosk>/frontend && npm run db:reset`, then start again (the
  database re-creates and re-seeds itself; `start.sh` re-primes it).
- **NFC/scanner issues** — see the hardware section of
  [configuration.md](configuration.md) and each kiosk's `frontend/README.md`
  ([public-service](../../public-service-kiosk/frontend/README.md#peripheral-drivers),
  [healthcare](../../healthcare/frontend/README.md#peripheral-drivers)).
