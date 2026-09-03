// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// The kiosk is a Next.js server. This shell starts that server as a child
// process, waits for it to answer, and points one window at it — so the whole
// kiosk ships as a single .AppImage/.exe instead of a machine with Node and a
// checked-out repository on it.

const { app, BrowserWindow, Menu, utilityProcess } = require("electron");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

/// How long the server gets to answer before the window says so. Generous:
/// a kiosk that is slow to start is still a kiosk, and one that gives up is
/// a black screen someone has to drive out to.
const STARTUP_TIMEOUT_MS = 180_000;

/// How long a group gets to wind down after SIGTERM before it is killed
/// outright. The studio stops its AI workers one at a time, each with its own
/// grace period, so this is deliberately generous.
const SHUTDOWN_GRACE_MS = 20_000;

/// The port the embedded bundle's studio serves on. Fixed by the studio's own
/// start script, not chosen here.
const STUDIO_PORT = 8080;

/// Coverity trusts only a string rebuilt character by character from a
/// constant, and only when the rebuild sits in the same function as the fs or
/// spawn call it feeds — do not refactor those loops into a shared helper.
const PATH_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ._-~/\\:+@()&',";
const CMD_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

/// Every process the shell has started, in start order. OS children are
/// spawned as leaders of their own process groups; utility processes (the
/// standalone server) carry a kill() of their own.
///
/// Closing the window is the only "quit" a kiosk gets, so the shell owns the
/// teardown of everything below it. Killing the process it spawned is not
/// enough: that process is a shell script, and the stack under it (npm, the
/// studio's Next server, and the AI workers the studio detaches into process
/// groups of their own) outlives it.
const children = [];

/// Set once the shell knows it is showing the platform rather than the
/// standalone kiosk — only then does a page need a way back to it.
let platformMode = false;

/// Window shape decided at package time (scripts/build.mjs); absent in dev.
let shell = { fullscreen: false };
try { shell = require("./shell.json"); } catch {}

