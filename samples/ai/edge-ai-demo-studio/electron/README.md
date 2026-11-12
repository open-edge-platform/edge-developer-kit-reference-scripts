# Edge AI Demo Studio - desktop app (Electron)

The desktop app wraps the studio in an Electron window. On the first launch it
sets up the third-party tools and the worker environment, then it starts the
bundled Next.js server on `127.0.0.1:8080` and opens it. It is packaged with
electron-builder; the configuration is the `build` key in `package.json`.

| File | Purpose |
|------|---------|
| `main.js` | Main process: first-run setup, the Next.js server, window, tray, shutdown |
| `splash.html`, `splash.js`, `preload.js` | Setup splash screen and its progress/log IPC |
| `electron-fuses.js` | `afterPack` hook that flips the Electron fuses |
| `installer.nsh` | Windows (NSIS) installer options page and install/uninstall steps |
| `setup.sh`, `setup.ps1` | `npm install` with the repo's bundled Node.js |

## Setup

The root setup installs Node.js into `thirdparty/` and, when asked, this
directory's dependencies:

```bash
./setup.sh --enable-electron          # Linux
.\setup_win.bat -EnableElectron       # Windows (setup.ps1 takes the same switch)
```

To set up only this directory (after the root setup):

```bash
./electron/setup.sh                   # Linux
.\electron\setup.ps1                  # Windows
```

The `electron` npm package (43.x) downloads the Electron binary the first time
it runs, not during `npm install`.

## Running from the repo

```bash
cd electron
npm start
```

This needs the root setup (thirdparty tools, workers) and a built frontend
(`frontend/setup.sh` builds `frontend/.next/standalone`). In development the
app uses the repo itself: the standalone server (static assets are copied
into it at start), `workers/`, `thirdparty/` and `deployment.json` at the repo
root; its logs go to `electron/logs/`. The system dependency step is skipped,
so run `sudo ./install_dependencies.sh` yourself.

## First launch

1. **LLM backend** (Linux): Intel SYCL or Vulkan for llama.cpp, saved to
   `workers/engines/multiserve/.llamacpp-backend`. Windows always uses Vulkan.
2. **Window or background**: whether to run as a plain window or in the
   background (tray mode, see below). Not asked by a Windows installer
   install, whose options page has the same choice.
3. **System dependencies** (Linux): offers to run `install_dependencies.sh` as
   root behind the desktop's password prompt. Its output goes to
   `logs/system-dependencies.log`. If it fails, or no password prompt is
   available (no polkit agent, e.g. over SSH), a dialog shows why and the
   `sudo` command to run by hand, and offers Retry, Continue without them, or
   Quit. Cancel skips it and setup continues; it is offered again only with
   `--reconfigure`.
4. **Setup** behind the splash screen, with a live log (click the last line to
   expand it): `setup_thirdparty` (Node.js, FFmpeg, qmassa, pci.ids), then
   `workers/setup.sh --setup-workers` (uv, OpenVINO Model Server, the shared
   `workers/.venv`), then `workers/engines/setup.sh` (multiserve: llama.cpp and
   the SYCL runtime). About ten minutes on a fresh machine, mostly downloads.
   Closing the splash asks before it stops setup.
5. The server starts and the window opens.

Later launches show a short "Starting" splash, then the window (nothing with
`--hidden`). Setup runs again when the bundled Node.js is missing (a new
folder, a reinstall) or with `--reconfigure`, which also asks both questions
again. Service dependencies and models are installed when a service first
starts, not during setup.

## Errors and recovery

- **Setup or startup fails**: a dialog shows the error, the failing step's
  last lines of output and the logs folder, with Retry (relaunches the app),
  Open logs folder, and Quit.
- **The server stops on its own** after it started: it is restarted and the
  window reloads. After three restarts within ten minutes, a dialog offers
  Restart, Open logs folder, or Quit instead.
