# 📦 Building for Production

One build method (for now): `./build.sh` packages the embedded bundle — a
minimal Edge AI Studio export with the kiosk injected as a sample — as a
desktop app.

- [The build](#the-build)
- [What ships and what happens on first launch](#what-ships-and-what-happens-on-first-launch)
- [Flags](#flags)
- [Deploying a kiosk terminal](#deploying-a-kiosk-terminal)
- [Building on Windows](#building-on-windows)
- [Removed targets](#removed-targets)

---

## The build

Prerequisites (Debian/Ubuntu): `./setup.sh --desktop` — installs WebKitGTK dev
packages and the Rust toolchain (Tauri v2, Rust ≥ 1.77.2) — plus the Edge AI
Studio checkout at `EDGE_AI_STUDIO_DIR` (env or `.kioskrc`), on a branch that
carries the services the kiosk's terminal mode needs.

```bash
./build.sh                                   # interactive: asks kiosk mode / fullscreen / package format
./build.sh -- --yes --mode touch --targets=appimage,deb   # non-interactive
```

The **kiosk mode** is the first question and decides more than the terminal's
interaction style: it picks the AI services the bundle carries and the
deployment profile the platform starts them with —

| Mode | Services exported and auto-started |
|---|---|
| `touch` | LLM (GPU), OCR (NPU), face (CPU) — no speech |
| `chat` / `agent` | all five: LLM (GPU), OCR, face, STT, TTS (CPU) |

Output: `.AppImage` and/or `.deb`, copied to `build/` (built under
`tauri/src-tauri/target/release/bundle/`). Expect ~100 MB for the AppImage and
~35 MB for the deb — the AppImage additionally carries the WebKitGTK runtime,
which the deb declares as system dependencies instead.

The pipeline: `./build.sh` hands straight over to
[tauri/build.sh](../tauri/build.sh) `--bundle-app`, so the toolchain check, the
install questions and the packaging all happen in one process. That run calls
[scripts/bundle.sh](../scripts/bundle.sh) — which stages the kiosk's standalone
server and exports the minimal studio with the kiosk injected as a sample/worker
(see [embedded-studio.md](embedded-studio.md)) — then ships that export as a
single tar inside the Tauri package.

## What ships and what happens on first launch

The package carries the bundle **pre-setup**: worker environments, the Node and
ffmpeg runtimes, and model downloads are machine-specific, so none of them are
shipped. On the terminal:

1. **First launch** unpacks the platform into the app's data directory
   (`~/.local/share/com.verticalreferenceblueprint.desktop/`) and runs the studio's own
   `setup.sh` there — runtimes, worker environments, frontend build. Long, and
   it needs network. The splash screen reports progress.
2. **Every launch** starts the studio as the main process and opens the window
   on it (`:8080`). The studio runs the entire blueprint as its own worker
   process, reachable from the samples gallery on its own URL (`:8035` by
   default).

**Getting back from a sample.** The window has no chrome, so the shell adds
the way back itself: a faint **← Platform** pill in the bottom-left corner of
any page that is not the platform, and the **F2** key (or `Ctrl+Shift+Backspace`)
anywhere. The shell also keeps links that ask for a new tab — the gallery's
"Open the kiosk" — inside the one window, since it has nowhere else to put
them.

The studio's `install_dependencies.sh` (system packages, sudo) is not run by
the app — run it once on machines that don't have them.

For the from-checkout equivalent without packaging: `./build.sh` (or
`scripts/bundle.sh` directly) stages the bundle at `build/kiosk-studio/`; set
it up with `./setup.sh --bundle` and launch it with `./start.sh --bundle
[--tauri]`.

## Flags

Everything after `--` is split by flag:

| Flag | Goes to | Meaning |
|---|---|---|
| `--yes` | shell | accept defaults, no questions |
| `--mode touch\|chat\|agent` | both | asked first; decides services, profile and the kiosk baked in |
| `--fullscreen` / `--windowed` | shell | kiosk window style |
| `--targets=appimage,deb` | shell | package formats |
| `--port <n>` | bundle | embedded kiosk port (default 8035) |
| `--allow-missing` | bundle | build even if the studio checkout lacks services |
| anything else | bundle | see `scripts/bundle.sh --help` |

Two kiosk settings are baked in at build time because they are `NEXT_PUBLIC_*`
values inlined by `next build`: the terminal mode and the document source.
Everything else stays editable in the shipped `config.yaml` — see
[configuration.md](configuration.md).

> **Terminal gotcha:** WebKitGTK shows a native camera-permission prompt on first
> `getUserMedia` — on an unattended kiosk nobody can click it. Check this first if
> face verification can't open the camera in the packaged app.

## Deploying a kiosk terminal

1. Install the `.deb` (or copy the `.AppImage`) from `build/`.
2. Make sure the machine has the studio's system packages (its
   `install_dependencies.sh`, once, with sudo) and network for the first
   launch.
3. Launch. First launch installs and starts everything; the window opens on
   the studio, and the kiosk sample runs the kit.

The app's data directory holds the unpacked platform, the kiosk database and
`config.yaml`; runtime settings can be changed there without rebuilding.

## Building on Windows

`build_win.bat` runs [scripts/win/build.ps1](../scripts/win/build.ps1), which builds
the **standalone desktop app** — the kiosk's Next.js server, a Node runtime and
its assets wrapped in the Tauri shell — and packages it as an installer:

```bat
build_win.bat
build_win.bat -- --yes --targets=nsis
```

Prerequisites: `setup_win.bat --desktop` reports whether Rust and the MSVC C++ build
tools are present, and prints the `winget` commands for what is missing.
Output: `.exe` (NSIS) and/or `.msi` under
`tauri\src-tauri\target\release\bundle\`.

The embedded bundle is **not** built on Windows: `--bundle-app` shells out to
[scripts/bundle.sh](../scripts/bundle.sh), which drives the studio's exporter
through bash, `git add -N`, `sed` and `python3`.
Build it on Linux or under WSL and copy `build/kiosk-studio` over; `build_win.bat`,
`setup_win.bat --bundle` and `start_win.bat --bundle` stop with that message rather than
half-building it.

## Uninstalling

`./uninstall.sh` (Linux) and `uninstall_win.bat` (Windows) remove the installed
app. Both take the same flags and both keep the data by default — it holds the
terminal's own database, captured documents and enrolled portraits.

```bash
./uninstall.sh --dry-run     # list what would go, remove nothing
./uninstall.sh               # remove the package, keep the data
./uninstall.sh --data        # remove the package and everything it wrote
./uninstall.sh --caches --data --yes
```

| | Linux | Windows |
|---|---|---|
| Package | `.deb` via `dpkg -r`; an `.AppImage` is just deleted | the installer's own uninstaller (NSIS `.exe` or MSI), from the uninstall registry |
| App data | `~/.local/share/com.verticalreferenceblueprint.desktop/` | `%APPDATA%\com.verticalreferenceblueprint.desktop\` + `%LOCALAPPDATA%\...` (webview cache) |
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
  [main.rs](../tauri/src-tauri/src/main.rs) checks.

## Removed targets

The former `web`, `desktop`, `studio`, `bundle` and `all` targets were removed
— the packaged embedded bundle is the only build method for now. Their
underlying machinery still exists for manual use:

- web app: `cd frontend && npm run build` (serve with `./start.sh`)
- standalone kiosk desktop app: `cd tauri && ./build.sh`
- studio executable: `cd $EDGE_AI_STUDIO_DIR && ./scripts/bash/package.sh`
- bundle only (no packaging): `scripts/bundle.sh`
