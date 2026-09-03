# 🧩 Embedded Studio Bundle

One self-contained folder that runs everything: an **Edge AI Studio**
(headless — no Electron) exported with its **full AI service catalog**, and the
**kiosk injected as the gallery's only sample** — a sample the studio starts as a
hidden child process, exactly the way the studio's AI suites work.

- [How it fits together](#how-it-fits-together)
- [Building the bundle](#building-the-bundle)
- [Running it](#running-it)
- [Desktop shell on the bundle](#desktop-shell-on-the-bundle)
- [Two bundle types](#two-bundle-types)
- [Bundle layout](#bundle-layout)
- [How the injection works](#how-the-injection-works)
- [Limitations](#limitations)

---

## How it fits together

```
build/kiosk-studio/studio          (exported minimal studio)
 └─ studio gateway :8080 ──spawns──▶ workers (LLM, OCR, …)
                        └─spawns──▶ workers/public-service-kiosk  = the kiosk server :8035
                                     (hidden background process)
samples gallery ─ "Public Service Kiosk" tile ─ Open the kiosk ▶ http://localhost:8035
```

Every service the studio's exporter can carry comes along, so the platform's
service pages are all there; the samples gallery, by contrast, is emptied of the
studio's own demos and holds a single tile — the kiosk, illustrated with the
first frame of [docs/media/touch-kiosk-flow.gif](media/touch-kiosk-flow.gif),
shipped as `scripts/bundle/sample-image.png` and refreshed with:

```bash
ffmpeg -i docs/media/touch-kiosk-flow.gif -vframes 1 -y scripts/bundle/sample-image.png
```

> The `oep-*` services are the exception, and deliberately so — they are the
> studio's test services. Their workers also live outside `workers/`
> (`workerSubDir: '../workers-oep/…'`), which the studio's exporter cannot
> resolve: it would copy the studio's entire repo, samples included. The
> bundler names them on the way past and exports the rest.

The exported studio is **rebranded** in the process: every occurrence of its
display name in the UI is overwritten with **"Vertical Reference Solutions Blueprint"**
(configurable: `--brand "<name>"` or `STUDIO_BRAND_NAME`), and the kiosk appears
inside it as **"Public Service Kiosk"**.

The studio is the process manager: its `deployment.json` marks the kiosk service
(and the AI services) `"online"`, so booting the studio boots the whole stack. The
kiosk consumes the studio's AI services through the local gateway on `:8080`, and
the studio health-checks the kiosk via its `/api/health` endpoint, restarts it on
demand from the sample page, and captures its logs under `studio/logs/public-service-kiosk.log`.

## Building the bundle

```bash
scripts/bundle.sh                  # stage kiosk + export studio + inject (fast)
./setup.sh --bundle                # …or everything incl. the long install step
scripts/build.sh                   # bundle + packaged as a desktop app (the default build)
```

On Windows: `node scripts\bundle.mjs`, `setup_win.bat --bundle` and
`scripts\build.bat` are the same three, and `start_win.bat --bundle` runs the
result. The bundler itself is [scripts/bundle.mjs](../scripts/bundle.mjs), one
Node script shared by both platforms (`scripts/bundle.sh` is its bash wrapper).

`scripts/bundle.mjs` options (forwarded from `scripts/build.sh -- ...`): `--mode touch|chat|agent` (default: the kiosk's
configured mode — it decides what auto-starts, not what is exported), `--port <n>` (kiosk port, default 8035), `--out <dir>`,
`--brand "<name>"` (studio display name, default "Vertical Reference Solutions Blueprint"),
`--install` (run the bundle's own setup at the end), `--skip-stage` (reuse the
last kiosk stage), `--allow-missing` (see below).

> **Studio version requirement — no silent degradation.** The bundler requires
> every service the mode needs to exist in the studio checkout and **fails hard**
> if one is missing (services live on feature branches until they merge to the
> studio's main — face-recognition, for example). The fix is to check out the
> studio branch that provides them. Passing `--allow-missing` is the only way to
> build a reduced bundle, and it is an explicit, warned choice — never automatic.

The build alone is quick; the **install** step (`--install`, or `setup.sh
--bundle`, or `cd build/kiosk-studio/studio && ./setup.sh`) is the long part — it
downloads the studio's runtimes, builds the Python worker environments, and
builds the studio frontend (which is when the injected kiosk sample gets baked
in; the studio's registries are compiled at build time, so this rebuild is
unavoidable by design).

## Running it

```bash
./start.sh --bundle
```

Starts the bundle's studio on **:8080**; the studio then auto-starts its AI
services and the kiosk worker per the bundle's `deployment.json`.

| URL | What |
|---|---|
| http://localhost:8035 | The kiosk (studio-managed hidden process) |
| http://localhost:8080 | "Vertical Reference Solutions Blueprint" dashboard — the kiosk appears under **Samples → Suite** as "Public Service Kiosk" |
| http://localhost:8035/admin | Kiosk admin (Payload CMS) |

The kiosk's writable state (database, captured documents, config) lives in
`build/kiosk-studio/studio/workers/public-service-kiosk/data/` — its `config.yaml` there is
the operator's copy, editable without rebuilding.

## Desktop shell on the bundle

```bash
./start.sh --bundle --desktop
```

Uses the kiosk's desktop shell in **external-target mode**: instead of spawning
its own bundled server, the shell runs the bundle's start script and points its
(fullscreen) window at the kiosk URL once the port answers. Driven by env vars
the launcher sets for you: `KIOSK_SHELL_URL`, `KIOSK_SHELL_CMD`,
`KIOSK_SHELL_CWD`, `KIOSK_SHELL_TIMEOUT_SECS` (default 900 s here — the studio's
first boot loads models). Closing the window stops the stack the shell started:
the studio gets a SIGTERM, which is what makes it stop its own AI workers (those
run detached, so nothing else reaches them). `KIOSK_SHELL_KEEP_ALIVE=1` leaves it
running instead, the way the launchers treat a studio they did not start.

The shell itself comes from `(cd electron && ./build.sh --shell-only)` — the
unpacked app under `electron/out/` — or any `.AppImage` built there. So: no
shell *inside* the bundle — the one desktop shell wraps the studio-managed
stack, which is the part that needs a window.

## Two bundle types

Both types carry the same services — the mode decides which of them the studio
auto-starts, per the [two deployment profiles](configuration.md#launcher-script-configuration),
and which terminal the kiosk is built as:

| `--mode` | Services auto-started | Kiosk build baked as |
|---|---|---|
| `touch` | OCR (NPU), face (CPU) — no speech, and no local LLM: the terminal calls a remote text-generation gateway | touch terminal |
| `chat` / `agent` | all five, locally: LLM (GPU), OCR, face, STT, TTS (CPU) | chat / agent terminal |

Everything else the studio has is exported but idle, startable from the studio
UI. A service the mode needs that the checkout lacks is still a hard error (see
`--allow-missing` above).

`scripts/build.sh` asks for the mode; pass it non-interactively instead with
`scripts/build.sh -- --mode touch`. Build one folder per type if you need both;
`--out` keeps them side by side:

```bash
scripts/bundle.sh --mode touch --out build/kiosk-studio-touch
scripts/bundle.sh --mode chat  --out build/kiosk-studio-chat
```

## Bundle layout

```
build/kiosk-studio/
├── README.md, bundle.env            # what was built (mode, port)
└── studio/                          # the exported minimal studio
    ├── setup.sh · start.sh · install_dependencies.sh
    ├── deployment.json              # mode profile + public-service-kiosk autostart
    ├── frontend/                    # studio UI/gateway + injected registrations
    │   └── src/{services,samples}/public-service-kiosk/   # data.ts (+ the sample's image.png)
    └── workers/
        ├── <exported AI workers…>
        └── public-service-kiosk/
            ├── start.sh             # studio-spawned entry (bash start.sh --port N)
            ├── bundle/              # kiosk server, assets, primed db, config.yaml
            └── data/                # created at runtime: db, documents, photos
```

## How the injection works

1. The kiosk is staged exactly as for the desktop app (`cd electron && npm run stage`): standalone
   Next server + `kiosk.cjs` entry + assets + pre-seeded database + shipped
   `config.yaml`.
2. The studio's own exporter (`export.sh --samples=public-service-kiosk
   --services=<every exportable service>`) produces the source tree — no
   Electron, no models, every service's worker, and no sample but the kiosk's.
3. The bundler drops in `workers/public-service-kiosk/` (start script + the staged kiosk)
   and registers `services/public-service-kiosk` + `samples/public-service-kiosk` in the exported
   frontend source, widens the generated registries' key types (the kiosk id
   isn't in the studio's baked service union), and re-runs the studio's codegen.
4. `deployment.json` gets the mode's profile plus `"public-service-kiosk": {"status": "online"}`.
5. The bundle's own `setup.sh` builds the studio frontend — from then on the
   kiosk is a first-class studio service: spawned detached with captured logs,
   health-checked to `active`, stoppable/restartable from the sample page.

## Limitations

- The Windows flow (bundle built and run via the `_win`/`.ps1` launchers, the
  injected worker's `start.ps1`) has not yet been exercised on real Windows
  hardware; the Linux flow has.
- The install step is heavy, and heavier since the bundle carries the whole
  service catalog: the studio's worker environments are multi-GB and models
  download on first service start (only for services actually started).
- Registering the sample requires the studio frontend rebuild the bundle's setup
  performs — sample pages cannot be added to an already-built studio (its
  registries and proxy rewrites are frozen at build time).
- The kiosk's *terminal mode* and *document source* are baked into the staged
  kiosk (same rule as every kiosk build); rebuild the bundle to change them.