- **The window's page crashes**: it reloads (at most once every ten seconds).
- **Links**: studio pages stay in the app; links to other sites (Hugging Face,
  documentation, a sample suite's own UI) open in the default browser.

## Where files go

| Install | Setup output, models, database, logs |
|---------|--------------------------------------|
| Zip, or the Windows installer in a writable folder | `resources/` next to the executable |
| AppImage | `~/.local/share/edge-ai-demo-studio` (`$XDG_DATA_HOME` if set; see below) |
| Windows installer in a read-only folder | `%LOCALAPPDATA%\edge-ai-demo-studio` |
| Development (`npm start`) | The repo |

A packaged app runs from its own `resources/` folder when it can write there.
When it cannot (an AppImage always runs from a read-only mount), the first
launch copies `resources/` to the per-user folder above and setup and the
server run from that copy. A newer version refreshes the copy on its first
launch: files it no longer ships are deleted (the list of shipped files is
kept in `.shipped-files.json`), and what setup and the services added
(venvs, downloads, models, the database) stays. Delete the folder to reset
the app or free the space.

Logs are in the `logs/` folder of the location above: `electron.log` (the
app itself: startup, setup results, server restarts, errors), `frontend.log`
(the Next.js server), `thirdparty.log`, `workers.log` and `engines.log` (the
setup steps), `system-dependencies.log` (Linux), and `setup/` (the workers
setup's per-tool logs). `electron.log` and `frontend.log` keep the previous
run as `electron.previous.log` and `frontend.previous.log`, so the log of a
crashed server survives its restart. Per-user state lives in Electron's
userData folder (`~/.config/edge-ai-demo-studio`,
`%APPDATA%\edge-ai-demo-studio`): the setup markers, the tray-mode choice
(`tray-mode`) and the window's browser profile.

## Port 8080

The server listens on `127.0.0.1:8080` only. If another program already holds
that port (another install, or a studio started with `start.sh` or
`npm run dev`), the app shows an error naming the port instead of showing that
program's pages; stop the other program and choose Retry. Only one instance
runs per user: launching the app again brings its window (or its splash) up.

Setting `FRONTEND_HOST=0.0.0.0` in the app's environment makes the server listen
on every interface, so other machines can reach it on port 8080; the CD demo
machine does this. The window still loads `127.0.0.1`, and the workers stay on
loopback behind the server's proxy.

## Command-line switches

| Switch | Effect |
|--------|--------|
| `--reconfigure` | Run the first-launch setup again, including the backend and window/background questions |
| `--tray` | Tray mode (see below) |
| `--hidden` | In tray mode, start without opening the window |

## Tray mode (optional)

Tray mode is off by default: the app opens one window and quits when that
window is closed. It is enabled by:

- the **"Run in the background (tray icon, start at login)"** checkbox on the
  Windows installer's options page. Ticking it writes a `resources\tray-mode`
  marker next to the app and a HKCU Run entry that launches the app with
  `--hidden` at login. Both are removed by the uninstaller, and reinstalling
  with the box unticked turns the mode off again.
- **"Run in the background"** at the first launch of any other install (the
  AppImage, a zip). It writes a `tray-mode` marker in the userData folder and
  turns on start at login. `--reconfigure` asks again.
- the `--tray` command-line switch, on any platform.

With tray mode on, the app keeps a tray icon (Windows notification area,
macOS menu bar, Linux status area). Closing the main window hides it (the
first time, a notification says it is still running); the Next.js server and
the workers keep running. The tray menu offers:

- the server's state: running at `http://127.0.0.1:8080`, or restarting
- **Open Edge AI Demo Studio** - shows the window again (left click does the same on Windows and macOS)
- **Open in browser** - opens `http://127.0.0.1:8080` in the default browser
- **Open logs folder**
- **Start at login** - registers or removes the login item (HKCU Run entry on
  Windows, login item on macOS, `~/.config/autostart/edge-ai-demo-studio.desktop`
  on Linux); disabled in development mode because there is no installed binary to register
- **Quit** - stops the server and every worker, then exits

`--hidden` starts the server and the tray icon without opening a window; it is
ignored outside tray mode. The login item passes `--tray --hidden`, so it
works for a `--tray` install too; on Linux each tray-mode launch rewrites the
autostart entry, which keeps it pointing at a moved AppImage.

On Linux the tray icon needs a StatusNotifier host; stock GNOME needs the
AppIndicator extension, Ubuntu ships one. Electron 43.3.0 through 43.5.x drop
the tray icon on GNOME a few seconds after creating it
(electron/electron#52674). The dependency is pinned to 43.8.1 or newer: before
43.7.6 a Linux `dialog.showMessageBox` promise could stay pending while the
app was idle (the app now uses the synchronous variant either way).

## Packaging

```bash
./scripts/bash/package.sh             # Linux
.\scripts\win\package.ps1             # Windows
```

The package scripts stage `build/` (workers, scripts, `deployment.json` if
present and its example, the deployment docs, the standalone frontend), run
electron-builder, and zip the result. Everything in `build/` ends up in the
app's `resources/`. Output in `out/`:

| Platform | Files |
|----------|-------|
| Linux | `EdgeAIDemoStudio.zip` (a launcher script and `linux-unpacked/`), `EdgeAIDemoStudio-<version>.AppImage`, and electron-builder's own zip |
| Windows | `EdgeAIDemoStudio.zip` (the unpacked app), the NSIS installer `.exe` |

`npm run build:dir` rebuilds only the unpacked app (`out/linux-unpacked` or
`out/win-unpacked`) from an existing `build/`, which is enough after a change
to the files in this directory.

The Windows installer installs into an `EdgeAIDemoStudio` folder next to
itself by default (the folder can be changed), can add a desktop shortcut and
turn on tray mode, and leaves the userData folder on uninstall. If the chosen
folder is not writable, the app works from `%LOCALAPPDATA%\edge-ai-demo-studio`
as described above.

The AppImage is the Linux install: make it executable (`chmod +x`) and run
it, no root needed. Each launch writes a menu entry and its icon,
`~/.local/share/applications/edge-ai-demo-studio.desktop` and
`~/.local/share/icons/hicolor/512x512/apps/edge-ai-demo-studio.png`, pointing
at the AppImage file wherever it is; the entry's `TryExec` hides it once that
file is deleted. To update, run the newer AppImage. To uninstall, delete the
AppImage, `~/.local/share/edge-ai-demo-studio`, `~/.config/edge-ai-demo-studio`
and the two menu files. It is built with electron-builder's static AppImage
runtime (`toolsets.appimage` in `package.json`), which needs no `libfuse2`;
the default runtime fails on a stock Ubuntu 24.04 with "AppImages require
FUSE to run". Its launcher passes `--no-sandbox` to Chromium only where
unprivileged user namespaces are unavailable (`unshare -Ur true` fails).

The fuses turn off `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, and
make the app load only from `app.asar` (integrity-checked on Windows), so a
debugger cannot attach to a packaged build; use `npm start` for that.

To check a package without a desktop session,
`.github/workflows/scripts/smoke_test_package.sh --package out/EdgeAIDemoStudio.zip`
checks the layout and boots the bundled server (no Electron).

## Troubleshooting

- **Setup failed**: the dialog shows the failing step's last output; its full
  log is in the logs folder (Open logs folder). Retry re-runs setup.
- **Port 8080 in use**: stop the other program, then choose Retry
  (`ss -ltnp | grep :8080` on Linux, `netstat -ano | findstr :8080` on Windows).
- **Anything else**: `electron.log` in the logs folder records what the app
  did; `electron.previous.log` is the run before.
- **No devices listed when adding a service**: the shared `workers/.venv` is
  missing or incomplete; run the app with `--reconfigure`.
- **The app opens as a plain Node.js prompt or prints a Node version**: the
  shell has `ELECTRON_RUN_AS_NODE=1` set (some editor extension hosts set it);
  unset it before `npm start`.
