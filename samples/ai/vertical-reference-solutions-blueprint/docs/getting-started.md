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
| **Node.js ≥ 20** + npm | Needed to run the kit. If the machine has none (or an older one), `./setup.sh` downloads a portable Node into `thirdparty/node` — checksum-verified against `SHASUMS256.txt` — and every launcher picks it up from there. `start`/`dev`/`build` never download; they use the machine's Node, or the one setup unpacked. |
| **Edge AI Studio** checkout | The AI gateway providing LLM, OCR, face, STT and TTS. `./setup.sh` sets it up and `./start.sh` launches it by default, and both fail when the checkout is missing — pass `--skip-studio` / `--no-studio` to leave it alone. Default location `../edge-ai-demo-studio` (a sibling of this checkout); configurable via `EDGE_AI_STUDIO_DIR`. The packaged build exports the bundle from the checkout, so `./setup.sh --build` needs it present but does not set it up. Not needed to run with `--mock`. |
| Linux (Debian/Ubuntu assumed) or Windows | Each launcher ships twice: `setup.sh`/`start.sh`/`scripts/build.sh` for bash, and `setup_win.bat`/`start_win.bat`/`scripts\build.bat` for Windows (the `_win` suffix keeps the root ones distinguishable when Explorer hides extensions), which run [scripts/win/](../scripts/win/)'s PowerShell equivalents with `-ExecutionPolicy Bypass`. Flags are spelled the same. |
| `poppler-utils` (`pdftoppm`) | Needed for live OCR of PDFs. `./setup.sh --hardware` installs it. |
| Optional hardware | PC/SC NFC reader (`pcscd`), SANE document scanner, webcam. All are simulated when absent — see [configuration.md](configuration.md). |

---

## 1. Setup

```bash
./setup.sh      # Windows: setup_win.bat
```

This installs npm dependencies for [frontend/](../frontend/), then sets up the
**Edge AI Studio** prerequisite from `EDGE_AI_STUDIO_DIR` (system dependencies via
sudo, bundled runtimes, AI workers, gateway build). The script fails up front if no
studio checkout is at that path. The studio step is long on first run since it
downloads models and toolchains — pass `--skip-studio` on any terminal that talks
to a gateway running elsewhere. The desktop shell in [electron/](../electron/) is
not set up here: the build installs its npm dependencies itself, when you
actually package the app.

**Building instead of running natively?** `./setup.sh --build` installs the
kiosk dependencies and goes straight into [`scripts/build.sh`](build.md). The
studio is *not* set up on that path — the build only exports the bundle from
its checkout, so the checkout has to exist but none of its long setup runs
(add `--studio` if you want both). Everything after `--` goes to the build.

Useful variants:

```bash
./setup.sh --yes                  # non-interactive (CI / provisioning)
./setup.sh --skip-studio          # kiosk dependencies only, no Edge AI Studio
./setup.sh --package-studio       # the studio plus its distributable executable
./setup.sh --hardware             # also install pcscd (NFC), sane-utils (scanner), poppler-utils (OCR)
./setup.sh --build                # kiosk dependencies, then the production build (no studio setup)
./setup.sh --build -- --yes --mode touch --targets=appimage,deb   # …non-interactive
```

On Windows the same flags reach `scripts\win\setup.ps1`. One behaves differently
there, because there is nothing to apt-install: `--hardware` prints the vendor
drivers to install by hand (Smart Card service, PaperStream IP for the fi-800R,
poppler on PATH).

If your studio checkout lives somewhere else, set it once in a `.kioskrc` file at the
repo root (gitignored):

```bash
EDGE_AI_STUDIO_DIR="$HOME/somewhere/else/edge-ai-studio"
```

---

## 2. Start

```bash
./start.sh      # Windows: start_win.bat
```

This brings the Edge AI Studio up (unless its gateway is already live at
`STUDIO_URL`), waits for the gateway, then builds (if needed) and serves the kiosk.
A missing studio checkout is an error. `--no-studio` skips the studio entirely: the
kiosk then uses whatever is live at `STUDIO_URL` and reports the rest on its health
page.

Open **http://localhost:3000** — that's the kiosk. Other entry points:

| URL | What |
|---|---|
| http://localhost:3000 | Kiosk terminal UI |
| http://localhost:3000/enroll | Staff registration desk |
| http://localhost:3000/admin | Admin dashboard (Payload CMS) — `admin@demo.local`, password generated on first setup/start and printed by the launcher (`cms.admin_password` in the gitignored `frontend/config.yaml`) |
| http://localhost:3000/api/health | Aggregated health of all AI services |
| http://localhost:8080 | Edge AI Studio gateway UI |

Variants:

```bash
./start.sh --no-studio   # don't start or wait for the studio; use whatever gateway is live
./start.sh --wait-studio # don't start it, but wait for a gateway someone else launches
./start.sh --desktop     # launch the packaged desktop app
./start.sh --rebuild     # force a fresh production build first
./start.sh --port 4000   # serve on another port
./start.sh --mock        # explicit opt-in to mocked AI: no studio, verification off
```

`--studio` is still accepted and is now the default. When the gateway runs on
another machine, point `STUDIO_URL` at it (env or `.kioskrc`) and start with
`--no-studio` or `--wait-studio`.

