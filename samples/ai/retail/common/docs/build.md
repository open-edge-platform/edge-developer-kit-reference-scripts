# 📦 Building for Production

One build method (for now): `./setup.sh --build` packages the embedded bundle — an
Edge AI Studio export carrying its full service catalog, with every kiosk
`./setup.sh` set up injected as a sample of it — as **one** desktop app. The
kiosks are tiles of the studio's samples gallery, each run by the studio as its
own worker on its own port. Everything lands in `build/` at the repo root. No
studio at hand? `./setup.sh --build --mock` packages each kiosk on its own, with
its AI mocked — see [Without the studio](#without-the-studio---mock).

- [The build](#the-build)
- [What ships and what happens on first launch](#what-ships-and-what-happens-on-first-launch)
- [Without the studio (`--mock`)](#without-the-studio---mock)
- [Flags](#flags)
- [Deploying a kiosk terminal](#deploying-a-kiosk-terminal)
- [Building on Windows](#building-on-windows)
- [Removed targets](#removed-targets)

---

## The build

Prerequisites are handled by the build itself: Node ≥ 20 is the only
toolchain, and the build installs the shell's npm dependencies (Electron,
electron-builder) on the way. What the build cannot install for you is the
Edge AI Studio checkout at
`EDGE_AI_STUDIO_DIR` (env or `.kioskrc`), on a branch that carries the services
the kiosks' terminal modes need. The checkout is only the export source: the
build never runs the studio's own setup, so a build machine does not need one.

```bash
./setup.sh --build                           # interactive: asks each kiosk's mode / LLM / opens on / fullscreen / package format
./setup.sh --build --yes -- --mode touch --targets=appimage,deb   # non-interactive, every kiosk touch
./setup.sh --build --yes -- --mode public-service=chat --mode healthcare=touch --opens-on healthcare
./setup.sh --build --yes -- --mode touch --llm remote --windowed  # touch, Gemini, normal window
./setup.sh --build --kiosk healthcare        # a platform carrying one kiosk only (and saved as the choice)
common/scripts/build.sh --kiosk healthcare   # the build alone, no setup; --kiosk for this run only
```

`./setup.sh --build` installs each kiosk's npm dependencies, then runs
[common/scripts/build.sh](../scripts/build.sh), which takes the same `--kiosk`,
`--mock` and `--` arguments when run on its own.

With several kiosks chosen, the build asks each kiosk's terminal mode in turn,
then the platform's questions once — all of them before any long work — then
stages the kiosks one after another (they share `common/electron/`'s staging
directory), exports one studio carrying all of them and packages it as one
app.

From a fresh clone, `./setup.sh --build` does the kiosk setup and the build in
one go — it installs the frontend dependencies and skips the studio setup
(which only matters for running the kiosk from the checkout), then runs
the build for each chosen kiosk; everything after `--` is handed to the build, and `--yes`
is forwarded. The build's questions are asked first, before the frontend
dependencies install, so the run is unattended from the first install on:

```bash
./setup.sh --build                                   # setup, then the interactive build
./setup.sh --build --yes -- --mode chat --targets=deb   # non-interactive
./setup.sh --build --studio                          # …and set up the studio too, to also run natively
```

The **kiosk mode** is the first question — one per kiosk — and decides more
than the terminal's interaction style: it picks which services the platform
auto-starts (every service is exported either way; one studio serves every
kiosk, so it starts what any of their modes needs) —

| Mode | Services auto-started |
|---|---|
| `touch` | OCR (NPU), face (CPU) — no speech |
| `chat` | STT (NPU), OCR, face, TTS (CPU) |

The next question, **where the LLM runs** (once, for every kiosk), defaults
from the modes — touch builds use Gemini in the cloud, a build with a chat
kiosk uses Gemma 4 E4B on the terminal:

| `--llm` | Default for | What the build does |
|---|---|---|
| `remote` | `touch` | starts no text-generation on the terminal and points the kiosk at Gemini: `llm.base_url` `https://generativelanguage.googleapis.com/v1beta/openai`, `llm.model` `gemini-3.5-flash-lite`, `llm.api_key` blank, `llm.extra_body` dropped (Gemini rejects `chat_template_kwargs` with HTTP 400). Set the key at `/settings` on the terminal — a key in `config.yaml` ships inside the package. Until it is set, `/api/health` reports the LLM `off` and the terminal stays out of service |
| `local` | `chat` | auto-starts text-generation on the GPU with the mode's preset from `<kiosk>/deployment.json` — `unsloth/gemma-4-E4B-it-GGUF` (Q4_K_M, llama.cpp) — and keeps `config.yaml`'s `llm` block, which asks for `llamacpp:unsloth/gemma-4-E4B-it-GGUF:Q4_K_M` with thinking on. The build warns when `llm.model` is not the model the platform runs |

Then **what the window opens on**: the studio's samples gallery — the default,
where every kiosk is a tile — or one kiosk straight away
(`--opens-on <studio|kiosk>`). Either way the rest is one staff-menu entry
away.

A remote endpoint `config.yaml` already names (anything but the terminal's own
platform) is kept as it is — clear `llm.extra_body` yourself when that endpoint
rejects `chat_template_kwargs`.

`gemini-3.5-flash-lite` does no thinking — 0 reasoning tokens on the kiosk's
document check, with nothing in `extra_body` — and answers in one to several
seconds depending on Gemini's load. It rejects `reasoning_effort: none` (HTTP
400); `minimal` is accepted and changes nothing. `gemini-3.8-flash` thinks
(~350 reasoning tokens a check) and is slower. A free-tier key caps each model
per day (`gemini-3.8-flash`: 20 requests), which a terminal exhausts quickly —
use a billed key. A cloud model that is briefly overloaded (HTTP 503) or out of
quota (429) leaves that document unverified — the citizen is asked to capture
it again.

Gemma 4 E4B needs thinking on (`chat_template_kwargs.enable_thinking: true`, also
llama.cpp's default): with it off the chat assistant answers in prose instead of
calling its tools, and can describe a booking it never made. Thinking costs about
1–2 s per model step.

Output: `.AppImage` and/or `.deb`, copied to `build/` at the repo root (built under
`common/electron/out/`). The package carries the platform's identity,
[common/platform.json](../platform.json) — `Vertical Reference Solutions
Blueprint-<version>.AppImage`, app id `com.verticalreferencesolutionsblueprint.desktop`,
data directory `VRSB` — whichever kiosks it carries; the exported bundle it was
packaged from is in `build/kiosk-studio/`. It carries the shell's Chromium runtime — about two-thirds
of the package plus a server per kiosk — so expect the AppImage around 115 MB (zstd-compressed; Chromium's
own UI locales are trimmed to `en-US`, the kiosk's languages come from its
country pack); nothing beyond glibc is needed from the system.

The pipeline: `common/scripts/build.sh` hands the chosen kiosks (in
`KIOSK_DIR_LIST`) over to [electron/build.sh](../electron/build.sh)
`--bundle-app`, so the toolchain check, the install questions and the packaging
all happen in one process. That run calls [scripts/bundle.mjs](../scripts/bundle.mjs) —
which stages each kiosk's standalone server and exports the minimal studio with
every kiosk injected as a sample/worker (see [embedded-studio.md](embedded-studio.md)) —
then ships that export as a single tar inside the package. `./setup.sh --build` asks the same
questions itself, before its own installs: it runs
`common/electron/scripts/build.mjs --bundle-app --ask-only`, which prompts on stderr
and prints the complete build argument list on stdout (`--yes`, the answers as
flags, then the pass-through), and hands that to the build so nothing is asked
twice. `setup_win.bat --build` does the same.

## What ships and what happens on first launch

The package carries the bundle **pre-setup**: worker environments, the Node and
ffmpeg runtimes, and model downloads are machine-specific, so none of them are
shipped. On the terminal:

1. **First launch** unpacks the platform into the app's data directory
   (`~/.local/share/VRSB/`, `%APPDATA%\VRSB` on Windows — `platform.json`
   `dataDir`) and runs the studio's own `setup.sh` there — runtimes, worker
   environments, frontend build. Long, and it needs network. The splash screen
   reports progress.
2. **Every launch** starts the studio as the main process, which runs each
   kiosk as its own worker process on its own URL (`kiosk.json` `studio.port`:
   `:8035` for public-service, `:8036` for healthcare). The window opens on the
   studio's samples gallery (`:8080`), where every kiosk is a tile, or on the
   kiosk the build chose.

**Getting back from a sample.** The window has no chrome, so the shell adds
the way back itself: the **F2** key (or `Ctrl+Shift+Backspace`) on any page
that is not the platform, and the *Platform* entry of the staff menu below —
nothing is drawn on the kiosk's screen. The shell also keeps links that ask
for a new tab — the gallery's "Open the kiosk" — inside the one window, since
it has nowhere else to put them.

**Upgrading.** Every launch compares the build id in the package with the
stamp on the unpacked platform (`<data dir>/kiosk-studio/.bundle-id`). A newer
package replaces the unpacked tree — the platform's source and the kiosk
servers are the build's — and carries across what the terminal owns: each kiosk
worker's data (`config.yaml`, database, documents, portraits) and the
downloaded runtimes in `thirdparty/`. The studio's setup then runs again for
the worker environments, so an upgrade's first launch is long, like the first
install. A tree unpacked by a build from before stamps existed counts as
stale.

**The staff menu.** There is no address bar either, so the shell adds a hidden
menu for the pages a citizen is never shown: the kiosk, the **registration
desk** (`/enroll`), the **settings page** (`/settings`), the **admin** (`/admin`)
and, in the packaged bundle, the platform. Open it with **F9**, or by tapping
the **top-right corner five times within three seconds** (a touch terminal has
no F9); `Esc` or *Close* dismisses it. On a kiosk's pages it lists that kiosk's
pages; on the platform's, every kiosk the platform runs. The pages themselves
stay behind the CMS admin login — the menu is only the way to reach them. The
same menu exists in every mode of the shell, including the standalone kiosk and
`./start.sh --bundle --desktop`; `KIOSK_SHELL_PLATFORM_URL` is what puts the
platform on the menu behind a kiosk, `KIOSK_SHELL_KIOSKS` the kiosks on the
platform's (the launchers set both).

A settings save at `/settings` restarts the kiosk (exit code 77 — see
[configuration.md](configuration.md#the-settings-page)): the shell starts its
own server again on the same port, and the studio worker's `start.sh` loops the
same way, so the studio keeps watching one PID.

The studio's `install_dependencies.sh` (system packages, sudo) is not run by
the app — run it once on machines that don't have them.

For the from-checkout equivalent without packaging: `./setup.sh --bundle`
exports the bundle to `build/kiosk-studio/` (`common/scripts/bundle.sh` /
`common/scripts/bundle.mjs` does the export alone) and sets it up; launch it with
`./start.sh --bundle [--desktop]` (`start_win.bat --bundle` on Windows).

## Without the studio (`--mock`)

To try the desktop app with no Edge AI Studio anywhere — no checkout, no
models — package each kiosk on its own with its AI mocked:

```bash
./setup.sh --build --mock        # from a fresh clone: asks which kiosks, installs, builds
common/scripts/build.sh --mock   # or just the build (--kiosk healthcare for one kiosk)
./start.sh --desktop --mock      # open every kiosk's app, side by side; Ctrl+C closes them
```

Each kiosk becomes `build/<product>-<version>-mock.AppImage`: the kiosk's own
server inside the Electron shell, no studio export. The `config.yaml` it ships
is the kiosk's own with the same changes `./start.sh --mock` makes: the LLM
mocked, OCR, face and speech off, document verification and the face match not
required, and the card reader and scanner simulated unless one is attached. The
mode question defaults to the kiosk's `configs/simulated.yaml` — chat for
public-service, touch for healthcare, whose chat is a tool-calling agent that
needs a real model. The `-mock` name keeps it from overwriting, or passing for,
the real package. Double-clicking the AppImage works as well as
`./start.sh --desktop --mock`; on Windows that command opens the app built
last, one kiosk at a time.

## Flags

Everything after `--` is split by flag:

| Flag | Goes to | Meaning |
|---|---|---|
| `--yes` | shell | accept defaults, no questions |
| `--mode [<kiosk>=]touch\|chat` | both | asked first, per kiosk (a plain mode sets every kiosk's); decides which services auto-start and each shipped `config.yaml`'s `terminal.mode` |
| `--llm remote\|local` | both | where the LLM runs (see above); default `remote` for touch, `local` when a kiosk runs chat |
| `--opens-on studio\|<kiosk>` | shell | what the window opens on; default `studio` (the samples gallery) |
| `--fullscreen` / `--windowed` | shell | kiosk window style |
| `--targets=appimage,deb` | shell | package formats |
| `--port <n>` | bundle | a one-kiosk build's kiosk port (default, and always with several kiosks: `kiosk.json` `studio.port`) |
| `--allow-missing` | bundle | build even if the studio checkout lacks services |
| anything else | bundle | see `common/scripts/bundle.sh --help` (`node common\scripts\bundle.mjs --help` on Windows) |

`--mode` only picks what each shipped `config.yaml` starts with. No kiosk
setting is frozen into the build: every key stays editable in the terminal's
`config.yaml` and takes effect on the next restart — see
[configuration.md](configuration.md#when-a-change-takes-effect).

## Deploying a kiosk terminal

1. Install the `.deb` (or copy the `.AppImage`) from `build/`.
2. Make sure the machine has the studio's system packages (its
   `install_dependencies.sh`, once, with sudo) and network for the first
   launch.
3. Launch. First launch installs and starts everything; the window opens on
   the studio's samples gallery (or the kiosk the build chose), with the rest
   on the staff menu (F9, or five taps in the top-right corner).

The app's data directory holds the unpacked platform (`kiosk-studio/`), with
each kiosk's database and `config.yaml` in
`<data dir>/kiosk-studio/workers/<studio.sampleId>/data/` — every setting is
editable there, and a restart is all any of them needs.

## Building on Windows

`setup_win.bat --build` hands over to [scripts/win/build.ps1](../scripts/win/build.ps1),
which builds the same embedded-bundle app as Linux — one app, every kiosk a sample — the bundler is a shared Node
script, [scripts/bundle.mjs](../scripts/bundle.mjs), and the studio's exporter
and exported launchers both come in Windows form (`export-bundle.mjs`,
`setup_win.bat`/`start_win.bat`, per-worker `start.ps1`). Each injected kiosk
worker ships both entry points (`start.sh` + `start.ps1`), so a bundle exported
on either platform runs on either.

```bat
setup_win.bat --build
setup_win.bat --build --yes -- --targets=nsis
setup_win.bat --build --kiosk healthcare
common\scripts\build.bat --kiosk healthcare     # the build alone, no setup
```

Prerequisites: Node ≥ 20, git. Output: `.exe` (NSIS) and/or `.msi`, copied to
`build\` at the repo root. The studio checkout is the export source and does not need to be set
up, so `setup_win.bat --build` leaves its setup alone. On the terminal, first
launch runs the studio's `setup_win.bat -AutoYes` instead of `setup.sh`; there
is no `install_dependencies.sh` step on Windows.

## Uninstalling

`./uninstall.sh` (Linux) and `uninstall_win.bat` (Windows) remove the installed
platform app ([common/platform.json](../platform.json)) and each chosen kiosk's
own app — its mocked build, or an app from before the kiosks shared one studio
(`--kiosk <name>` narrows the kiosks; each app is listed and confirmed on its
own). Both take the same flags and both keep the
data by default — it holds the terminal's own database, captured documents
and enrolled portraits.

```bash
./uninstall.sh --dry-run     # list what would go, remove nothing
./uninstall.sh --kiosk healthcare            # the platform app and healthcare's own
./uninstall.sh               # remove the package, keep the data
./uninstall.sh --data        # remove the package and everything it wrote
./uninstall.sh --caches --data --yes
```

| | Linux | Windows |
|---|---|---|
| Package | `.deb` via `dpkg -r`; an `.AppImage` is just deleted | the installer's own uninstaller (NSIS `.exe` or MSI), from the uninstall registry |
| App data | `~/.local/share/<dataDir>/` (`VRSB` for the platform; a kiosk's own, e.g. `VRSB-healthcare`) | `%APPDATA%\<dataDir>\` |
| Shared caches (`--caches`) | `~/.cache/uv`, `~/.cache/huggingface`, `~/.npm` | `%LOCALAPPDATA%\uv\cache`, `%USERPROFILE%\.cache\huggingface`, `%APPDATA%\npm-cache` |

On a bundle install the data directory is the large one — the unpacked
platform, worker environments and models run to tens of GB, and `dpkg -r` alone
never touches it. `--caches` is off by default because those caches are shared
with every other project on the machine.

Two things worth knowing before reaching for `--data`:

- Deleting only `<data dir>/kiosk-studio/` is a factory reset — the next launch
  unpacks and sets up again (the full download).
- Deleting only `<data dir>/kiosk-studio/frontend/.next/BUILD_ID` re-runs setup
  without discarding models or worker environments; it is the sentinel
  [main.js](../electron/main.js) checks.

## Removed targets

The former `web`, `desktop`, `studio`, `bundle` and `all` targets were removed
— the packaged embedded bundle is the only build method for now. Their
underlying machinery still exists for manual use:

- web app: `cd <kiosk>/frontend && npm run build` (serve with `./start.sh`)
- standalone kiosk desktop app: `./setup.sh --build --mock` (mocked), or `cd common/electron && ./build.sh` against a live gateway
- studio executable: `cd $EDGE_AI_STUDIO_DIR && ./scripts/bash/package.sh`
- bundle only (no packaging): `common/scripts/bundle.sh` (`node common\scripts\bundle.mjs` on Windows)
