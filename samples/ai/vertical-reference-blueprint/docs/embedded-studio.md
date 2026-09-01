# 🧩 Embedded Studio Bundle

One self-contained folder that runs everything: a **minimal Edge AI Studio**
(headless — no Electron) exported with only the AI services the kiosk needs, and
the **kiosk injected as a studio sample** that the studio starts as a hidden child
process — exactly the way the studio's AI suites work.

- [How it fits together](#how-it-fits-together)
- [Building the bundle](#building-the-bundle)
- [Running it](#running-it)
- [Desktop (Tauri) shell on the bundle](#desktop-tauri-shell-on-the-bundle)
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

The exported studio is **rebranded** in the process: every occurrence of its
display name in the UI is overwritten with **"Vertical Reference Blueprint"**
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
./build.sh                         # bundle + packaged as a desktop app (the default build)
```

`scripts/bundle.sh` options (forwarded from `./build.sh -- ...`): `--mode touch|chat|agent` (default: the kiosk's
configured mode), `--port <n>` (kiosk port, default 8035), `--out <dir>`,
`--brand "<name>"` (studio display name, default "Vertical Reference Blueprint"),
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
| http://localhost:8080 | "Vertical Reference Blueprint" dashboard — the kiosk appears under **Samples → Suite** as "Public Service Kiosk" |
| http://localhost:8035/admin | Kiosk admin (Payload CMS) |

The kiosk's writable state (database, captured documents, config) lives in
`build/kiosk-studio/studio/workers/public-service-kiosk/data/` — its `config.yaml` there is
the operator's copy, editable without rebuilding.

## Desktop (Tauri) shell on the bundle

```bash
./start.sh --bundle --tauri
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

This needs a shell build that includes external-target support in
`tauri/src-tauri/src/main.rs` — rebuild once with
`(cd tauri && ./build.sh --shell-only)` if your binary predates it. So: no Tauri *inside* the bundle — the one Tauri shell wraps
the studio-managed stack, which is the part that needs a window.

## Two bundle types

The bundle inherits the [two deployment profiles](configuration.md#launcher-script-configuration):

| `--mode` | Studio services exported & auto-started | Kiosk build baked as |
|---|---|---|
| `touch` | LLM (GPU), OCR (NPU), face (CPU) — no speech | touch terminal |
| `chat` / `agent` | all five: LLM (GPU), OCR, face, STT, TTS (CPU) | chat / agent terminal |

`./build.sh` asks for the mode; pass it non-interactively instead with
`./build.sh -- --mode touch`. Build one folder per type if you need both;
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
    │   └── src/{services,samples}/public-service-kiosk/data.ts
    └── workers/
        ├── <exported AI workers…>
        └── public-service-kiosk/
            ├── start.sh             # studio-spawned entry (bash start.sh --port N)
            ├── bundle/              # kiosk server, assets, primed db, config.yaml
            └── data/                # created at runtime: db, documents, photos
```

## How the injection works

1. The kiosk is staged exactly as for the desktop app (`tauri stage`): standalone
   Next server + `kiosk.cjs` entry + assets + pre-seeded database + shipped
   `config.yaml`.
2. The studio's own exporter (`export.sh --services=…`) produces the minimal
   source tree — no Electron, no models, only the selected services' workers.
3. The bundler drops in `workers/public-service-kiosk/` (start script + the staged kiosk)
   and registers `services/public-service-kiosk` + `samples/public-service-kiosk` in the exported
   frontend source, widens the generated registries' key types (the kiosk id
   isn't in the studio's baked service union), and re-runs the studio's codegen.
4. `deployment.json` gets the mode's profile plus `"public-service-kiosk": {"status": "online"}`.
5. The bundle's own `setup.sh` builds the studio frontend — from then on the
   kiosk is a first-class studio service: spawned detached with captured logs,
   health-checked to `active`, stoppable/restartable from the sample page.

## Limitations

- **Linux-only** for now (the injected worker entry is a bash script, like the
  studio suites).
- The install step is heavy: the studio's worker environments are multi-GB and
  models download on first service start.
- Registering the sample requires the studio frontend rebuild the bundle's setup
  performs — sample pages cannot be added to an already-built studio (its
  registries and proxy rewrites are frozen at build time).
- The kiosk's *terminal mode* and *document source* are baked into the staged
  kiosk (same rule as every kiosk build); rebuild the bundle to change them.
