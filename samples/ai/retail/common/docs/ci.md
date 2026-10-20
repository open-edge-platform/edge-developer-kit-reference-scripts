# 🧪 Continuous Integration

[`.github/workflows/kiosk-ci.yml`](../../.github/workflows/kiosk-ci.yml) sets the
kit up the way a user does (`setup.sh` with the Edge AI Studio, then a test run
of `start.sh`) and runs each kiosk's Playwright suites against it. It runs on
manual trigger only.

- [Running it](#running-it)
- [Before the first run](#before-the-first-run)
- [Jobs](#jobs)
- [The suites](#the-suites)
- [Results](#results)
- [Script reference](#script-reference)

---

## Running it

From the repository's **Actions** tab (**Kiosk CI → Run workflow**), or:

```bash
gh workflow run kiosk-ci.yml                                  # both kiosks
gh workflow run kiosk-ci.yml -f kiosk=healthcare -f studio_ref=my-branch
gh workflow run kiosk-ci.yml -f fresh_studio=true             # cold studio setup
```

| Input | Default | Effect |
|---|---|---|
| `kiosk` | `all` | `all`, `public-service-kiosk` or `healthcare` |
| `studio_ref` | `main` | Edge AI Studio branch, tag or SHA to set up |
| `fresh_studio` | `false` | Wipe the studio checkout's untracked files (worker venvs, models, builds) first, so its setup runs from scratch |

Only one run executes at a time, because both jobs share the runner's workspace
and ports 3000/8080. A run started meanwhile waits. If several are started, the
newest replaces the one waiting before it.

---

## Before the first run

| What | Why |
|---|---|
| **Runner labels.** Both `runs-on` lines hold the placeholder label `kiosk-ci-runner` — replace it with your runner's labels | Jobs stay queued until a runner with these labels picks them up |
| **A self-hosted Ubuntu 24.04 runner with an Intel GPU** | The CI studio preset runs the LLM on the GPU |
| **Passwordless `sudo` for the runner user** | The studio's `install_dependencies.sh`, `poppler-utils`, Playwright's browser dependencies |
| **Disk** | The studio's setup installs every worker (~56 GB of virtualenvs), plus the models CI loads (~10 GB) and the uv/npm download caches in the runner user's home |
| **Secret `EDGE_AI_STUDIO_TOKEN`** | A token with read access to `intel-innersource/applications.ai.tools.edge-ai-studio`. The workflow's own `GITHUB_TOKEN` cannot check out a repository in another organization |

The studio is checked out with `clean: false`, so its installed workers and
downloaded models stay in the runner's workspace between runs. The second run
on a runner skips those downloads.

---

## Jobs

```
Setup ──► Playwright (public-service-kiosk)
      └─► Playwright (healthcare)
```

**Setup.** This job checks out the kit into `kit/` and the studio into
`edge-ai-demo-studio/`, side by side. That matches the kit's default
`EDGE_AI_STUDIO_DIR`. Then:

1. `<kiosk>/scripts/setup.sh --yes` for each selected kiosk. The first one also sets up the
   studio (system dependencies, workers, gateway build); the rest run with
   `--skip-studio`.
2. **Test run.** For each kiosk, `<kiosk>/scripts/start.sh` builds and serves it. The run then checks
   that `GET /` answers 200 and that `/api/health` reports `llm` and `ocr` as `ok`.

The studio starts with
[`studio-deployment.ci.json`](../../.github/workflows/scripts/studio-deployment.ci.json)
as its `deployment.json` (via `STUDIO_DEPLOYMENT_FILE`). That preset runs only the
LLM (Gemma 4 E4B Q4_K_M on llama.cpp, GPU) and OCR (CPU), the two services the suites exercise.
Face, speech-to-text and text-to-speech stay offline: a runner has no camera or
microphone, and the shipped speech-to-text preset needs an NPU.

**Playwright.** One job per kiosk runs after Setup. Its checkouts keep the Setup
job's install (`clean: false`). A stamp file records which run, commit and kiosks
the last setup on this runner was for. If the job lands on a runner that did not
run this run's setup, it cleans the kit checkout and sets up there. The job then
installs Chromium, generates the mock documents
(`gen-mock-docs.mjs --citizens 1,2,4`) and runs the two suites below.

---

## The suites

| Suite | Server | Command | Specs |
|---|---|---|---|
| UI | `start.sh --mock`, once per terminal mode (touch, then chat) | `npm run test:ui` | public-service: `tests/verify/settings.spec.ts`; healthcare: everything in `tests/verify/` |
| Live | `start.sh` with the studio up | `npm test` | `ai-gate` → `api` (and `e2e` for public-service) |

The UI suite needs no AI service. Specs written for one terminal mode skip
themselves on the other, which is why the suite runs once per mode. Its server
gets `NEXT_PUBLIC_KIOSK_MODE=<mode>` and `KIOSK_READER_CITIZEN=1`, overlaid by
the kiosk's `kiosk.json` `"ci": { "uiEnv": { … } }` — healthcare sets
`KIOSK_READER_CITIZEN=6` (a patient with an appointment every day) and
`KIOSK_BARCODE_DRIVER=mock` (the simulated scanner `scan-check-in.spec.ts` needs).

The live suite's server runs the touch kiosk with these settings:

- documents come in as uploads;
- the card reader is simulated and pinned to citizen 1;
- face matching and voice are off.

Chrome's fake camera shows a test pattern with no face in it. A face check that
cannot run falls back to the simulated scan, but a frame without a face always
fails, so face matching has to be off. The server counts as ready once
`/api/health` reports `verification: ok`, which means the LLM has finished
loading. The `ai-gate` project then fails the whole suite if the AI is not
really live (see the kiosk's `frontend/tests/README.md`).

The public-service specs marked TEMPORARY (`tests/verify/chat-ui`, `touch-*`) are
not run. They need `playwright.verify.config.ts` with a portrait video as the fake
camera.

To run a suite against a server you started yourself, set `KIOSK_BASE`. It also
stops Playwright from starting `npm run dev` on its own:

```bash
KIOSK_BASE=http://localhost:3005 npm test
KIOSK_BASE=http://localhost:3005 npm run test:ui
```

---

## Results

- **Job summary.** Each suite's pass/fail line and test counts, from its JUnit report.
  The Setup job adds each kiosk's test-run health.
- **Annotations.** Failed tests appear on the run page (Playwright's `github`
  reporter, active when `CI` is set).
- **Artifacts:**

| Artifact | Contents |
|---|---|
| `setup-logs` | `logs/`: each kiosk's test-run server output and health, the studio's logs and `.studio.log`, the `deployment.json` it ran with |
| `playwright-<kiosk>` | `<suite>/report/` (HTML report: `npx playwright show-report <dir>`), `<suite>/junit.xml`, `<suite>/test-results/` (traces and screenshots of failures), and `logs/` as above, per suite |

`<suite>` is `ui-touch`, `ui-chat` or `live`.

---

## Script reference

The jobs call
[`.github/workflows/scripts/kiosk_ci.sh`](../../.github/workflows/scripts/kiosk_ci.sh):

| Command | Does |
|---|---|
| `begin <job>` | Stop a kiosk or studio left running in this workspace, reset `ci-out/<job>/` |
| `setup <kiosk>...` | `setup.sh --yes`: the studio with the first kiosk, `--skip-studio` for the rest |
| `ensure-setup <kiosk>` | Reuse this run's setup if this runner did it, else clean the kit checkout and set up |
| `smoke <kiosk>...` | The test run described under [Jobs](#jobs) |
| `fixtures <kiosk>` | Chromium for Playwright, the mock documents |
| `test <kiosk> ui\|live` | Start the suite's server, run the suite, stop the server |
| `end <job>` | Stop the kiosk and the studio, copy the logs into `ci-out/<job>/logs/` |

The kiosk server and the studio each run in their own process session, so the
kiosk can be stopped between suites while the studio stays up.

| Variable | Default | Effect |
|---|---|---|
| `KIOSK_CI_PORT` | `3000` | Port the kiosk serves on |
| `KIOSK_CI_UI_MODES` | `touch chat` | Terminal modes the UI suite runs in |
| `KIOSK_CI_READY_SECS` | `2400` | How long a server may take to become ready (first launches download models) |
| `KIOSK_CI_OUT` | `ci-out/` beside the checkouts | Where reports and logs go |
| `STUDIO_DEPLOYMENT_FILE` | the CI preset | Studio service presets to run with |
