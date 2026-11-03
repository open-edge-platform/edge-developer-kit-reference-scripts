---
name: run-vertical-reference-solutions-blueprint
description: Build, run, screenshot and drive the Vertical Reference Solutions Blueprint — the Next.js public-service kiosk (touch, chat and agent terminals), its Payload CMS admin, the staff enrolment desk and its HTTP API. Use when asked to run, start, launch, build, test, screenshot, reproduce a bug in, or click through the kiosk, or to verify a change works in the real running app.
---

# Running the Vertical Reference Solutions Blueprint

The kiosk is a **Next.js 16 app** (`public-service-kiosk/frontend/`) with a Payload CMS registry in
SQLite, plus an Electron desktop shell (`common/electron/`) that wraps the same server. Every
interesting surface is a multi-step React flow behind buttons — consent →
MyKad read → face check → service questions → payment → receipt — so `curl`
cannot check any of it. Drive it with the committed driver:

```
.github/skills/run-vertical-reference-solutions-blueprint/driver.mjs
```

All paths below are relative to the repo root.

> The kiosk's AI (LLM, OCR, face, speech) lives in a **separate Edge AI Studio**
> checkout on `:8080`. It is not set up in every environment, and everything
> here runs **without it**, in mock mode. See [Live AI](#live-ai) for what that
> costs you.

## Prerequisites

Node ≥ 20 and the kiosk's dependencies. `npm install` runs inside the kiosk's
own `frontend/` (each kiosk has its own `node_modules` and lockfile) and a seeded
`public-service-kiosk/frontend/db.sqlite` is usually already present in a checkout; if not:

```bash
./setup.sh                      # npm install at the repo root, no AI gateway
```

The driver needs a Chromium for Playwright — one download, then cached:

```bash
cd public-service-kiosk/frontend && npx playwright install chromium
```

Nothing else. No `apt-get`, no display server: Chromium runs headless and the
kiosk's camera/NFC/scanner hardware is all simulated when absent.

## Run: the agent path

One command takes you from nothing to a finished citizen transaction with
screenshots:

```bash
node .github/skills/run-vertical-reference-solutions-blueprint/driver.mjs smoke --mode=touch
```

It starts `next dev` (detached, mock mode) if nothing is listening, then walks
Road Tax Renewal to a receipt, screenshotting each step to `.kiosk-run/`:

```
smoke: touch kiosk
  shot -> .kiosk-run/01-landing.png
  saw /Privacy notice & consent/
  saw /read — Nadia Rahman|Nadia Rahman/
  saw /Identity confirmed|Welcome, Nadia/
  saw /Total due/
  shot -> .kiosk-run/07-receipt.png

SMOKE PASSED — reached the receipt (Case ID PSK-2026-1856)
```

`--mode=chat` runs the same service through the assistant kiosk instead
(6 screenshots, same receipt). Both are verified working.

### Driving it yourself

`run` reads commands from stdin and keeps **one** browser and page alive across
all of them, so a whole flow fits in a single call:

```bash
node .github/skills/run-vertical-reference-solutions-blueprint/driver.mjs run --mode=touch <<'EOF'
goto /
click Touch to Begin
click Transport & Licensing
click Road Tax Renewal
wait Privacy notice & consent
ss consent
buttons
text
EOF
```

| command | what it does |
|---|---|
| `goto <route>` | navigate (`/`, `/admin`, `/enroll`, `/settings`) |
| `click <name>` | click a button whose accessible name **contains** `<name>` |
| `clickx <name>` | same, but the name must match exactly |
| `wait <regex>` | wait up to 60 s for matching text to become visible |
| `find <regex>` | how many matches right now, no waiting |
| `text` | the page's visible text |
| `buttons` | accessible names of every visible button |
| `upload <n> <file>` | set a file on the nth (0-based) `input[type=file]` |
| `fill <selector> <value>` | fill an input |
| `eval <js>` | evaluate in the page, print the result |
| `ss <name>` | screenshot → `.kiosk-run/<name>.png` |
| `login` | sign in to Payload admin as `admin@demo.local` |
| `health` | print `/api/health` |
| `errors` | console + page errors collected so far |
| `sleep <ms>` | wait |

Other subcommands:

```bash
driver.mjs serve --mode=chat     # just start the server, detached
driver.mjs shot /admin admin     # one route, one screenshot
driver.mjs stop                  # kill it
driver.mjs help                  # the above, from the source of truth
```

Screenshots and `dev.log` land in `.kiosk-run/` (gitignored; override with
`$KIOSK_SHOTS`). Base URL is `$KIOSK_BASE`, default `http://127.0.0.1:3000`.

### The API, without a browser

Registry and catalog routes answer directly — useful when a change touches
`public-service-kiosk/frontend/src/services/` or `public-service-kiosk/frontend/src/app/api/` rather than the UI:

```bash
curl -s 127.0.0.1:3000/api/health
curl -s 127.0.0.1:3000/api/catalog
curl -s "127.0.0.1:3000/api/vehicles?documentNumber=MY3080592042"
curl -s "127.0.0.1:3000/api/fines?lookupBy=mykad&reference=MY3080592042"
```

The seeded demo citizen the driver pins is **CitizenKey 1, NADIA RAHMAN,
`MY3080592042`** (`public-service-kiosk/frontend/tests/helpers/kiosk.ts` has her details and those of
the other fixtures).

## Run: the human path

```bash
common/scripts/dev/dev.sh --mock      # Next dev server on :3000, hot reload, no AI gateway needed
./start.sh --mock    # production build, then serve (slower first run)
```

Then open http://127.0.0.1:3000. Useless headless — that is what the driver is
for. Entry points: `/` kiosk, `/enroll` staff desk, `/settings` settings page
(edits config.yaml; its restart button exits the server with code 77, which
`next dev` and the launchers treat as "start again"), `/admin` CMS
(`admin@demo.local`; the password is whatever `cms.admin_password` holds — the
driver's `login` reads it from the config), `/api/health`.

Dropping `--mock` from either makes them start and wait on the Edge AI Studio
instead; that path was not exercised here (see [Live AI](#live-ai)).

## Test

`npm test` in `public-service-kiosk/frontend/` is a **live-AI suite and it is meant to fail without
the gateway.** An `ai-gate` project runs first and fail-closes the whole run —
running just that gate in mock mode:

```bash
cd public-service-kiosk/frontend && npx playwright test --project=ai-gate
```
```
Error: document verification is unavailable — no verdict can be reached, so
every verification test below would be meaningless.
    Expected: "ok"
    Received: "off"
  1 failed
  2 passed (3.5s)
```

That is correct behaviour in mock mode, not a broken checkout. There is no
mock-mode subset of the suite — **the driver is the only way to exercise the app
without the Edge AI Studio**, which is why it exists.

<a id="live-ai"></a>
## Live AI

Real document verification, voice and face matching need the Edge AI Studio
checkout (default `../edge-ai-demo-studio`, a sibling of this repo; override
with `EDGE_AI_STUDIO_DIR`) set up and running on `:8080`. `./setup.sh` does it;
the first run downloads models and takes a long time.

**Not verified here** — the studio in this environment has no `node_modules`,
so nothing below the mock path was exercised. `common/docs/getting-started.md` is the
reference for it.

## Desktop (Electron) build

`./setup.sh --build` (installs the kiosk deps first and skips the studio
setup; `common/scripts/build.sh` is the build alone) packages the embedded bundle as an Electron
app — one studio with every kiosk `./setup.sh` chose as a sample of its gallery — into `build/` at the repo root; `cd common/electron && ./build.sh --yes` packages the standalone kiosk. Node ≥ 20 is the only
toolchain. Both were built and run here (2026-09-01).

To run a packaged AppImage in this environment:

```bash
env -u ELECTRON_RUN_AS_NODE setsid nohup "build/<app>.AppImage" \
  --appimage-extract-and-run --ozone-platform=x11 --remote-debugging-port=9333 \
  > shell.log 2>&1 < /dev/null &
```

- VS Code exports `ELECTRON_RUN_AS_NODE=1` into tool shells — with it set, any
  Electron binary runs as plain node (`bad option: --no-sandbox`). Unset it.
- No libfuse2 here → `--appimage-extract-and-run`. The box has a Wayland
  session, so `--ozone-platform=x11` works; `headless` crashes after ready.
- Then point this driver at the server the shell started (`KIOSK_BASE`, and
  `rm .kiosk-run/mode` first so it never tries to restart it), or screenshot the
  real window with Playwright `connectOverCDP("http://127.0.0.1:9333")` from
  `public-service-kiosk/frontend/`. Only one shell instance runs at a time (single-instance lock).

`common/electron/README.md` covers the shell itself.

## Gotchas

- **`--mock` alone used to leave the kiosk out of service.** Mocking the LLM
  does not mock OCR/face/speech — those stay pointed at the absent gateway, and
  a *configured but unreachable* service fails `/api/health`, which paints the
  out-of-service screen. The fix is to blank the URLs so they count as
  intentionally `off`. `common/scripts/common.sh:export_mock_env` now does this, and
  the driver sets the same env itself. Always confirm `"ok":true` before
  believing a UI failure:
  ```bash
  curl -s 127.0.0.1:3000/api/health
  # {"ok":true,"services":{"llm":"ok","ocr":"off","verification":"off",...}}
  ```
  `ok:false` means you are looking at the out-of-service screen, not a bug.

- **Backgrounding the dev server from a tool call kills it.** A plain `&` dies
  with the shell's process group the moment the call returns. Use `setsid nohup
  … < /dev/null &`, which is what the driver does.

- **`pkill -f "next start"` kills your own shell.** The pattern appears in the
  command line of the shell running `pkill`, so it matches itself — the shell
  dies (exit 143/144) and the server survives. `common/docs/getting-started.md`
  suggests this command; bracket one character to make it safe:
  ```bash
  pkill -f 'next[ ]start'      # not: pkill -f "next start"
  ```
  Or just use `driver.mjs stop`, which brackets all three patterns.

- **Switching terminal mode needs a server restart.** `terminal.mode` reaches
  the browser as `NEXT_PUBLIC_KIOSK_MODE`, which Next inlines into the client
  bundle at boot. The driver records the mode it booted with in
  `.kiosk-run/mode` and restarts itself when you ask for a different one — but
  a server *you* started by hand will quietly keep serving the old mode.

- **`playwright` isn't necessarily where you'd expect.** It's a `public-service-kiosk/frontend`
  devDependency, hoisted to the repo root's `node_modules` by the npm
  workspace — `public-service-kiosk/frontend/node_modules` itself is usually empty. The
  driver resolves it via `createRequire(public-service-kiosk/frontend/package.json)`, which
  finds it either way. A script anywhere outside `public-service-kiosk/frontend/` should do
  the same rather than assume a fixed `node_modules` location.

- **Buttons match twice.** Several kiosk screens wrap the entire card in an
  outer `<button>`, so a substring name match hits both it and the real control
  and Playwright's strict mode refuses. The driver takes `.last()` — the
  innermost match, which is the one a citizen presses.

- **Chromium needs the fake-camera flags.** The identity step calls
  `getUserMedia`. Without `--use-fake-ui-for-media-stream` and
  `--use-fake-device-for-media-stream` the permission prompt hangs the step
  instead of falling through to the simulated scan. The driver passes both.

- **The two kiosks order identity differently.** Touch asks for consent and the
  card *before* the service questions; chat opens the service first and the
  identity overlay follows the chip. A flow written for one stalls on the other.

- **Touch parks before the receipt.** After payment it shows "Payment received"
  and waits for a **View Receipt** click; the chat kiosk streams the receipt out
  by itself.

- **`/enroll` and `/settings` are staff-gated.** They redirect to `/admin/login`.
  Use the driver's `login` command first (fields are `#field-email` /
  `#field-password`). The settings spec runs without the AI gate:
  `KIOSK_BASE=<url> npx playwright test tests/verify/settings.spec.ts --config tests/verify/no-gate.config.ts`.

- **`/api/identity/card` is a hardware bench route and never simulates.** It
  returns 503 `no_service` with no `pcscd` running, by design — it exists to
  read a real card's serial. The identity *step* uses `/api/identity/document`,
  which does stand a citizen in. A 503 there is not a broken kiosk.

- **Pin the mock ID reader.** Unpinned, it stands in a *random* citizen per read
  and every name assertion becomes a coin flip. The driver sets
  `KIOSK_READER_CITIZEN=1` (Nadia Rahman).

## Troubleshooting

| symptom | fix |
|---|---|
| `Cannot find package 'playwright'` | Script is outside `public-service-kiosk/frontend/`. Resolve via `createRequire`, as the driver does. |
| `browserType.launch: Executable doesn't exist` | `cd frontend && npx playwright install chromium` |
| Driver hangs, then `locator.waitFor: Timeout 60000ms` | It screenshots `.kiosk-run/FAILURE.png` and dumps the page text — read those first; usually a selector that belongs to the other terminal mode. |
| Kiosk shows the out-of-service screen | `curl -s 127.0.0.1:3000/api/health`; anything `unreachable` is a configured URL with nothing behind it. |
| Server won't start, no error | `cat .kiosk-run/dev.log` |
| Port 3000 busy | `driver.mjs stop`, or `KIOSK_BASE=http://127.0.0.1:4000` with `PORT=4000`. |
| `npm test` fails at `ai-gate` | Expected without the Edge AI Studio. See [Test](#test). |
