# 📦 Building for Production

One build method (for now): `scripts/build.sh` packages the embedded bundle — an
Edge AI Studio export carrying its full service catalog, with the kiosk
injected as its only sample — as a desktop app.

- [The build](#the-build)
- [What ships and what happens on first launch](#what-ships-and-what-happens-on-first-launch)
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
the kiosk's terminal mode needs. The checkout is only the export source: the
build never runs the studio's own setup, so a build machine does not need one.

```bash
scripts/build.sh                                   # interactive: asks kiosk mode / fullscreen / package format
scripts/build.sh -- --yes --mode touch --targets=appimage,deb   # non-interactive
```

From a fresh clone, `./setup.sh --build` does the kiosk setup and the build in
one go — it installs the frontend dependencies and skips the studio setup
(which only matters for running the kiosk from the checkout), then runs
`scripts/build.sh`; everything after `--` is handed to the build, and `--yes`
is forwarded:

```bash
./setup.sh --build                                   # setup, then the interactive build
./setup.sh --build --yes -- --mode chat --targets=deb   # non-interactive
./setup.sh --build --studio                          # …and set up the studio too, to also run natively
```

The **kiosk mode** is the first question and decides more than the terminal's
interaction style: it picks the AI services the bundle carries and the
deployment profile the platform starts them with —

| Mode | Services exported and auto-started |
|---|---|
| `touch` | OCR (NPU), face (CPU) — no speech, and no local LLM: `touch` terminals call a **remote** text-generation gateway, so point `llm.base_url` at it |
| `chat` / `agent` | all five, locally: LLM (GPU), OCR, face, STT, TTS (CPU) |

Output: `.AppImage` and/or `.deb`, copied to `build/` (built under
`electron/out/`). Both carry the shell's Chromium runtime — about two-thirds
of the package — so expect the AppImage around 115 MB (xz-compressed; Chromium's
own UI locales are trimmed to `en-US`, the kiosk's languages come from its
country pack); nothing beyond glibc is needed from the system.

The pipeline: `scripts/build.sh` hands straight over to
[electron/build.sh](../electron/build.sh) `--bundle-app`, so the toolchain
check, the install questions and the packaging all happen in one process. That
run calls [scripts/bundle.mjs](../scripts/bundle.mjs) — which stages the kiosk's
standalone server and exports the minimal studio with the kiosk injected as a
sample/worker (see [embedded-studio.md](embedded-studio.md)) — then ships that
export as a single tar inside the package.

## What ships and what happens on first launch

The package carries the bundle **pre-setup**: worker environments, the Node and
ffmpeg runtimes, and model downloads are machine-specific, so none of them are
shipped. On the terminal:

1. **First launch** unpacks the platform into the app's data directory
   (`~/.local/share/com.verticalreferencesolutionsblueprint.desktop/`) and runs the studio's own
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

For the from-checkout equivalent without packaging: `./setup.sh --bundle`
exports the bundle to `build/kiosk-studio/` (`scripts/bundle.sh` /
`scripts/bundle.mjs` does the export alone) and sets it up; launch it with
`./start.sh --bundle [--desktop]` (`start_win.bat --bundle` on Windows).

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
| anything else | bundle | see `scripts/bundle.sh --help` (`node scripts\bundle.mjs --help` on Windows) |

Two kiosk settings are baked in at build time because they are `NEXT_PUBLIC_*`
values inlined by `next build`: the terminal mode and the document source.
Everything else stays editable in the shipped `config.yaml` — see
[configuration.md](configuration.md).

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

`scripts\build.bat` runs [scripts/win/build.ps1](../scripts/win/build.ps1) and
builds the same embedded-bundle app as Linux — the bundler is a shared Node
script, [scripts/bundle.mjs](../scripts/bundle.mjs), and the studio's exporter
and exported launchers both come in Windows form (`export-bundle.mjs`,
`setup_win.bat`/`start_win.bat`, per-worker `start.ps1`). The injected kiosk
worker ships both entry points (`start.sh` + `start.ps1`), so a bundle exported
on either platform runs on either.

```bat
scripts\build.bat
scripts\build.bat -- --yes --targets=nsis
setup_win.bat --build -- --yes --targets=nsis    # from a fresh clone: setup, then build
```

Prerequisites: Node ≥ 20, git. Output: `.exe` (NSIS) and/or `.msi`, copied to
`build\`. The studio checkout is the export source and does not need to be set
up, so `setup_win.bat --build` leaves its setup alone. On the terminal, first
launch runs the studio's `setup_win.bat -AutoYes` instead of `setup.sh`; there
is no `install_dependencies.sh` step on Windows.

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
| App data | `~/.local/share/com.verticalreferencesolutionsblueprint.desktop/` | `%APPDATA%\vrsb\` |
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

- web app: `cd frontend && npm run build` (serve with `./start.sh`)
- standalone kiosk desktop app: `cd electron && ./build.sh`
- studio executable: `cd $EDGE_AI_STUDIO_DIR && ./scripts/bash/package.sh`
- bundle only (no packaging): `scripts/bundle.sh` (`node scripts\bundle.mjs` on Windows)
