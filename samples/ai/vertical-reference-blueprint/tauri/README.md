# Packaging the kiosk

The kiosk is a Next.js server, so a terminal normally needs Node, a checkout
and an `npm install`. This turns it into one file instead: an `.AppImage` on
Ubuntu or an installer `.exe` on Windows, which anyone can copy to a machine
and double-click.

The app itself is a window and nothing else. It starts the kiosk's server as a
child process on a loopback port, waits for it to answer, and shows it. There
is no second copy of the UI here to keep in step — what the terminal displays
is the same `frontend/` you develop against.

## Build it

```bash
cd tauri
./build.sh            # Linux — asks a few questions, then packages
.\build.ps1           # Windows — same, PowerShell
```

The first run checks the toolchain and offers to install what is missing
(Rust, WebKitGTK's headers). Then it asks for the settings that cannot be
changed afterwards, and packages the result:

```
tauri/src-tauri/target/release/bundle/appimage/*.AppImage
```

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
write:

```
~/.local/share/com.verticalreferenceblueprint.desktop/     # %APPDATA% on Windows
├── config.yaml      the settings for this terminal — edit and restart
├── db.sqlite        citizens, requests, payments
├── documents/       captured and uploaded PDFs
└── face-photos/     reference portraits
```

All four are created on first launch and never overwritten again, so
reinstalling or upgrading the app leaves the terminal's own data and settings
alone. Delete `db.sqlite` to go back to the seeded demo registry.

To see what the server is doing, run the app from a terminal — its log goes to
stdout.

## How it fits together

```
tauri/
├── build.sh, build.ps1        toolchain check, then scripts/build.mjs
├── scripts/build.mjs          asks, builds, assembles, packages
├── scripts/make-icons.mjs     draws the app icon
├── scripts/setup-linux.sh     installs Rust and the GTK/WebKit headers
├── ui/splash.html             what the window shows while the server starts
└── src-tauri/
    ├── src/main.rs            start the server, wait, show it, stop it on quit
    ├── tauri.conf.json        the shape of the app; the answers go in an overlay
    ├── binaries/              the bundled Node runtime          (generated)
    └── resources/             the bundled kiosk                 (generated)
```

The build stages four things into `src-tauri/resources/`:

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

And the Node runtime: whichever `node` ran the build is copied in as an
`externalBin`, which is what Tauri puts next to the executable with its execute
bit intact. Pass `--node=/path/to/node` to bundle a different one.

## Notes

- **Size.** About 220 MB packaged: ~90 MB of server and ~125 MB of Node
  runtime.
- **Cross-compiling.** There isn't any: build the `.AppImage` on Ubuntu and the
  `.exe` on Windows. Both scripts take the same flags.
- **The camera.** WebKitGTK asks before granting `getUserMedia`, and a kiosk
  has nobody to answer. If the identity step cannot open the camera in the
  packaged app, that permission prompt is the first thing to check — it is
  handled in the webview, not in the kiosk's code.
- **Ports.** The server is given a free loopback port at start-up and is not
  reachable from the network. Set `KIOSK_PORT` to pin it.