/// Injected into every page the window loads while in platform mode.
///
/// The window has no chrome — no tabs, no back button — so a sample opened
/// from the gallery would otherwise be a one-way trip. This adds the way
/// back, and keeps links that ask for a new tab (the gallery's "Open the
/// kiosk") in this one window, since the shell has nowhere else to put them.
const RETURN_TO_PLATFORM = `
(function () {
  if (window.__blueprintShell) return;
  window.__blueprintShell = true;

  var HOME = "http://127.0.0.1:8080";
  var HOME_PORT = "8080";

  window.open = function (url) { if (url) location.href = url; return null; };
  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest && event.target.closest('a[target="_blank"]');
    if (link && link.href) { event.preventDefault(); location.href = link.href; }
  }, true);

  if (location.port === HOME_PORT) return;

  document.addEventListener("keydown", function (event) {
    if (event.key === "F2" || (event.ctrlKey && event.shiftKey && event.key === "Backspace")) {
      location.href = HOME;
    }
  });

  var button = document.createElement("button");
  button.type = "button";
  button.textContent = "← Platform";
  button.title = "Back to the platform (F2)";
  button.setAttribute("style", [
    "position:fixed", "left:16px", "bottom:16px", "z-index:2147483647",
    "padding:8px 14px", "border-radius:999px", "border:1px solid rgba(255,255,255,.28)",
    "background:rgba(15,17,22,.72)", "color:#fff", "cursor:pointer",
    "font:600 12px system-ui,-apple-system,sans-serif", "opacity:.35",
    "backdrop-filter:blur(6px)", "transition:opacity .15s",
  ].join(";"));
  var show = function () { button.style.opacity = "1"; };
  var fade = function () { button.style.opacity = ".35"; };
  button.addEventListener("mouseenter", show);
  button.addEventListener("mouseleave", fade);
  button.addEventListener("touchstart", show, { passive: true });
  button.addEventListener("click", function () { location.href = HOME; });

  var attach = function () { if (document.body) document.body.appendChild(button); };
  if (document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach);
})();
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(() => resolve(), ms));

/// Read-only bundle payload: <resources>/resources when packaged (see
/// extraResources in scripts/build.mjs), the staged tree in dev.
function resourceDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "resources")
    : path.join(__dirname, "resources");
}

/// The platform data directory — an upgrade keeps a terminal's database,
/// config edits and unpacked studio. Windows uses the short "vrsb" name: the
/// unpacked studio nests deep enough that the bundle identifier pushes paths
/// past MAX_PATH.
function dataDir() {
  const id = "com.verticalreferencesolutionsblueprint.desktop";
  if (process.platform === "win32") {
    const dir = path.join(app.getPath("appData"), "vrsb");
    const legacy = path.join(app.getPath("appData"), id);
    if (!fs.existsSync(dir) && fs.existsSync(legacy)) {
      let from = "";
      for (const ch of legacy) {
        let ok = "";
        for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
        if (!ok) throw new Error("the data directory path contains a forbidden character");
        from += ok;
      }
      let to = "";
      for (const ch of dir) {
        let ok = "";
        for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
        if (!ok) throw new Error("the data directory path contains a forbidden character");
        to += ok;
      }
      if (from.includes("..") || to.includes("..")) {
        throw new Error("the data directory path contains a traversal segment");
      }
      fs.renameSync(from, to);
    }
    return dir;
  }
  const base = process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share");
  return path.join(base, id);
}

function createWindow() {
  const win = new BrowserWindow({
    title: "Vertical Reference Solutions Blueprint",
    width: 1280,
    height: 800,
    resizable: true,
    fullscreen: shell.fullscreen,
    frame: !shell.fullscreen,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.on("did-finish-load", () => {
    if (platformMode) win.webContents.executeJavaScript(RETURN_TO_PLATFORM).catch(() => {});
  });
  // The injected script rewrites window.open and _blank links; this catches
  // anything that slips past it (a page loaded before injection ran).
  win.webContents.setWindowOpenHandler(({ url }) => {
    win.loadURL(url).catch(() => {});
    return { action: "deny" };
  });
  win.loadFile(path.join(__dirname, "ui", "splash.html"));
  return win;
}

function navigate(win, url) {
  if (!win.isDestroyed()) win.loadURL(url).catch(() => showFailed(win));
}

function showFailed(win) {
  if (!win.isDestroyed()) {
    win.webContents
      .executeJavaScript("document.documentElement.dataset.state = 'failed'")
      .catch(() => {});
  }
}

/// Progress text on the splash page; a no-op once the page is replaced.
/// Messages are ASCII literals without quotes, so no escaping is needed.
function splashNote(win, message) {
  if (!win.isDestroyed()) {
    win.webContents
      .executeJavaScript(`document.getElementById('progress-label').textContent = '${message}'`)
      .catch(() => {});
  }
}

/// An AppImage's launch hooks export PATH and library paths pointing into the
/// mounted image (/tmp/.mount_*) so the app finds its bundled libraries.
/// Children of the shell are not part of the image — a worker venv's Python
/// with PYTHONHOME on the mount cannot even find its stdlib, and the mount
/// vanishes when the app closes while detached workers live on. Drop every
/// inherited value that points into the image; path lists keep their system
/// entries. No-op outside an AppImage (APPDIR unset).
function scrubbedEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  const appdir = process.env.APPDIR;
  if (!appdir) return env;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || !value.includes(appdir)) continue;
    const kept = value.split(":").filter((part) => !part.includes(appdir));
    if (kept.length === 0) delete env[key];
    else env[key] = kept.join(":");
  }
  return env;
}

/// Spawn `argv` as the leader of a new process group and remember it, so the
/// whole tree it grows can be signalled later as one.
function spawnTracked(argv, options) {
  const child = spawn(argv[0], argv.slice(1), {
    stdio: "inherit",
    detached: process.platform !== "win32",
    ...options,
  });
  const entry = { pid: child.pid, child, exited: false };
  child.on("exit", () => { entry.exited = true; });
  child.on("error", () => { entry.exited = true; });
  children.push(entry);
  return entry;
}

/// Run a tracked command to completion, so that closing the window during a
/// first-launch setup stops the download instead of orphaning it.
function runOk(argv, options) {
  return new Promise((resolve, reject) => {
    const entry = spawnTracked(argv, options);
    entry.child.on("error", reject);
    entry.child.on("exit", (code, signal) => {
      const index = children.indexOf(entry);
      if (index > -1) children.splice(index, 1);
      if (code === 0) resolve();
      else reject(new Error(`\`${argv.join(" ")}\` exited with ${signal ?? code}`));
    });
  });
}

