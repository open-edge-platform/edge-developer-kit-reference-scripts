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
is forwarded. The build's questions are asked first, before the frontend
dependencies install, so the run is unattended from the first install on:

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
| `chat` / `agent` | all five, locally: LLM (GPU), STT (NPU), OCR, face, TTS (CPU) |

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
export as a single tar inside the package. `./setup.sh --build` asks the same
questions itself, before its own installs: it runs
`electron/scripts/build.mjs --bundle-app --ask-only`, which prompts on stderr
and prints the complete build argument list on stdout (`--yes`, the answers as
flags, then the pass-through), and hands that to the build so nothing is asked
twice. `setup_win.bat --build` does the same.

## What ships and what happens on first launch

The package carries the bundle **pre-setup**: worker environments, the Node and
ffmpeg runtimes, and model downloads are machine-specific, so none of them are
shipped. On the terminal:

1. **First launch** unpacks the platform into the app's data directory
   (`~/.local/share/VRSB/`, `%APPDATA%\VRSB` on Windows) and runs the studio's own
   `setup.sh` there — runtimes, worker environments, frontend build. Long, and
   it needs network. The splash screen reports progress.
2. **Every launch** starts the studio as the main process and opens the window
   on it (`:8080`). The studio runs the entire blueprint as its own worker
   process, reachable from the samples gallery on its own URL (`:8035` by
   default).

**Getting back from a sample.** The window has no chrome, so the shell adds
the way back itself: the **F2** key (or `Ctrl+Shift+Backspace`) on any page
that is not the platform, and the *Platform* entry of the staff menu below —
nothing is drawn on the kiosk's screen. The shell also keeps links that ask
for a new tab — the gallery's "Open the kiosk" — inside the one window, since
it has nowhere else to put them.

**Upgrading.** Every launch compares the build id in the package with the
stamp on the unpacked platform (`<data dir>/kiosk-studio/.bundle-id`). A newer
package replaces the unpacked tree — the platform's source and the kiosk
server are the build's — and carries across what the terminal owns: the kiosk
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
no F9); `Esc` or *Close* dismisses it. The pages themselves stay behind the CMS
admin login — the menu is only the way to reach them. The same menu exists in
every mode of the shell, including the standalone kiosk and
`./start.sh --bundle --desktop`. The window opens on the kiosk in every mode;
`KIOSK_SHELL_PLATFORM_URL` is what puts the platform on the menu behind it (the
launchers set it).

A settings save at `/settings` restarts the kiosk (exit code 77 — see
[configuration.md](configuration.md#the-settings-page)): the shell starts its
own server again on the same port, and the studio worker's `start.sh` loops the
same way, so the studio keeps watching one PID.

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
| `--mode touch\|chat\|agent` | both | asked first; decides which services go in and the shipped `config.yaml`'s `terminal.mode` |
| `--fullscreen` / `--windowed` | shell | kiosk window style |
| `--targets=appimage,deb` | shell | package formats |
| `--port <n>` | bundle | embedded kiosk port (default 8035) |
| `--allow-missing` | bundle | build even if the studio checkout lacks services |
| anything else | bundle | see `scripts/bundle.sh --help` (`node scripts\bundle.mjs --help` on Windows) |

`--mode` only picks what the shipped `config.yaml` starts with. No kiosk
setting is frozen into the build: every key stays editable in the terminal's
`config.yaml` and takes effect on the next restart — see
[configuration.md](configuration.md#when-a-change-takes-effect).

## Deploying a kiosk terminal

1. Install the `.deb` (or copy the `.AppImage`) from `build/`.
2. Make sure the machine has the studio's system packages (its
   `install_dependencies.sh`, once, with sudo) and network for the first
   launch.
3. Launch. First launch installs and starts everything; the window opens on
   the kiosk, with the platform behind it on the staff menu (F9, or five taps
   in the top-right corner).

The app's data directory holds the unpacked platform, the kiosk database and
`config.yaml` — every setting is editable there, and a restart is all any of
them needs.

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
| App data | `~/.local/share/VRSB/` | `%APPDATA%\VRSB\` |
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
