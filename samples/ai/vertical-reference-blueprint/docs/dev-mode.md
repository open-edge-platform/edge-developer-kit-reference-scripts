# 🛠️ Development Mode

How to run the blueprint for day-to-day development: hot reload, mocked hardware and
AI, database resets, and the test suite.

- [Quick start](#quick-start)
- [What dev mode does](#what-dev-mode-does)
- [Running fully mocked (no AI gateway, no hardware)](#running-fully-mocked)
- [Working on the desktop (Tauri) shell](#working-on-the-desktop-tauri-shell)
- [Useful dev commands](#useful-dev-commands)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)

---

## Quick start

```bash
./setup.sh            # once — installs deps, builds the Edge AI Studio prerequisite
./scripts/dev/dev.sh      # start the Edge AI Studio gateway + Next.js dev server
```

On Windows: `setup_win.bat`, then `scripts\dev\dev.bat` — the same flags, running
[scripts/win/dev.ps1](../scripts/win/dev.ps1).

Then open:

| URL | What |
|---|---|
| http://localhost:3000 | Kiosk UI (touch mode home) |
| http://localhost:3000/chat | Chat / voice terminal |
| http://localhost:3000/enroll | Staff registration desk |
| http://localhost:3000/admin | Payload CMS admin (`admin@demo.local`; the password `scripts/dev/dev.sh` prints, from `cms.admin_password`) |
| http://localhost:3000/api/health | Aggregated service health JSON |
| http://localhost:8080 | Edge AI Studio gateway |

`./scripts/dev/dev.sh` is a thin orchestrator: it health-checks the Edge AI Studio gateway
(starting it from `EDGE_AI_STUDIO_DIR` if it isn't running), then runs `npm run dev`
in [frontend/](../frontend/). Stop everything with `Ctrl+C`.

Flags (see `./scripts/dev/dev.sh --help`):

| Flag | Effect |
|---|---|
| `--mock` | Skip the studio entirely and run with mocked AI (`KIOSK_LLM_MOCK=true`, verification not required). |
| `--no-studio` | Don't start/check the studio, but keep live AI settings (use when the gateway runs elsewhere). |
| `--tauri` | Run the desktop shell in dev mode instead of the plain browser dev server. |

---

## What dev mode does

- **Next.js dev server** with hot module reload — edit anything under
  [frontend/src/](../frontend/src/) and the page updates in place.
- **Database auto-setup** — on the first request, Payload creates `frontend/db.sqlite`
  and seeds it: 100 synthetic citizens from `frontend/data/citizens.csv`, matching
  traffic fines, and the admin user. No reference portraits ship with the kit; drop
  your own into `frontend/data/faces/` to seed them.
- **Real hardware first, simulated when absent** — the defaults are live:
  `documents.source: scanner` drives a real SANE scanner and `nfc.simulate: auto`
  reads a real PC/SC card reader. On a laptop without the devices, the same
  settings fall back to simulated captures (stand-in documents from
  `documents.mocks_dir`, a registry citizen for the card read), so the whole flow
  (welcome → verify → documents → payment → receipt) still works.

Configuration in dev follows the normal precedence (env vars →
`frontend/config.local.yaml` → `frontend/config.yaml`); see
[configuration.md](configuration.md). Put personal overrides in `config.local.yaml` —
it's gitignored.

---

## Running fully mocked

For UI work you don't need the AI gateway at all:

```bash
./scripts/dev/dev.sh --mock
```

which mocks the LLM, turns off the document-verification requirement, and blanks the
OCR/face/STT/TTS base URLs so those services count as intentionally *off* (a
configured-but-unreachable service would fail `/api/health` and show the
out-of-service screen). The manual equivalent:

```bash
cd frontend
KIOSK_LLM_MOCK=true KIOSK_REQUIRE_DOCUMENT_VERIFICATION=false \
KIOSK_OCR_BASE_URL= KIOSK_FACE_BASE_URL= KIOSK_STT_BASE_URL= KIOSK_TTS_BASE_URL= \
npm run dev
```

Or persist it in `frontend/config.local.yaml`:

```yaml
llm:
  mock: true
documents:
  require_verification: false
ocr:
  base_url: ""
face:
  base_url: ""
```

In mock mode the LLM verdict is controlled by `llm.mock_verdict` (`match` /
`mismatch`) — handy for testing the rejection path.

> The default (`reference`) config expects a **live** gateway (`llm.mock: false`). If you
> run `npm run dev` directly without the gateway and without a mock override, the
> kiosk shows the out-of-service screen — that's `GET /api/health` failing, not a bug.

---

## Working on the desktop (Tauri) shell

```bash
./scripts/dev/dev.sh --tauri
# equivalent to: cd tauri && npm run dev
```

This stages the frontend, then runs `tauri dev` — a native window wrapping the app,
with Rust rebuilds on change. First run compiles the Rust workspace (minutes); later
runs are incremental. Requires the Rust toolchain and WebKitGTK dev packages
(`./setup.sh --desktop` installs them on Debian/Ubuntu).

See [build.md](build.md) for producing an actual installable bundle.

---

## Mirroring the checkout elsewhere

`scripts/dev/update.sh` replaces the contents of another directory with this
checkout — a working copy on the terminal hardware, a staging tree, a USB
stick:

```bash
./scripts/dev/update.sh --dry-run /path/to/target   # list what would go and come
./scripts/dev/update.sh /path/to/target             # ask, then wipe and copy
```

On Windows: `scripts\dev\update.bat <target-dir>` — the same flags.

What travels is what git tracks plus what is untracked and not gitignored, so
`node_modules/`, `build/`, `db.sqlite`, `.kioskrc` and `config.local.yaml`
never do; the target runs `./setup.sh` for itself. The update scripts stay
behind too — they belong to the checkout you mirror *from*. `.git` and
`.claude` are excluded from the copy and left alone in the target, so
mirroring onto a checkout keeps its history — `--all` wipes those too,
`--keep <name>` spares another entry. The target is emptied, which the script
asks about first (`-y` skips the question); it refuses to touch `/`, `$HOME`,
this checkout, or anything containing it.

---

## Useful dev commands

All run inside [frontend/](../frontend/) unless noted:

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server on :3000. |
| `npm run lint` | ESLint. |
| `npm run db:reset` | Delete `db.sqlite` (+ WAL files); next request recreates and reseeds it. |
| `npm run mocks:gen` | Regenerate mock scan documents for citizen 1. Variants: `node scripts/gen-mock-docs.mjs --citizens 1,4,7`, `--all`. |
| `npm run nfc:probe` | Watch a real PC/SC reader and print card UIDs (`-- --once` for a single read). |
| `npm run payload` | Payload CLI against the kiosk config. |
| `curl localhost:3000/api/identity/card` | Manual NFC read (waits up to 15 s; `?timeout=0` returns what's on the reader now). |
| `cd tauri && npm run stage` | Stage the frontend into the Tauri resources without building a bundle. |

### Service catalog development

Services are auto-discovered from folders under
[frontend/src/services/](../frontend/src/services/) — adding a service is adding a
folder with a `service.ts`; deleting the folder removes it everywhere. See
[frontend/README.md](../frontend/README.md) for the service spec format.

---

## Tests

Playwright end-to-end tests live in `frontend/tests/`:

```bash
cd frontend
npm test               # full suite (~10 min, workers: 1)
npm run test:report    # open the HTML report
```

The Playwright config auto-starts `npm run dev` and waits on
`http://localhost:3000/api/health`, reusing an already-running dev server. **The
suite expects live AI services** (the Edge AI Studio gateway) — see
[frontend/tests/README.md](../frontend/tests/README.md) for prerequisites, and keep
`mock.identity.citizen` consistent with `documents.mocks_dir` (the tests gate on this
pairing).

---

## License headers

Every source file that can carry a comment gets the Intel Apache-2.0 header. To
stamp new files:

```bash
./scripts/add-license-headers.sh              # whole repo
./scripts/add-license-headers.sh frontend/src # limited to a path
./scripts/add-license-headers.sh --dry-run    # report only
./scripts/add-license-headers.sh --check      # CI gate, exits 1 if any file is missing it
```

The script picks the comment syntax per file type (`#` for shell/PowerShell/YAML/
Python, `//` for TS/TSX/JS/Rust/SCSS, `/* */` for CSS, `<!-- -->` for HTML, `REM`
for batch) and keeps interpreter lines on top — shebangs, `@echo off`, `<!doctype>`,
`@charset` and `#Requires`. It preserves CRLF endings in `.bat`, skips files that
already have an `SPDX-License-Identifier`, and skips formats with no comment syntax
(JSON, lockfiles, CSV), Markdown, generated Payload files and binaries.

---

## Troubleshooting

- **Out-of-service screen on load** — the health check failed. Check
  `curl localhost:3000/api/health`; either start the studio gateway (`./start.sh`
  handles this) or go mocked (`./scripts/dev/dev.sh --mock`).
- **Stale/odd registry data** — `npm run db:reset` and reload.
- **NFC reads fail on Linux** — the PC/SC daemon must be running:
  `sudo apt install pcscd libpcsclite1 && sudo systemctl start pcscd`, then
  `npm run nfc:probe`.
- **Scanner testing without hardware** — set `documents.source: mock`, or enable
  SANE's virtual backend (`test` in `/etc/sane.d/dll.conf`, `device: test:0`, and
  comment out `mode`/`source`/`args`).
