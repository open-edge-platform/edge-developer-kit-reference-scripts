# Packaging the kiosk

The kiosk is a Next.js server, so a terminal normally needs Node, a checkout
and an `npm install`. This turns it into one file instead: an `.AppImage` on
Ubuntu or an installer `.exe` on Windows, which anyone can copy to a machine
and double-click.

The app itself is a window and nothing else. It starts the kiosk's server as a
child process on a loopback port, waits for it to answer, and shows it. There
is no second copy of the UI here to keep in step — what the terminal displays
is the same `frontend/` you develop against.

The shell is Electron: Node is its whole toolchain and a patched runtime is one
`npm update` away, it is the same shell the Edge AI Demo Studio ships, and
Chromium grants `getUserMedia` without a native permission prompt that an
unattended kiosk has nobody to answer.

## Build it

```bash
cd electron
./build.sh            # Linux — asks a few questions, then packages
.\build.ps1           # Windows — same, PowerShell
```

Node ≥ 20 is the whole toolchain. The build asks for the settings that cannot
be changed afterwards, and packages the result into `electron/out/`, copying
the installers to `build/`.

Useful flags — both scripts pass everything through to `scripts/build.mjs`:

| | |
|---|---|
| `--yes` | don't ask; take the defaults from `frontend/config.yaml` |
| `--mode=touch\|chat\|agent` | which kiosk this terminal runs |
| `--fullscreen` / `--windowed` | window chrome, or none |
| `--mock` / `--live` | mock the AI services, or call them |
| `--targets=appimage,deb` | what to package (`nsis`, `msi` on Windows) |
| `--no-build` | reuse the last kiosk server build |
| `--stage-only` | assemble the bundle without packaging it |
| `--dev` | run the shell without packaging — the fastest way to try a change |
| `--shell-only` | package just the shell, unpacked (external-target mode) |
| `--bundle-app` | package `build/kiosk-studio` as the app (what `../scripts/build.sh` runs) |

## What the questions decide

Almost every kiosk setting is read from `config.yaml` at start-up, so it can be
changed on the terminal. Two cannot: Next inlines every `NEXT_PUBLIC_*` value
into the browser bundle when it compiles, so **which kiosk a terminal runs**
(`terminal.mode`) and **where documents come from** (`documents.source`) are
decided when you build and nowhere else.

That is what the prompts are for. The answers are written into the `config.yaml`
that ships inside the app, so the file on the terminal still reads as the truth
about that install — with a header saying which of its settings the build has
already fixed.

## On the terminal

The app keeps everything it writes in one directory, because an `.AppImage` is
a read-only mount and an installed `.exe` lives somewhere the citizen cannot
write. It is the same directory earlier builds used, so upgrading keeps a
terminal's data:

```
~/.local/share/com.verticalreferencesolutionsblueprint.desktop/     # %APPDATA%\vrsb on Windows
├── config.yaml         the settings for this terminal — edit and restart
├── db.sqlite           citizens, requests, payments
├── documents/          captured and uploaded PDFs
├── face-photos/        reference portraits
└── webview-profile/    Chromium's own profile and caches
```

All of it is created on first launch and never overwritten again, so
reinstalling or upgrading the app leaves the terminal's own data and settings
alone. Delete `db.sqlite` to go back to the seeded demo registry.

To see what the server is doing, run the app from a terminal — its log goes to
stdout.

## How it fits together

```
electron/
├── build.sh, build.ps1        toolchain check, then scripts/build.mjs
├── scripts/build.mjs          asks, builds, assembles, packages
├── scripts/make-icons.mjs     draws the app icon
├── main.js                    start the server, wait, show it, stop it on quit
├── server-entry.js            runs kiosk.cjs on Electron's Node; restores the
│                              empty env values Chromium drops on the way in
├── ui/splash.html             what the window shows while the server starts
├── electron-fuses.js          hardening flipped into the packaged binary
├── shell.json                 the window shape the answers decided (generated)
├── icons/                     the app icon                       (generated)
└── resources/                 the bundled kiosk                  (generated)
```

The build stages four things into `resources/`:

- **`server/`** — `next build` with `output: "standalone"`, which writes a
  server carrying its own `node_modules`. `kiosk.cjs` goes in beside it: it
  reads the terminal's `config.yaml` into the environment before handing over,
  because Next's standalone entry moves to its own directory first and would
  otherwise read the read-only copy.
- **`assets/`** — the mock documents and ID card images the kiosk reads from
  disk, kept beside the server so the relative paths in `config.yaml` still
  land on them.
- **`database/`** — a seeded `db.sqlite`, built during packaging. Payload
  creates its tables on connect but only outside production, and this project
  has no migrations, so a packaged kiosk would never get a schema. The build
  starts Payload once on its own and ships what it made.
- **`config.yaml`** — the template copied into the data directory on first run.

No Node runtime ships: the shell runs `kiosk.cjs` on Electron's own Node
(`utilityProcess`), so the package carries one runtime, not two. The server's
native modules (sharp, libsql, pcsc-mini) are N-API builds, which load there
unchanged.

## Notes

- **Size.** About 140 MB packaged: the Chromium runtime plus ~90 MB of server.
- **Cross-compiling.** There isn't any: build the `.AppImage` on Ubuntu and the
  `.exe` on Windows. Both scripts take the same flags.
- **Teardown.** Closing the window is the kiosk's only quit, so the shell owns
  stopping everything under it: each child is the leader of its own process
  group, which gets SIGTERM, a grace period (`KIOSK_SHELL_SHUTDOWN_SECS`,
  default 20s), then SIGKILL. `taskkill /T` on Windows.
