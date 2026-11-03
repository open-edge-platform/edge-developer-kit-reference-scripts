# 🧩 Embedded Studio Bundle

One self-contained folder that runs everything: an **Edge AI Studio**
(headless — no Electron) exported with its **full AI service catalog**, and
**every chosen kiosk injected as a sample of its gallery** — public-service and
healthcare side by side, each a sample the studio starts as a hidden child
process, exactly the way the studio's AI suites work. One bundle, one studio,
one desktop app, however many kiosks.

- [How it fits together](#how-it-fits-together)
- [Building the bundle](#building-the-bundle)
- [Running it](#running-it)
- [Desktop shell on the bundle](#desktop-shell-on-the-bundle)
- [Terminal modes](#terminal-modes)
- [Bundle layout](#bundle-layout)
- [How the injection works](#how-the-injection-works)
- [Limitations](#limitations)

---

## How it fits together

`<studio.sampleId>`, `<studio.title>` and `<studio.port>` below are each kiosk's
`kiosk.json` values — public-service: `public-service-kiosk`, "Public Service
Kiosk", 8035; healthcare: `hospital-concierge-kiosk`, "Hospital Concierge Kiosk", 8036.
The kiosks are the ones `./setup.sh` chose (`--kiosk` overrides it).

```
build/kiosk-studio/studio                  (exported minimal studio)
 └─ studio gateway :8080 ──spawns──▶ workers (LLM, OCR, …)
                        ├─spawns──▶ workers/public-service-kiosk      = kiosk server :8035
                        └─spawns──▶ workers/hospital-concierge-kiosk  = kiosk server :8036
                                     (hidden background processes)
samples gallery ─ "Public Service Kiosk" tile ─ Open the kiosk ▶ http://127.0.0.1:8035
                ─ "Hospital Concierge Kiosk" tile ─ Open the kiosk ▶ http://127.0.0.1:8036
```

The studio allocates every worker a port from its `INSTANCE_PORT_RANGE` and
health-checks it there. Each kiosk keeps its `<studio.port>` (declared in its
service's `reservedPorts`, so it is never handed out), and its server entry
relays the allocated port to it, so the studio's checks and every kiosk link
work. The kiosks in one bundle must have different `studio.sampleId`s and
`studio.port`s — the bundler refuses otherwise.

Every service the studio's exporter can carry comes along, so the platform's
service pages are all there; the samples gallery, by contrast, is emptied of the
studio's own demos and holds one tile per kiosk. A tile's description, tags and
icon (a [lucide-react](https://lucide.dev/icons) name) come from the kiosk's
`kiosk.json` `studio` block (`description`, `tags`, `icon`), its image from
`studio.image` (a path relative to the kiosk folder) — by default the first
frame of [docs/media/touch-kiosk-flow.gif](media/touch-kiosk-flow.gif),
shipped as `common/scripts/bundle/sample-image.png` and refreshed with:

```bash
ffmpeg -i common/docs/media/touch-kiosk-flow.gif -vframes 1 -y common/scripts/bundle/sample-image.png
```

> The `oep-*` services are the exception, and deliberately so — they are the
> studio's test services. Their workers also live outside `workers/`
> (`workerSubDir: '../workers-oep/…'`), which the studio's exporter cannot
> resolve: it would copy the studio's entire repo, samples included. The
> bundler names them on the way past and exports the rest.

The exported studio is **rebranded** in the process: every occurrence of its
display name in the UI is overwritten with **"Vertical Reference Solutions Blueprint"**
(configurable: `--brand "<name>"` or `STUDIO_BRAND_NAME`), and each kiosk appears
inside it as its **`<studio.title>`**.

The studio is the process manager: its `deployment.json` marks every kiosk
service (and the AI services) `"online"`, so booting the studio boots the whole
stack. The kiosks consume the studio's AI services through the local gateway on
`:8080` — one set of services shared by all of them — and the studio
health-checks each kiosk via its `/api/health` endpoint, restarts it on demand
from its sample page, and captures its logs under `studio/logs/<studio.sampleId>.log`.

## Building the bundle

```bash
common/scripts/bundle.sh                  # stage the kiosks + export studio + inject (fast)
./setup.sh --bundle                       # …or everything incl. the long install step
./setup.sh --build                        # bundle + packaged as one desktop app (the default build)
./setup.sh --bundle --kiosk healthcare    # a bundle carrying just that kiosk
```

`common/scripts/bundle.sh` on its own carries the kiosks named by
`KIOSK_DIR_LIST` (kiosk folders joined with `:` — `;` on Windows), else
`KIOSK_DIR`, else public-service; the launchers set it from the kiosks
`./setup.sh` chose.

On Windows: `node common\scripts\bundle.mjs`, `setup_win.bat --bundle` and
`setup_win.bat --build` are the same three, and `start_win.bat --bundle` runs the
result. The bundler itself is [scripts/bundle.mjs](../scripts/bundle.mjs), one
Node script shared by both platforms (`common/scripts/bundle.sh` is its bash wrapper).

`common/scripts/bundle.mjs` options (forwarded from `./setup.sh --build -- ...`):
`--mode [<kiosk>=]<touch|chat>` (a plain mode sets every kiosk's,
`--mode healthcare=touch` one kiosk's — repeat it per kiosk; default: each
kiosk's configured mode — it decides what auto-starts, not what is exported),
`--llm <remote|local>` (where the LLM runs, for every kiosk; default `local`
when a kiosk's mode runs text-generation — chat — else `remote`),
`--port <n>` (a one-kiosk bundle's kiosk port, default `kiosk.json`
`studio.port`; with several kiosks each keeps its own), `--out <dir>`
(default `build/kiosk-studio`),
`--brand "<name>"` (studio display name, default "Vertical Reference Solutions Blueprint"),
`--install` (run the bundle's own setup at the end), `--skip-stage` (reuse each
kiosk's last stage, kept in `<out>/.stage/<studio.sampleId>/`), `--allow-missing`
(see below).

> **Studio version requirement — no silent degradation.** The bundler requires
> every service the kiosks' modes need to exist in the studio checkout and **fails hard**
> if one is missing (services live on feature branches until they merge to the
> studio's main — face-recognition, for example). The fix is to check out the
> studio branch that provides them. Passing `--allow-missing` is the only way to
> build a reduced bundle, and it is an explicit, warned choice — never automatic.

The build alone is quick; the **install** step (`--install`, or `setup.sh
--bundle`, or `cd build/kiosk-studio/studio && ./setup.sh`) is the long part — it
downloads the studio's runtimes, builds the Python worker environments, and
builds the studio frontend (which is when the injected kiosk samples get baked
in; the studio's registries are compiled at build time, so this rebuild is
unavoidable by design).

## Running it

```bash
./start.sh --bundle                                 # the studio, and every kiosk the bundle carries
healthcare-service-kiosk/scripts/start.sh --bundle  # the same (a kiosk's own launcher)
```

Starts the bundle's studio on **:8080**; the studio then auto-starts its AI
services and every kiosk worker per the bundle's `deployment.json`.

| URL | What |
|---|---|
| `http://127.0.0.1:<studio.port>` | Each kiosk (studio-managed hidden process) — :8035 public-service, :8036 healthcare |
| http://127.0.0.1:8080 | "Vertical Reference Solutions Blueprint" dashboard — each kiosk appears under **Samples → Suite** as its `<studio.title>` |
| `http://127.0.0.1:<studio.port>/admin` | Kiosk admin (Payload CMS) |
| `http://127.0.0.1:<studio.port>/enroll` | Staff registration desk (CMS admin login) |
| `http://127.0.0.1:<studio.port>/settings` | Settings page — edits the worker's `data/config.yaml`, restarts the kiosk worker in place (CMS admin login) |
| `http://127.0.0.1:<studio.port>/mock-documents` | Mock documents to download for a registered citizen (CMS admin login) |

Each kiosk's writable state (database, captured documents, config) lives in
`build/kiosk-studio/studio/workers/<studio.sampleId>/data/` — its `config.yaml` there is
the operator's copy, editable without rebuilding.

## Desktop shell on the bundle

```bash
./start.sh --bundle --desktop                     # the window opens on the studio's gallery
./start.sh --bundle --desktop --kiosk healthcare  # …or straight on that kiosk
```

Uses the platform's desktop shell in **external-target mode**: instead of
spawning its own bundled server, the shell runs the bundle's start script and
points its (fullscreen) window at the studio — or the `--kiosk` one — once the
port answers. Driven by env vars the launcher sets for you: `KIOSK_SHELL_URL`,
`KIOSK_SHELL_PLATFORM_URL` (the studio, one staff-menu entry behind a kiosk),
`KIOSK_SHELL_KIOSKS` (every kiosk, `[{"title": …, "url": …}]`, the staff menu's
entries on the studio's pages), `KIOSK_SHELL_CMD`,
`KIOSK_SHELL_CWD`, `KIOSK_SHELL_TIMEOUT_SECS` (default 900 s here — the studio's
first boot loads models). Closing the window stops the stack the shell started:
the studio gets a SIGTERM, which is what makes it stop its own AI workers (those
run detached, so nothing else reaches them). `KIOSK_SHELL_KEEP_ALIVE=1` leaves it
running instead, the way the launchers treat a studio they did not start.

The shell itself is the platform's ([common/platform.json](../platform.json)):
the newest `build/<productName>-*.AppImage` at the repo root, else the unpacked
`common/electron/out/linux-unpacked/<executableName>` that
`(cd common/electron && ./build.sh --shell-only)` leaves. So: no shell *inside*
the bundle — the one desktop shell wraps the studio-managed stack, which is the
part that needs a window.

## Terminal modes

Every bundle carries the same services — each kiosk's mode decides which of
them the studio auto-starts, per the kiosk's [`deployment.json`](getting-started.md#the-edge-ai-studio-prerequisite)
block for that mode, and which terminal the kiosk is built as. One studio serves
every kiosk, so it auto-starts the union of their modes' services (where two
kiosks preset the same service differently, the kiosk running more services
wins, with a warning). As both kiosks ship it:

| `--mode` | Services auto-started | Kiosk `terminal.mode` shipped as |
|---|---|---|
| `touch` | OCR (NPU), face (CPU) — no speech | touch terminal |
| `chat` | STT (NPU), OCR, face, TTS (CPU) | chat terminal |

The LLM follows `--llm`: `local` auto-starts text-generation with the mode's preset —
Gemma 4 E4B on the GPU (the default when the mode's block runs it — chat) —
`remote` starts none and the kiosk calls Gemini, its API key set at `/settings` (the
default for touch). See
[build.md](build.md#the-build).

Everything else the studio has is exported but idle, startable from the studio
UI. A service the mode needs that the checkout lacks is still a hard error (see
`--allow-missing` above).

`./setup.sh --build` asks for each kiosk's mode; pass them non-interactively
instead with `./setup.sh --build -- --mode public-service=chat --mode healthcare=touch`
(or `--mode touch` for all). Build one folder per combination if you need
several; `--out` keeps them side by side:

```bash
common/scripts/bundle.sh --mode touch --out build/kiosk-studio-touch
common/scripts/bundle.sh --mode chat  --out build/kiosk-studio-chat
```

## Bundle layout

```
build/kiosk-studio/
├── README.md, bundle.env            # what was built (kiosks, their modes and ports, LLM, brand)
├── .stage/<studio.sampleId>/        # each kiosk's staged server (reused by --skip-stage)
└── studio/                          # the exported minimal studio
    ├── setup.sh · start.sh · install_dependencies.sh
    ├── deployment.json              # the kiosks' mode blocks + every <studio.sampleId> autostart
    ├── frontend/                    # studio UI/gateway + injected registrations
    │   └── src/{services,samples}/<studio.sampleId>/   # per kiosk: data.ts (+ the sample's image.png)
    └── workers/
        ├── <exported AI workers…>
        └── <studio.sampleId>/       # one per kiosk
            ├── start.sh · start.ps1 # studio-spawned entry (bash start.sh --port N)
            ├── bundle/              # kiosk server, assets, primed db, config.yaml
            └── data/                # created at runtime: db, documents, photos
```

`bundle.env` lists the kiosks as parallel space-separated lists
(`KIOSK_BUNDLE_KIOSKS`, `KIOSK_BUNDLE_SAMPLES`, `KIOSK_BUNDLE_PORTS`,
`KIOSK_BUNDLE_MODES`). A bundle from before the kiosks shared one studio
(`build/kiosk-studio/<kiosk id>/`) is removed by the next export.

## How the injection works

1. Each kiosk is staged exactly as for the desktop app (`cd common/electron && npm run stage`): standalone
   Next server + `kiosk.cjs` entry + assets + pre-seeded database + shipped
   `config.yaml`, built for its own mode — then moved to `.stage/<studio.sampleId>/`,
   since the kiosks take turns in the one electron stage.
2. The studio's own exporter (`scripts/export-bundle.mjs --samples=<every studio.sampleId>
   --services=<every exportable service>`) produces the source tree — no
   Electron, no models, every service's worker, and no samples but the kiosks'.
3. The bundler drops in each `workers/<studio.sampleId>/` (start scripts + the staged kiosk)
   and registers each `services/<studio.sampleId>` + `samples/<studio.sampleId>` in the exported
   frontend source, widens the generated registries' key types (the kiosk ids
   aren't in the studio's baked service union), and re-runs the studio's codegen.
4. `deployment.json` gets the kiosks' `deployment.json` blocks for their modes, merged (text-generation per `--llm`), plus `"<studio.sampleId>": {"status": "online"}` for each kiosk.
5. The bundle's own `setup.sh` builds the studio frontend — from then on each
   kiosk is a first-class studio service: spawned detached with captured logs,
   health-checked to `active`, stoppable/restartable from its sample page.

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
- A kiosk's own settings are *not* frozen into the staged build: its
  `config.yaml` lives in its worker's `data/` directory and every key there —
  terminal mode and document source included — takes effect on the next
  restart (see
  [configuration.md](configuration.md#when-a-change-takes-effect)).