**Everything defaults to the real, live setup** — live LLM/OCR/face/speech via the
studio, real scanner and NFC hardware when attached. Mocking never happens unless
you explicitly pass `--mock` (hardware that is genuinely absent is the one
exception: it is simulated so the flow can still complete).

`--desktop` launches the desktop shell built by `scripts/build.sh` (usually combined
with `--bundle`). The studio is handled exactly as for the web server — started and
waited for unless you pass `--no-studio`.

---

## What start.sh actually does

1. **Checks Node ≥ 20** and that `frontend/node_modules` exists (installs if not).
2. **Brings the Edge AI Studio up.** If its gateway isn't already answering at
   `STUDIO_URL` (default `http://localhost:8080`), launches the studio from
   `EDGE_AI_STUDIO_DIR` — failing if no checkout is there — preferring the packaged
   executable under `out/EdgeAIDemoStudio/` if you built one, falling back to the
   studio's headless `start.sh` — and waits until the gateway answers
   (`STUDIO_WAIT_SECS`, default 600 s; the first launch loads AI models). Then warns
   about any of the five services the kiosk uses that aren't active. Two flags change
   this: `--wait-studio` only waits, for a gateway something else launches;
   `--no-studio` only probes the gateway and carries on regardless.
3. **Primes the database on first run.** Payload CMS only creates and seeds the
   SQLite schema outside production mode, so if `frontend/db.sqlite` doesn't exist
   yet the script boots a temporary dev server once, waits for the seeded database
   (100 synthetic citizens, fines, portraits, admin user), and shuts it down.
4. **Builds the frontend** (`npm run build`) if there is no production build yet
   (or if you passed `--rebuild`).
5. **Serves** with `npm run start` on port 3000 (or `--port`).

---

## The Edge AI Studio prerequisite

The kiosk itself has no AI models — every AI feature is an HTTP call to the studio
gateway on port 8080:

| Kiosk feature | Studio service | Endpoint |
|---|---|---|
| Document analysis, chat, agent | text-generation | `/api/text-generation/v1` |
| Document OCR | ocr (PaddleOCR) | `/api/ocr` |
| Face verification | face-recognition | `/api/face-recognition` |
| Voice input | speech-to-text | `/api/speech-to-text/v1` |
| Voice output | text-to-speech | `/api/text-to-speech/v1` |

**The gateway being up is not enough — the individual services must be started.**
The launcher scripts handle this whenever they set up or start the studio for you
(`./setup.sh`, `./start.sh` — unless skipped with `--skip-studio` / `--no-studio`): they install a preset file as the
studio's `deployment.json`, chosen by the kiosk's **terminal mode** (from `NEXT_PUBLIC_KIOSK_MODE` / `config.local.yaml` / `config.yaml`):

| Kiosk mode | Profile installed | Services auto-started |
|---|---|---|
| `touch` | [scripts/studio-deployment.touch.json](../scripts/studio-deployment.touch.json) | **ocr + face-recognition** only (text-generation/STT/TTS explicitly offline) |
| `chat` / `agent` | [scripts/studio-deployment.chat.json](../scripts/studio-deployment.chat.json) | all five services |

Both profiles hardcode the devices — edit the files to retarget. `touch` puts OCR on
`NPU` and face on `CPU` and starts **no local LLM at all**: a touch terminal calls a
remote text-generation gateway, so set `llm.base_url` (or `KIOSK_LLM_BASE_URL`) to
that gateway or document analysis has nothing to talk to. `chat`/`agent` run
everything locally — LLM on `GPU`, the rest on `CPU` — and pin text-generation to the
model the kiosk's `config.yaml` expects (`openvino:OpenVINO/Qwen3.5-4B-int4-ov`). The launchers — and the
embedded-bundle build, which installs the profile of the mode being built —
replace whatever `deployment.json` the checkout holds (the previous file is kept
as `.bak`). To keep a hand-managed file untouched set `STUDIO_DEPLOYMENT_MANAGE=0`,
or force a specific file with `STUDIO_DEPLOYMENT_FILE`.

The presets are read on every studio boot — if the studio was already running before
they were installed, restart it (or start the services by hand in the studio UI at
http://localhost:8080) for them to take effect.

With LLM or OCR down and document verification required (the default), the kiosk
shows its out-of-service screen by design.

---

## Verifying everything is up

```bash
curl -s localhost:3000/api/health | python3 -m json.tool
```

returns `{ ok, services: { llm, ocr, verification, face, stt, tts } }`. `ok: true`
means the kiosk is fully operational; `false` drives the out-of-service screen.
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

Studio logs from launches made by these scripts land in `.studio.log` at the repo root.

---

## Troubleshooting

- **Out-of-service screen** — some AI service is down; see
  [Verifying](#verifying-everything-is-up) and start the missing service in the
  studio UI, or use `./start.sh --mock`.
- **Studio never becomes healthy** — check `.studio.log`. First launches download
  and load models; raise `STUDIO_WAIT_SECS` if needed.
- **Port 3000 already in use** — `./start.sh --port 4000` (the CMS proxy follows the
  port automatically).
- **Reset demo data** — `cd frontend && npm run db:reset`, then start again (the
  database re-creates and re-seeds itself; `start.sh` re-primes it).
- **NFC/scanner issues** — see the hardware section of
  [configuration.md](configuration.md) and [frontend/README.md](../frontend/README.md).