/// True while any process in the group still exists. A group is addressed by
/// the pid of its leader even after that leader is gone.
function groupAlive(entry) {
  if (entry.kill) return !entry.exited;
  try {
    process.kill(-entry.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalGroup(entry, signal) {
  if (entry.kill) {
    entry.kill(signal);
    return;
  }
  if (process.platform === "win32") {
    // Windows has no process groups to signal and no SIGTERM to be gentle
    // with; `taskkill /T` walks the parent-child tree instead, which is
    // enough there because the studio does not detach its workers on Windows.
    spawnSync("taskkill", ["/PID", String(entry.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try { process.kill(-entry.pid, signal); } catch {}
}

function shutdownGraceMs() {
  const configured = Number(process.env.KIOSK_SHELL_SHUTDOWN_SECS);
  return Number.isFinite(configured) && configured >= 0 ? configured * 1000 : SHUTDOWN_GRACE_MS;
}

/// Stop everything the shell started, most recent first: SIGTERM to each
/// process group, then a shared grace period, then SIGKILL for whatever is
/// left. The gentle signal is the point — the studio's Next server stops its
/// AI workers from its own SIGTERM handler, and those workers are detached
/// into process groups of their own that nothing here would otherwise reach.
let stopping = null;
function stopAll() {
  if (stopping) return stopping;
  stopping = (async () => {
    const stopped = children.splice(0);
    if (stopped.length === 0) return;
    for (const entry of [...stopped].reverse()) signalGroup(entry, "SIGTERM");

    const deadline = Date.now() + shutdownGraceMs();
    while (Date.now() < deadline) {
      if (stopped.every((entry) => !groupAlive(entry))) return;
      await sleep(200);
    }
    for (const entry of stopped) signalGroup(entry, "SIGKILL");
  })();
  return stopping;
}

/// A port the kiosk can have to itself. Asking the OS for one and letting it
/// go is a race in theory; in practice it beats a fixed port that a second
/// kiosk — or anything else on the machine — may already hold.
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port, timeout: 500 });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("timeout", () => { socket.destroy(); resolve(false); });
      socket.once("error", () => resolve(false));
    });
    if (open) return true;
    await sleep(250);
  }
  return false;
}

/// Resources keep their staged path inside the bundle on some targets and are
/// flattened on others; look in both rather than guess.
function bundled(resources, name) {
  const nested = path.join(resources, "resources", name);
  return fs.existsSync(nested) ? nested : path.join(resources, name);
}

/// Create the writable half of the install and fill it in on first run.
///
/// Nothing here is ever overwritten: config.yaml is the operator's to edit,
/// and the database is the terminal's own once it has taken a request. An
/// upgrade replaces the bundle beside them and leaves both alone.
function prepareDataDir(resources, data) {
  let dir = "";
  for (const ch of data) {
    let ok = "";
    for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
    if (!ok) throw new Error("the data directory path contains a forbidden character");
    dir += ok;
  }
  fs.mkdirSync(path.join(dir, "documents"), { recursive: true });
  fs.mkdirSync(path.join(dir, "face-photos"), { recursive: true });

  const config = path.join(dir, "config.yaml");
  if (!fs.existsSync(config)) {
    let template = "";
    for (const ch of bundled(resources, "config.yaml")) {
      let ok = "";
      for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
      if (!ok) throw new Error("the bundle path contains a forbidden character");
      template += ok;
    }
    if (fs.existsSync(template)) fs.copyFileSync(template, config);
  }

  // Built and seeded at package time, because Payload only creates its
  // tables outside production and a packaged kiosk has no other chance.
  const database = path.join(dir, "db.sqlite");
  if (!fs.existsSync(database)) {
    let template = "";
    for (const ch of bundled(resources, "database")) {
      let ok = "";
      for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
      if (!ok) throw new Error("the bundle path contains a forbidden character");
      template += ok;
    }
    if (fs.existsSync(path.join(template, "db.sqlite"))) {
      fs.copyFileSync(path.join(template, "db.sqlite"), database);
      // The portraits the seeded rows point at.
      const faces = path.join(template, "face-photos");
      if (fs.existsSync(faces)) {
        fs.cpSync(faces, path.join(dir, "face-photos"), { recursive: true });
      }
    }
  }
}

/// Start kiosk.cjs — the standalone Next server with the kiosk's settings
/// read in first (see resources/server/kiosk.cjs) — on Electron's own Node
/// runtime, so the package carries no second copy of Node.
///
/// Everything the kiosk writes is pointed at the data directory: an .AppImage
/// is a read-only mount and an installed .exe lives under Program Files, so
/// the database, the captured documents and the uploaded portraits cannot
/// stay beside the bundled server the way they do in a checkout.
function startServer(serverDir, data, port) {
  const env = scrubbedEnv({
    NODE_ENV: "production",
    PORT: String(port),
    // Loopback only. The kiosk's API has no authentication of its own and
    // Next would otherwise bind every interface on the machine.
    HOSTNAME: "127.0.0.1",
    KIOSK_DATA_DIR: data,
    DATABASE_URL: `file:${path.join(data, "db.sqlite")}`,
    KIOSK_UPLOADS_DIR: path.join(data, "documents"),
    KIOSK_FACE_PHOTOS_DIR: path.join(data, "face-photos"),
  });
  // See server-entry.js: an empty value would not survive the fork.
  const empty = Object.keys(env).filter((key) => env[key] === "");
  if (empty.length) env.KIOSK_SHELL_EMPTY_ENV = empty.join(",");
  const server = utilityProcess.fork(
    path.join(__dirname, "server-entry.js"),
    [path.join(serverDir, "kiosk.cjs")],
    { cwd: serverDir, stdio: "inherit", env },
  );
  const entry = { pid: server.pid, exited: false, kill: (signal) => server.kill(signal) };
  server.once("exit", () => { entry.exited = true; });
  children.push(entry);
}

/// Unpack (first launch), set up (first launch) and start the embedded
/// bundle, then point the window at the studio once it answers.
async function runBundle(win, tar, data) {
  const studio = path.join(data, "kiosk-studio");
  try {
    await prepareBundle(win, tar, data, studio);
  } catch (error) {
    console.error(`kiosk-shell: ${error.message}`);
    showFailed(win);
    return;
  }

  splashNote(win, "Starting the platform...");
  try {
    const start = process.platform === "win32"
      ? ["cmd.exe", "/c", "start_win.bat"]
      : ["bash", "./start.sh"];
    spawnTracked(start, { cwd: studio, env: scrubbedEnv() });
  } catch (error) {
    console.error(`kiosk-shell: could not start the studio: ${error.message}`);
    showFailed(win);
    return;
  }

  const timeoutMs = (Number(process.env.KIOSK_SHELL_TIMEOUT_SECS) || 900) * 1000;
  if (await waitForPort(STUDIO_PORT, timeoutMs)) {
    navigate(win, `http://127.0.0.1:${STUDIO_PORT}`);
  } else {
    showFailed(win);
  }
}

async function prepareBundle(win, tar, data, studio) {
  let dir = "";
  for (const ch of data) {
    let ok = "";
    for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
    if (!ok) throw new Error("the data directory path contains a forbidden character");
    dir += ok;
  }
  let target = "";
  for (const ch of studio) {
    let ok = "";
    for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
    if (!ok) throw new Error("the studio path contains a forbidden character");
    target += ok;
  }
  let archive = "";
  for (const ch of tar) {
    let ok = "";
    for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
    if (!ok) throw new Error("the bundle path contains a forbidden character");
    archive += ok;
  }

  if (!fs.existsSync(target)) {
    splashNote(win, "Unpacking the platform (first launch)...");
    // Extract next to the final name and rename at the end, so a launch
    // killed mid-extract does not leave a half tree that the next launch
    // takes for a finished one.
    const scratch = path.join(dir, "kiosk-studio.partial");
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.mkdirSync(scratch, { recursive: true });
    await runOk(["tar", "-xf", archive], { cwd: scratch, env: scrubbedEnv() });
    fs.renameSync(path.join(scratch, "studio"), target);
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  if (!fs.existsSync(path.join(target, "frontend", ".next", "BUILD_ID"))) {
    splashNote(win, "Installing services (first launch) - this downloads and can take a while...");
    // There is no console to answer prompts on, so the Windows setup runs
    // with its confirmations pre-answered.
    const setup = process.platform === "win32"
      ? ["cmd.exe", "/c", "setup_win.bat", "-AutoYes"]
      : ["bash", "./setup.sh"];
    await runOk(setup, { cwd: target, env: scrubbedEnv() });
  }
}

// One window is the whole terminal: a second launch has nothing to add, and
// two Chromium instances cannot share the profile directory anyway.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

// Keep Chromium's profile and caches inside the app's data directory, where
// the uninstaller already looks.
app.setPath("userData", path.join(dataDir(), "webview-profile"));

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const win = createWindow();

  // External-target mode: something else runs the server — e.g. the embedded
  // studio bundle, which starts the kiosk itself as one of its worker
  // processes. The shell then only (optionally) launches that stack and
  // points the window at the given URL, and stops it again on the way out —
  // set KIOSK_SHELL_KEEP_ALIVE=1 to leave it running instead (a studio that
  // was already up is not ours to stop; this mode only launches one when
  // asked to).
  const url = process.env.KIOSK_SHELL_URL;
  if (url) {
    const port = Number((url.split(":").pop() || "").replace(/\/+$/, "")) || 80;
    // Pointed at the platform, the window needs the way back from whatever a
    // sample opens; pointed straight at the kiosk it is the only page there is.
    platformMode = port === STUDIO_PORT;
    const cmd = process.env.KIOSK_SHELL_CMD;
    if (cmd) {
      let script = "";
      for (const ch of cmd) {
        let ok = "";
        for (const allowed of CMD_CHARS) if (allowed === ch) { ok = allowed; break; }
        if (!ok) {
          console.error("kiosk-shell: KIOSK_SHELL_CMD contains a forbidden character");
          showFailed(win);
          return;
        }
        script += ok;
      }
      let cwd = "";
      for (const ch of process.env.KIOSK_SHELL_CWD || ".") {
        let ok = "";
        for (const allowed of PATH_CHARS) if (allowed === ch) { ok = allowed; break; }
        if (!ok) {
          console.error("kiosk-shell: KIOSK_SHELL_CWD contains a forbidden character");
          showFailed(win);
          return;
        }
        cwd += ok;
      }
      const options = { cwd, env: scrubbedEnv() };
      const runner = process.platform === "win32"
        ? ["cmd.exe", "/c", script]
        : ["bash", "-lc", script];
      if (process.env.KIOSK_SHELL_KEEP_ALIVE) {
        spawn(runner[0], runner.slice(1), { ...options, stdio: "inherit" });
      } else {
        spawnTracked(runner, options);
      }
    }
    const timeoutMs = Number(process.env.KIOSK_SHELL_TIMEOUT_SECS) * 1000 || STARTUP_TIMEOUT_MS;
    if (await waitForPort(port, timeoutMs)) navigate(win, url);
    else showFailed(win);
    return;
  }

  const resources = resourceDir();

  // Embedded-bundle mode: the package carries the minimal studio export (kiosk
  // injected as a sample) as a single tar. First launch unpacks it into the
  // data directory and runs the studio's own setup there — the worker
  // environments must be created where they will live, and the install itself
  // is read-only. Every launch then starts the studio, which brings the kiosk
  // up as its own worker process; the window opens on the studio.
  const bundleTar = bundled(resources, "kiosk-studio.tar");
  if (fs.existsSync(bundleTar)) {
    platformMode = true;
    await runBundle(win, bundleTar, dataDir());
    return;
  }

  const serverDir = bundled(resources, "server");
  const data = dataDir();
  try {
    prepareDataDir(resources, data);
  } catch (error) {
    console.error(`kiosk-shell: ${error.message}`);
    showFailed(win);
    return;
  }

  const port = Number(process.env.KIOSK_PORT) || (await freePort());
  startServer(serverDir, data, port);

  // The window is already up showing the splash; it is swapped for the kiosk
  // itself once the port answers.
  if (await waitForPort(port, STARTUP_TIMEOUT_MS)) {
    navigate(win, `http://127.0.0.1:${port}`);
  } else {
    showFailed(win);
  }
});

// Closing the window is the kiosk's only "quit"; Ctrl+C in the terminal that
// launched the app and the SIGTERM a session logout sends both arrive here
// too. All of them run the same teardown, held open until it finishes.
app.on("window-all-closed", () => app.quit());
app.on("will-quit", (event) => {
  if (!stopping) {
    event.preventDefault();
    stopAll().then(() => app.quit());
  }
});
process.on("SIGINT", () => stopAll().then(() => process.exit(130)));
process.on("SIGTERM", () => stopAll().then(() => process.exit(130)));
