# 🛠️ Development Mode

How to run the blueprint for day-to-day development: hot reload, mocked hardware and
AI, database resets, and the test suite.

- [Quick start](#quick-start)
- [What dev mode does](#what-dev-mode-does)
- [Running fully mocked (no AI gateway, no hardware)](#running-fully-mocked)
- [Working on the desktop (Electron) shell](#working-on-the-desktop-electron-shell)
- [Useful dev commands](#useful-dev-commands)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)

---

## Quick start

```bash
./setup.sh --dev                                  # once — installs deps and the Edge AI Studio prerequisite, then runs dev mode
common/scripts/dev/dev.sh --kiosk public-service  # from then on: the Edge AI Studio gateway + that kiosk's dev server
common/scripts/dev/dev.sh --kiosk healthcare      # …or the healthcare kiosk's
```

Dev mode runs one kiosk per command, on its own port (`kiosk.json` `"port"`):
public-service on **3000**, healthcare on **3001** (`PORT=<n>` overrides it), so
both can hot-reload side by side in two terminals. Without `--kiosk`,
`common/scripts/dev/dev.sh` drives the public-service kiosk.

On Windows: `setup_win.bat --dev`, then `common\scripts\dev\dev.bat --kiosk <name>` —
the same flags, running [scripts/win/dev.ps1](../scripts/win/dev.ps1).

Then open (public-service shown; healthcare is the same on :3001):

| URL | What |
|---|---|
| http://localhost:3000 | Kiosk UI — opens on the terminal `terminal.mode` names, with a touch/chat toggle |
| http://localhost:3000/chat | Chat / voice terminal |
| http://localhost:3000/enroll | Staff registration desk |
| http://localhost:3000/settings | Settings page — edits `config.yaml`; its restart button restarts the dev server (Next's own exit code 77) |
| http://localhost:3000/mock-documents | Mock documents — pick a registered citizen, generate their genuine and tampered sets, download a PDF or a zip (CMS admin login) |
| http://localhost:3000/admin | Payload CMS admin (`admin@demo.local`; the password `common/scripts/dev/dev.sh` prints, from `cms.admin_password`) |
| http://localhost:3000/api/health | Aggregated service health JSON |
| http://localhost:8080 | Edge AI Studio gateway |

`./common/scripts/dev/dev.sh` is a thin orchestrator: it health-checks the Edge AI Studio gateway
(starting it from `EDGE_AI_STUDIO_DIR` if it isn't running), then runs `npm run dev`
in the kiosk's `frontend/` ([public-service](../../public-service-kiosk/frontend/),
[healthcare](../../healthcare/frontend/)). Stop everything with `Ctrl+C`.

Flags (see `./common/scripts/dev/dev.sh --help`):

| Flag | Effect |
|---|---|
| `--mock` | Skip the studio entirely and run with mocked AI (`KIOSK_LLM_MOCK=true`, verification not required). |
| `--no-studio` | Don't start/check the studio, but keep live AI settings (use when the gateway runs elsewhere). |
| `--desktop` | Run the desktop shell in dev mode instead of the plain browser dev server. |

---

## What dev mode does

- **Next.js dev server** with hot module reload — edit anything under the kiosk's
  `frontend/src/` ([public-service](../../public-service-kiosk/frontend/src/),
  [healthcare](../../healthcare/frontend/src/)) and the page updates in place.
- **Database auto-setup** — on the first request, Payload creates `<kiosk>/frontend/db.sqlite`
  and seeds it: 100 synthetic citizens from `<kiosk>/frontend/data/citizens.csv`
  (public-service also seeds their traffic fines), and the admin user. No reference
  portraits ship with the kit; drop your own into `<kiosk>/frontend/data/faces/` to
  seed them.
- **Real hardware, no fallback** — the `reference` profile is strict
  (`nfc.simulate: never`, `documents.scanner.simulate: never`,
  `face.require_match: true`): `documents.source: scanner` drives a real SANE
  scanner and the card read needs a real PC/SC reader. On a laptop use `--mock`,
  the `simulated` profile, or set those three to `auto`/`auto`/`false` in
  `config.local.yaml`; the stand-ins (documents from `documents.mocks_dir`, a
  registry citizen for the card read) then carry the whole flow
  (welcome → verify → documents → payment → receipt).

Configuration in dev follows the normal precedence (env vars →
`<kiosk>/frontend/config.local.yaml` → `<kiosk>/frontend/config.yaml`); see
[configuration.md](configuration.md). Put personal overrides in `config.local.yaml` —
it's gitignored.

---

## Running fully mocked

For UI work you don't need the AI gateway at all:

```bash
./common/scripts/dev/dev.sh --mock
```

which mocks the LLM, turns off the document-verification and face-match
requirements, lets the card reader and scanner fall back to simulation (`auto`),
and blanks the OCR/face/STT/TTS base URLs so those services count as
intentionally *off* (a configured-but-unreachable service would fail
`/api/health` and show the out-of-service screen). The manual equivalent:

```bash
cd <kiosk>/frontend
KIOSK_LLM_MOCK=true KIOSK_REQUIRE_DOCUMENT_VERIFICATION=false \
KIOSK_FACE_REQUIRE_MATCH=false KIOSK_NFC_SIMULATE=auto KIOSK_SCANNER_SIMULATE=auto \
KIOSK_OCR_BASE_URL= KIOSK_FACE_BASE_URL= KIOSK_STT_BASE_URL= KIOSK_TTS_BASE_URL= \
npm run dev
```

Or persist it in `<kiosk>/frontend/config.local.yaml`:

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
  base_url: ""
face:
  base_url: ""
  require_match: false
```

In mock mode the LLM verdict is controlled by `llm.mock_verdict` (`match` /
`mismatch`) — handy for testing the rejection path.

> The default (`reference`) config expects a **live** gateway (`llm.mock: false`). If you
> run `npm run dev` directly without the gateway and without a mock override, the
> kiosk shows the out-of-service screen — that's `GET /api/health` failing, not a bug.

---

## Working on the desktop (Electron) shell

```bash
./common/scripts/dev/dev.sh --desktop
# equivalent to: cd common/electron && npm run dev
```

This stages the frontend, then runs `electron .` — a window wrapping the app on
the shell's own Chromium. Node is the only toolchain; edit `common/electron/main.js`
and re-run to pick up shell changes.

See [build.md](build.md) for producing an actual installable bundle.

---

## Mirroring the checkout elsewhere

`common/scripts/dev/update.sh` replaces the contents of another directory with this
checkout — the release tree, a working copy on the terminal hardware, a USB
stick:

```bash
./common/scripts/dev/update.sh --dry-run                   # list what would go and come in the release tree
./common/scripts/dev/update.sh                             # ask, then wipe and copy into the release tree
./common/scripts/dev/update.sh /path/to/target             # the same, into another directory
```

On Windows: `common\scripts\dev\update.bat [target-dir]` — the same flags.

Without a target it updates the release tree,
`samples/ai/retail/` of an `applications.platforms.network-and-edge-developer-kits`
checkout next to this one.

What travels is what git tracks plus what is untracked and not gitignored, so
`node_modules/`, `build/`, `db.sqlite`, `.kioskrc` and `config.local.yaml`
never do; the target runs `./setup.sh` for itself. The update scripts stay
behind too — they belong to the checkout you mirror *from*. `.git`, `.claude`,
`.github`, `.vscode`, `build` and `healthcare` are left alone: not copied, and
not removed from the target, so the release tree keeps its own workflows and
does not get the healthcare kiosk yet. `--keep <name>` adds an entry to that
list, `--all` empties it. The target is emptied, which the script asks about
first (`-y` skips the question); it refuses to touch `/`, `$HOME`, this
checkout, or anything containing it.

---

## Useful dev commands

All run inside the kiosk's `frontend/` ([public-service](../../public-service-kiosk/frontend/),
[healthcare](../../healthcare/frontend/)) unless noted:

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server on the kiosk's port (3000 public-service, 3001 healthcare). |
| `npm run lint` | ESLint. |
| `npm run db:reset` | Delete `db.sqlite` (+ WAL files); next request recreates and reseeds it. |
| `npm run mocks:gen` | Regenerate mock scan documents for citizen 1 into `../assets/mocks`. Variants: `node scripts/gen-mock-docs.mjs --citizens 1,4,7`, `--all`. The same documents download from `/mock-documents`. |
| `npm run nfc:probe` | Watch a real PC/SC reader and print card UIDs (`-- --once` for a single read). |
| `npm run payload` | Payload CLI against the kiosk config. |
| `curl localhost:3000/api/identity/card` | Manual NFC read (waits up to 15 s; `?timeout=0` returns what's on the reader now). |
| `cd common/electron && npm run stage` | Stage the frontend into the shell's resources without building a bundle. |

### Service catalog development

Services are auto-discovered from folders under the country pack,
`<kiosk>/frontend/src/packs/<pack>/services/<category>/<group>/<service>/service.ts`
— adding a service is adding a folder with a `service.ts`; deleting the folder
removes it everywhere (in healthcare, `npm run modules -- remove <id>` does that
and tidies up after it — see [healthcare/docs/modules.md](../../healthcare/docs/modules.md)).
See [country-packs.md](country-packs.md) for the layout and each kiosk's
`frontend/README.md` ([public-service](../../public-service-kiosk/frontend/README.md),
[healthcare](../../healthcare/frontend/README.md)) for the service spec format.

---

## Tests

Playwright end-to-end tests live in `<kiosk>/frontend/tests/`:

```bash
cd <kiosk>/frontend
npm test               # full suite (~10 min, workers: 1)
npm run test:report    # open the HTML report
```

The Playwright config auto-starts `npm run dev` and waits on `/api/health` at the
kiosk's port (`http://localhost:3000` for public-service, `:3001` for healthcare),
reusing an already-running dev server — unless
`KIOSK_BASE` names a server you started yourself. `npm run test:ui` runs the specs that
need no AI service against a `--mock` server; CI runs both ([ci.md](ci.md)). **The
suite expects live AI services** (the Edge AI Studio gateway) — see each kiosk's
`frontend/tests/README.md` ([public-service](../../public-service-kiosk/frontend/tests/README.md),
[healthcare](../../healthcare/frontend/tests/README.md)) for prerequisites, and keep
`mock.identity.citizen` consistent with `documents.mocks_dir` (the tests gate on this
pairing).

---

## License headers

Every source file that can carry a comment gets the Intel Apache-2.0 header. To
stamp new files:

```bash
./common/scripts/add-license-headers.sh              # whole repo
./common/scripts/add-license-headers.sh <kiosk>/frontend/src # limited to a path
./common/scripts/add-license-headers.sh --dry-run    # report only
./common/scripts/add-license-headers.sh --check      # CI gate, exits 1 if any file is missing it
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
  handles this) or go mocked (`common/scripts/dev/dev.sh --kiosk <name> --mock`).
- **Stale/odd registry data** — `npm run db:reset` and reload.
- **NFC reads fail on Linux** — the PC/SC daemon must be running:
  `sudo apt install pcscd libpcsclite1 && sudo systemctl start pcscd`, then
  `npm run nfc:probe`.
- **Scanner testing without hardware** — set `documents.source: mock`, or enable
  SANE's virtual backend (`test` in `/etc/sane.d/dll.conf`, `device: test:0`, and
  comment out `mode`/`source`/`args`).
