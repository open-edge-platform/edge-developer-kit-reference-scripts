// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

const { app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, shell } = require("electron");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { fileURLToPath } = require("url");
const fs = require("fs");
const net = require("net");
const util = require("util");
const treeKill = require("tree-kill");
const readline = require("readline");

const childProcesses = [];
const isWindows = os.platform() === "win32";
const isMac = os.platform() === "darwin";
let cleanupPromise = null;

/** Characters allowed in FRONTEND_HOST: an IPv4 or IPv6 address, or a host name. */
const HOST_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:";

let SERVER_HOST = "";
for (const ch of process.env.FRONTEND_HOST || "127.0.0.1") {
  let allowedChar = "";
  for (const allowed of HOST_CHARS) {
    if (allowed === ch) {
      allowedChar = allowed;
      break;
    }
  }
  if (!allowedChar) {
    console.warn("FRONTEND_HOST is not an address or host name; listening on 127.0.0.1.");
    SERVER_HOST = "127.0.0.1";
    break;
  }
  SERVER_HOST += allowedChar;
}
const SERVER_PORT = 8080;
/** Loopback whatever SERVER_HOST is: 0.0.0.0 is not an address to connect to on Windows. */
const APP_URL = `http://127.0.0.1:${SERVER_PORT}`;

/** Characters allowed in a file-system path (PATH_CHARS in frontend/src/lib/validation.ts). */
const PATH_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~/\\: @+,=()[]";

const rawUserRuntimeDir = isWindows
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "edge-ai-demo-studio")
  : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "edge-ai-demo-studio");
/**
 * Per-user copy of resources/ that a read-only install (the AppImage, a Windows install in a
 * read-only folder) sets up and runs from. Empty when the path has a character outside PATH_CHARS.
 */
let USER_RUNTIME_DIR = "";
for (const ch of rawUserRuntimeDir) {
  let allowedChar = "";
  for (const allowed of PATH_CHARS) {
    if (allowed === ch) {
      allowedChar = allowed;
      break;
    }
  }
  if (!allowedChar) {
    USER_RUNTIME_DIR = "";
    break;
  }
  USER_RUNTIME_DIR += allowedChar;
}
/** In USER_RUNTIME_DIR: `{ from, files }`, the package it was copied from and the files it shipped. */
const SHIPPED_FILES_NAME = ".shipped-files.json";
/** resources/ entries Electron itself reads, left out of that copy. */
const INSTALL_ONLY_ENTRIES = new Set(["app.asar", "app.asar.unpacked", "tray-mode"]);

/** Stable identity for the Windows taskbar and the login-item registry value. */
const APP_USER_MODEL_ID = "com.intel.edge-ai-demo-studio";

/**
 * Tray mode is opt-in: `--tray`, the Windows installer's checkbox (a marker file in resources), or
 * the first-launch question elsewhere (a marker file in userData). Without it there is one window,
 * and closing it quits. Set again by the first-launch question.
 */
let trayMode = app.commandLine.hasSwitch("tray") || hasTrayModeMarker();

/**
 * `--hidden`, passed by the login item, starts the server and tray without a window. Tray mode
 * only: without a tray icon a hidden app would be unreachable.
 */
const startHidden = trayMode && app.commandLine.hasSwitch("hidden");

/** What the login item passes: `--tray` too, for installs whose tray mode is only the switch. */
const LOGIN_ITEM_ARGS = ["--tray", "--hidden"];

let tray = null; // Kept as a global so the icon is not garbage-collected
let mainWindow = null; // The single main window (hidden rather than closed)
let splashWindow = null; // The setup or startup splash while it is open
let isQuitting = false; // Set once a real quit is underway so close hides no more
let setupRunning = false; // Closing the splash asks first while the setup scripts run

/** Grace period (ms) between SIGTERM and SIGKILL when stopping a process tree. */
const SIGTERM_GRACE_MS = 5000;

/** How long the server may take to answer after it is spawned. */
const SERVER_START_TIMEOUT_MS = 120000;

/** Unexpected server exits restarted automatically within SERVER_RESTART_WINDOW_MS before asking. */
const SERVER_RESTART_LIMIT = 3;
const SERVER_RESTART_WINDOW_MS = 10 * 60 * 1000;

/** Lines of a failed setup step's output shown in the error dialog. */
const ERROR_TAIL_LINES = 12;

// Utilities

/** Thrown when the user chooses to quit during setup: the app quits without an error dialog. */
class SetupAborted extends Error {}

/** The userData marker that records the first-launch tray-mode choice. */
function getTrayModeMarkerPath() {
  return path.join(app.getPath("userData"), "tray-mode");
}

/** True if the installer (a marker in resources/) or the first-launch question chose tray mode. */
function hasTrayModeMarker() {
  if (app.isPackaged && fs.existsSync(path.join(process.resourcesPath, "tray-mode"))) return true;
  return fs.existsSync(getTrayModeMarkerPath());
}

/** A Windows NSIS install, whose options page already asked about tray mode. */
function isInstallerManaged() {
  if (!isWindows || !app.isPackaged) return false;
  const exeName = path.basename(process.execPath, ".exe");
  return fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${exeName}.exe`));
}

function isDevelopmentMode() {
  return !app.isPackaged;
}

function getEnvironmentPath(devPath, prodPath) {
  return isDevelopmentMode() ? devPath : prodPath;
}

/** True when entries can be created in `dir`; fs.access(W_OK) ignores ACLs on Windows. */
function isWritable(dir) {
  try {
    fs.rmdirSync(fs.mkdtempSync(path.join(dir, ".write-test-")));
    return true;
  } catch {
    return false;
  }
}

let runtimeRoot = null;

/**
 * Where setup writes and the server runs (the frontend keeps workers/, models/, data/ beside
 * itself): the repo in development; packaged, resources/ when writable (zip, Windows installer),
 * else USER_RUNTIME_DIR.
 */
function getRuntimeRoot() {
  if (isDevelopmentMode()) return path.join(__dirname, "..");
  if (runtimeRoot === null) {
    if (isWritable(process.resourcesPath)) {
      runtimeRoot = process.resourcesPath;
    } else if (USER_RUNTIME_DIR) {
      runtimeRoot = USER_RUNTIME_DIR;
    } else {
      throw new Error(
        `${process.resourcesPath} is read-only and ${rawUserRuntimeDir} has a character the app ` +
          "cannot use in a path; install the app in a writable folder."
      );
    }
  }
  return runtimeRoot;
}

/**
 * For a read-only install, copies resources/ into USER_RUNTIME_DIR on the first launch and after
 * each update. Files the package does not ship (venvs, downloads, models, the database) are kept;
 * files an earlier version shipped and this one does not are deleted.
 */
async function syncRuntimeRoot() {
  if (isDevelopmentMode() || getRuntimeRoot() === process.resourcesPath) return;

  // original-fs: Electron's fs reports app.asar as a directory.
  const originalFs = require("original-fs");
  const asarStat = originalFs.statSync(path.join(process.resourcesPath, "app.asar"));
  const from = `${app.getVersion()} ${asarStat.mtimeMs}`;
  const manifestPath = path.join(USER_RUNTIME_DIR, SHIPPED_FILES_NAME);
  // The `{ from, files }` an earlier run recorded.
  let previous = null;
  try {
    const { from: previousFrom, files } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (typeof previousFrom === "string" && Array.isArray(files)) previous = { from: previousFrom, files };
  } catch {
    // First launch, or an interrupted copy: copy everything.
  }
  if (previous && previous.from === from) return;

  console.log(`${process.resourcesPath} is read-only; copying it to ${USER_RUNTIME_DIR}`);
  const entries = await originalFs.promises.readdir(process.resourcesPath, {
    withFileTypes: true,
    recursive: true,
  });
  const files = entries
    .filter((e) => !e.isDirectory())
    .map((e) => path.relative(process.resourcesPath, path.join(e.parentPath, e.name)))
    .filter((rel) => !INSTALL_ONLY_ENTRIES.has(rel.split(path.sep)[0]));

  // An interrupted earlier copy may have left read-only files that would block overwriting.
  if (fs.existsSync(USER_RUNTIME_DIR)) await makeOwnerWritable(USER_RUNTIME_DIR);
  if (previous) await removeDroppedFiles(previous.files, new Set(files));
  await fs.promises.cp(process.resourcesPath, USER_RUNTIME_DIR, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
    filter: (src) => !INSTALL_ONLY_ENTRIES.has(path.relative(process.resourcesPath, src)),
  });
  await makeOwnerWritable(USER_RUNTIME_DIR);
  // Written last, so an interrupted copy is redone on the next launch.
  fs.writeFileSync(manifestPath, JSON.stringify({ from, files }), "utf8");
}

/** Deletes the files of `previousFiles` not in `shipped` from USER_RUNTIME_DIR, then the folders that leaves empty. */
async function removeDroppedFiles(previousFiles, shipped) {
  for (const rel of previousFiles) {
    if (typeof rel !== "string" || shipped.has(rel)) continue;
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) continue;
    let cleanRel = "";
    for (const ch of rel) {
      let allowedChar = "";
      for (const allowed of PATH_CHARS) {
        if (allowed === ch) {
          allowedChar = allowed;
          break;
        }
      }
      if (!allowedChar) {
        cleanRel = "";
        break;
      }
      cleanRel += allowedChar;
    }
    if (!cleanRel) {
      console.warn(`Not removing ${rel}: unexpected characters in the path`);
      continue;
    }

    const target = path.join(USER_RUNTIME_DIR, cleanRel);
    try {
      await fs.promises.rm(target, { force: true });
    } catch (err) {
      console.warn(`Could not remove ${target}: ${err.message}`);
      continue;
    }
    for (let dir = path.dirname(target); dir.startsWith(USER_RUNTIME_DIR + path.sep); dir = path.dirname(dir)) {
      try {
        await fs.promises.rmdir(dir);
      } catch {
        break; // Not empty: setup or a service keeps files there.
      }
    }
  }
}

/** fs.cp keeps the source's modes, so a copy of read-only files (an AppImage mount) is read-only. */
async function makeOwnerWritable(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true, recursive: true });
  const paths = [dir, ...entries.filter((e) => !e.isSymbolicLink()).map((e) => path.join(e.parentPath, e.name))];
  for (const p of paths) {
    const { mode } = await fs.promises.stat(p);
    if (!(mode & 0o200)) await fs.promises.chmod(p, mode | 0o200);
  }
}

/** Rejects when something already listens on the server's address, rather than showing its page. */
function assertServerPortFree() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (err) => {
      if (err.code !== "EADDRINUSE") {
        reject(err);
        return;
      }
      reject(
        new Error(
          `Port ${SERVER_PORT} on ${SERVER_HOST} is already in use by another program, ` +
            "possibly another Edge AI Demo Studio (another install, or one started with " +
            "start.sh or npm run dev). Stop it, then choose Retry."
        )
      );
    });
    probe.listen(SERVER_PORT, SERVER_HOST, () => probe.close(() => resolve()));
  });
}

function ensureLogsDirectory() {
  const logDirPath = getEnvironmentPath(
    path.join(__dirname, "logs"),
    path.join(getRuntimeRoot(), "logs")
  );

  if (!fs.existsSync(logDirPath)) {
    fs.mkdirSync(logDirPath, { recursive: true });
  }

  return logDirPath;
}

/** Moves `file` to `<name>.previous<ext>`, so a restart keeps the log of the run that failed. */
function keepPreviousLog(file) {
  if (typeof file !== "string" || file.split(/[\\/]/).includes("..")) return;
  let cleanFile = "";
  for (const ch of file) {
    let allowedChar = "";
    for (const allowed of PATH_CHARS) {
      if (allowed === ch) {
        allowedChar = allowed;
        break;
      }
    }
    if (!allowedChar) {
      cleanFile = "";
      break;
    }
    cleanFile += allowedChar;
  }
  if (!cleanFile) {
    console.warn("Not keeping the previous log: unexpected characters in its path");
    return;
  }
  if (!fs.existsSync(cleanFile)) return;
  const { dir, name, ext } = path.parse(cleanFile);
  try {
    fs.renameSync(cleanFile, path.join(dir, `${name}.previous${ext}`));
  } catch (err) {
    // Then the new run appends to the old log, which loses nothing.
    console.warn(`Could not keep the previous ${path.basename(cleanFile)}: ${err.message}`);
  }
}

/**
 * Copies the main process's console output into logs/electron.log, which a packaged app (started
 * from a menu, not a terminal) would otherwise lose. The previous run's log is kept.
 */
function startMainLog() {
  let stream;
  try {
    const file = path.join(ensureLogsDirectory(), "electron.log");
    keepPreviousLog(file);
    stream = fs.createWriteStream(file, { flags: "a" });
  } catch (err) {
    console.error("Could not open electron.log:", err);
    return;
  }
  stream.on("error", (err) => process.stderr.write(`electron.log: ${err.message}\n`));
  for (const level of ["log", "info", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      stream.write(`${new Date().toISOString()} ${level.toUpperCase()} ${util.format(...args)}\n`);
    };
  }
}

function getLogsDirectory() {
  try {
    return ensureLogsDirectory();
  } catch (err) {
    console.error("Failed to create the logs folder:", err);
    return null;
  }
}

/** Opens the logs folder in the file manager. */
async function openLogsFolder() {
  const dir = getLogsDirectory();
  if (!dir) return;
  const failure = await shell.openPath(dir);
  if (failure) console.error(`Could not open ${dir}: ${failure}`);
}

function removeChildProcess(process) {
  const index = childProcesses.indexOf(process);
  if (index > -1) {
    childProcesses.splice(index, 1);
  }
}

/** Resolves once `url` answers 200; rejects after `timeout` ms (polled every `interval` ms). */
function waitForServer(url, timeout = SERVER_START_TIMEOUT_MS, interval = 500) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    async function check() {
      try {
        // A server that accepts but never answers would otherwise hold this check forever.
        const response = await fetch(new URL(url), { signal: AbortSignal.timeout(5000) });
        if (response.status === 200) {
          resolve();
        } else {
          retry();
        }
      } catch {
        retry();
      }
    }

    function retry() {
      if (Date.now() - start > timeout) {
        reject(
          new Error(`The server did not answer at ${url} within ${timeout / 1000} s (see frontend.log)`)
        );
      } else {
        setTimeout(check, interval);
      }
    }

    check();
  });
}

// Splash screen

async function createSplashScreen() {
  const splashFilePath = path.join(__dirname, "splash.html");
  const preloadPath = path.join(__dirname, "preload.js");

  const splash = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  splashWindow = splash;
  // Closing the splash quits the app (no other window yet); while setup runs, ask first.
  splash.on("close", (event) => {
    if (!setupRunning || isQuitting) return;
    // Answer the open dialog first (see openDialogs).
    if (openDialogs > 0) {
      event.preventDefault();
      return;
    }
    const { response } = showDialog(splash, {
      type: "warning",
      buttons: ["Continue setup", "Quit"],
      defaultId: 0,
      cancelId: 0,
      title: "Edge AI Demo Studio",
      message: "Setup is still running.",
      detail: "Quitting stops it; the next launch starts setup again.",
    });
    if (response === 0) event.preventDefault();
  });
  splash.on("closed", () => {
    if (splashWindow === splash) splashWindow = null;
  });

  await new Promise((resolve) => {
    splash.once("ready-to-show", resolve);
    splash.loadFile(splashFilePath);
  });

  return splash;
}

/** Sends a status line and a 0-100 progress value to the splash screen. */
function updateSplashProgress(splash, status, progress) {
  if (!splash || splash.isDestroyed()) return;
  splash.webContents.send("pip-progress", { status, progress });
}

/** Tells the splash screen that setup finished; `exitCode` 0 means success. */
function finalizeSplash(splash, exitCode = 0) {
  if (!splash || splash.isDestroyed()) return;
  splash.webContents.send("pip-done", exitCode);
}

function sendSplashLog(splash, line) {
  if (splash && !splash.isDestroyed()) {
    splash.webContents.send("pip-log", line);
  }
}

// Worker setup

function getWorkersPath() {
  return getEnvironmentPath(
    path.join(__dirname, "..", "workers"),
    path.join(getRuntimeRoot(), "workers")
  );
}

/** The workers root and each subdirectory that holds this platform's setup script. */
function getWorkerDirectories() {
  const workersPath = getWorkersPath();
  const setupFile = isWindows ? "setup.ps1" : "setup.sh";

  const workerDirs = [];
  if (fs.existsSync(path.join(workersPath, setupFile))) {
    workerDirs.push(workersPath);
  }
  workerDirs.push(
    ...fs
      .readdirSync(workersPath, { withFileTypes: true })
      .filter((dirent) => {
        if (!dirent.isDirectory()) return false;
        const dirPath = path.join(workersPath, dirent.name);
        return fs.existsSync(path.join(dirPath, setupFile));
      })
      .map((dirent) => path.join(workersPath, dirent.name))
  );
  return workerDirs;
}

/** Splash progress steps: thirdparty setup, then one per worker, spread from startProgress to 80. */
function createProgressSteps(workerDirs, startProgress = 0) {
  const initialSetupSteps = [
    {
      status: "Setting up thirdparty dependencies...",
      progress: startProgress,
    },
  ];

  const totalSteps = workerDirs.length + 1; // +1 for initial setup
  const totalRange = 80 - startProgress;
  return initialSetupSteps.concat(
    workerDirs.map((workerDir, index) => ({
      status: `Setting up ${path.basename(workerDir)}...`,
      progress: Math.round(startProgress + ((index + 1) / totalSteps) * totalRange),
    }))
  );
}

/**
 * Runs a setup script, logging to logs/<type>.log and passing each line to `onLog`. `type` defaults
 * to the script's directory name (workers, engines).
 */
function runSetupScript(scriptPath, cwd, onLog, scriptArgs = [], type = null) {
  const logDirPath = ensureLogsDirectory();
  const sanitizedScriptPath = fileURLToPath(new URL(`file://${scriptPath}`));

  let logName = "";
  for (const ch of type || path.basename(path.dirname(sanitizedScriptPath))) {
    let allowedChar = "";
    for (const allowed of PATH_CHARS) {
      if (allowed === ch) {
        allowedChar = allowed;
        break;
      }
    }
    if (!allowedChar) throw new Error("Invalid setup log name character");
    logName += allowedChar;
  }
  const logFilePath = path.join(logDirPath, `${logName}.log`);

  fs.writeFileSync(logFilePath, "", { flags: "w" });
  const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  return new Promise((resolve, reject) => {
    const command = isWindows ? "powershell.exe" : "/bin/bash";
    // Windows PowerShell's default policy on client editions is Restricted.
    const args = isWindows
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", sanitizedScriptPath, ...scriptArgs]
      : [sanitizedScriptPath, ...scriptArgs];

    const setupProcess = spawn(command, args, {
      cwd: new URL(`file://${cwd}`),
    });
    childProcesses.push(setupProcess);

    // Line by line, for live log streaming; the last lines go into the error if the step fails.
    const tail = [];
    const onLine = (line) => {
      logStream.write(line + "\n");
      if (line.trim()) {
        tail.push(line);
        if (tail.length > ERROR_TAIL_LINES) tail.shift();
      }
      if (onLog) onLog(line);
    };
    const rlOut = readline.createInterface({ input: setupProcess.stdout, crlfDelay: Infinity });
    const rlErr = readline.createInterface({ input: setupProcess.stderr, crlfDelay: Infinity });
    rlOut.on("line", onLine);
    rlErr.on("line", onLine);

    setupProcess.on("close", (code, signal) => {
      logStream.end();
      removeChildProcess(setupProcess);

      if (code === 0) {
        resolve();
      } else {
        const how = signal ? `was stopped by signal ${signal}` : `exited with code ${code}`;
        const err = new Error(`The ${logName} setup ${how} (see ${logName}.log).`);
        err.details = tail.join("\n");
        reject(err);
      }
    });

    setupProcess.on("error", (error) => {
      logStream.end();
      removeChildProcess(setupProcess);
      console.error(`Error running setup script in ${cwd}:`, error);
      reject(error);
    });
  });
}

/** Marker that lets later launches skip setup; under userData so it is writable wherever installed. */
function getSetupMarkerPath() {
  return path.join(app.getPath("userData"), ".setup-complete");
}

/**
 * The marker is per user but setup's output lives in this install's resources, so a new or moved
 * install (a fresh unzip, a Windows reinstall) has no bundled Node yet and must run setup again.
 */
function isSetupComplete() {
  return fs.existsSync(getSetupMarkerPath()) && fs.existsSync(getNodePath());
}

function markSetupComplete() {
  fs.writeFileSync(getSetupMarkerPath(), "installed\n", { encoding: "utf8" });
}

function getThirdpartyPath() {
  return getEnvironmentPath(
    path.join(__dirname, "../", "thirdparty"),
    path.join(getRuntimeRoot(), "thirdparty")
  );
}

function getNodePath() {
  return path.join(
    getThirdpartyPath(),
    "node",
    isWindows ? "node.exe" : "bin/node"
  );
}

async function setupThirdparty(onLog) {
  const thirdpartyPath = getThirdpartyPath();
  const scriptName = isWindows ? "setup_thirdparty.ps1" : "setup_thirdparty.sh";
  const scriptPath = getEnvironmentPath(
    path.join(__dirname, "..", "scripts",  isWindows?"win":"bash", scriptName),
    path.join(getRuntimeRoot(), "scripts", scriptName)
  );

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Thirdparty setup script not found: ${scriptPath}`);
  }

  return runSetupScript(scriptPath, path.dirname(scriptPath), onLog, [thirdpartyPath], "thirdparty");
}

/** Runs the thirdparty and per-worker setup scripts, reporting progress on the splash screen. */
async function setupWorkers(splash, startProgress = 0) {
  const onLog = (line) => sendSplashLog(splash, line);
  const workerDirs = getWorkerDirectories();

  const steps = createProgressSteps(workerDirs, startProgress);
  let progress = 0;

  updateSplashProgress(
    splash,
    steps[progress].status,
    steps[progress].progress
  );

  await setupThirdparty(onLog);
  updateSplashProgress(
    splash,
    steps[progress].status,
    steps[progress].progress
  );
  progress++;

  for (const workerDir of workerDirs) {
    const script = os.platform() === "win32" ? "setup.ps1" : "setup.sh";
    const setupScript = path.join(workerDir, script);

    console.log(`Running setup script for ${workerDir}: ${setupScript}`);

    if (fs.existsSync(setupScript)) {
      updateSplashProgress(
        splash,
        steps[progress].status,
        steps[progress].progress
      );

      // As in the root setup: the workers root also syncs the shared workers/.venv, which the
      // device queries (worker_common, services/helper) run from.
      const scriptArgs =
        workerDir === getWorkersPath() ? [isWindows ? "-SetupWorkers" : "--setup-workers"] : [];
      await runSetupScript(setupScript, workerDir, onLog, scriptArgs);

      progress++;
    }
  }

  updateSplashProgress(splash, "Finalizing installation...", 90);
}

// llama.cpp backend selection

/**
 * Message boxes open now. A sync dialog's nested loop still delivers window events, so closing the
 * splash under one would nest a second dialog, and Node's loop stalls until the first returns.
 */
let openDialogs = 0;

/**
 * Modal dialog parented to the splash window if any; returns `{ response }`. Synchronous because
 * before Electron 43.7.6 the async showMessageBox promise on Linux could settle without running its
 * continuation until another main-process event arrived, stalling setup when no window had focus.
 */
function showDialog(parent, options) {
  openDialogs++;
  try {
    const response =
      parent && !parent.isDestroyed()
        ? dialog.showMessageBoxSync(parent, options)
        : dialog.showMessageBoxSync(options);
    return { response };
  } finally {
    openDialogs--;
  }
}

/** The repo root in development, the runtime root (see getRuntimeRoot) when packaged. */
function getProjectRoot() {
  return getEnvironmentPath(path.join(__dirname, ".."), getRuntimeRoot());
}

/** The multiserve engine's directory, which owns the llama.cpp backend selection. */
function getMultiserveDir() {
  return path.join(getProjectRoot(), "workers", "engines", "multiserve");
}

function getBackendConfigPath() {
  return path.join(getMultiserveDir(), ".llamacpp-backend");
}

/** The persisted backend: "sycl", "vulkan", or null when none is selected yet. */
function readSelectedBackend() {
  const configPath = getBackendConfigPath();
  if (!fs.existsSync(configPath)) return null;
  const match = fs
    .readFileSync(configPath, "utf8")
    .match(/^LLAMACPP_BACKEND=(sycl|vulkan)\s*$/m);
  return match ? match[1] : null;
}

/** Persists the selection in setup.sh's format, so the two entry points stay interchangeable. */
function writeSelectedBackend(backend) {
  const lines = [
    "# Generated by Edge AI Demo Studio - selects the llama.cpp build used by",
    "# the multiserve engine.",
    `LLAMACPP_BACKEND=${backend}`,
  ];
  // No precision line, so the helper's lb_detect_sycl_precision default applies.
  fs.writeFileSync(getBackendConfigPath(), lines.join("\n") + "\n", "utf8");
}

/** Outcomes of runInstaller(). */
const InstallerResult = Object.freeze({
  /** The dependency installer ran to completion just now. */
  INSTALLED: "installed",
  /** Nothing to do: the dependencies were installed on an earlier launch. */
  ALREADY_INSTALLED: "already-installed",
  /** No installer to run (Windows, or the script is missing from the build). */
  UNAVAILABLE: "unavailable",
  /** The user declined the system dependency install. */
  CANCELED: "canceled",
  FAILED: "failed",
});

/**
 * Asks which llama.cpp backend to use, `current` as the default. Linux only: the SYCL release
 * binaries are Ubuntu builds, and Windows packaging assumes Vulkan.
 */
async function promptForBackend(splash, current) {
  if (isWindows) return "vulkan";

  const buttons = ["Intel SYCL", "Vulkan"];

  const defaultId = current === "sycl" ? 0 : 1;

  const detail = [
    "SYCL runs llama.cpp on the Intel SYCL runtime and gives the best",
    "performance on Intel Arc and Xe GPUs. Its runtime libraries (about",
    "0.3 GB) are installed during setup; no extra toolkit is needed.",
    "",
    "Vulkan needs nothing extra and works on any Vulkan-capable GPU.",
    "",
    "You can change this later by relaunching with --reconfigure.",
  ].join("\n");

  const { response } = showDialog(splash, {
    type: "question",
    buttons,
    defaultId,
    cancelId: defaultId,
    title: "Choose the LLM acceleration backend",
    message: "Which backend should the LLM engine use?",
    detail,
  });

  return response === 0 ? "sycl" : "vulkan";
}

/** Persists the choice; nothing is installed up front (multiserve setup installs SYCL's runtime). */
function finalizeBackend(chosen) {
  if (isWindows) return "vulkan";

  try {
    writeSelectedBackend(chosen);
  } catch (err) {
    console.error("Failed to persist the backend selection:", err);
  }

  return chosen;
}

// Tray mode selection

/**
 * Asks whether to run in the background (tray icon, start at login) or as a plain window, `trayMode`
 * as the default. Skipped for a Windows installer install, whose options page asked already.
 */
function promptForTrayMode(splash) {
  if (isInstallerManaged()) return trayMode;

  const defaultId = trayMode ? 1 : 0;
  const detail = [
    "In the background, the studio keeps a tray icon, keeps running after its",
    "window is closed, and starts hidden when you sign in. Open the window",
    "again from the tray icon or its menu.",
    "",
    "As a window, closing the window quits the studio.",
    "",
    "You can change this later by relaunching with --reconfigure.",
  ].join("\n");

  const { response } = showDialog(splash, {
    type: "question",
    buttons: ["Open as a window", "Run in the background"],
    defaultId,
    cancelId: defaultId,
    title: "Choose how the studio runs",
    message: "Run Edge AI Demo Studio in the background?",
    detail,
  });

  return response === 1;
}

/** Persists the tray-mode choice right away, so a retry after a failed setup offers it as the default. */
function saveTrayModeChoice(enabled) {
  if (isInstallerManaged()) return;
  try {
    if (enabled) {
      fs.mkdirSync(path.dirname(getTrayModeMarkerPath()), { recursive: true });
      fs.writeFileSync(getTrayModeMarkerPath(), "enabled\n", "utf8");
    } else {
      fs.rmSync(getTrayModeMarkerPath(), { force: true });
    }
  } catch (err) {
    console.error("Failed to save the tray-mode choice:", err);
  }
}

/** After setup: turns the chosen mode on, starting at login with it like the installer's checkbox. */
function applyTrayMode(enabled) {
  if (isInstallerManaged()) return;
  trayMode = enabled;
  try {
    setStartAtLogin(enabled);
  } catch (err) {
    console.error("Failed to update start at login:", err);
  }
}

/** sudo-prompt's errors when it got no root: the prompt was dismissed or the password refused. */
const SUDO_NOT_GRANTED = "User did not grant permission.";
/** ...and when it has no graphical password prompt to show (no polkit agent, no pkexec). */
const SUDO_NO_PROMPT = ["No polkit authentication agent found.", "Unable to find pkexec or kdesudo."];

/**
 * Asks what to do after the system dependency install failed: Retry, Continue without them (the
 * services that need them fail later), or Quit (throws SetupAborted). Returns true for Retry.
 */
function promptAfterInstallerFailure(splash, err, installerPath, logFile) {
  const manual = `sudo bash "${installerPath}" -y`;
  let detail;
  if (err.message === SUDO_NOT_GRANTED) {
    detail = "The password prompt was dismissed, or the password was not accepted.";
  } else if (SUDO_NO_PROMPT.includes(err.message)) {
    detail =
      "This desktop has no graphical password prompt (polkit agent). Run this in a terminal, " +
      `then choose Retry or Continue:\n\n${manual}`;
  } else {
    detail = `The installer failed: ${err.message.split("\n")[0]}`;
    if (err.details) detail += `\n\nLast output:\n${err.details}`;
    detail += `\n\nThe full output is in ${logFile}. To run it yourself:\n${manual}`;
  }

  const { response } = showDialog(splash, {
    type: "error",
    buttons: ["Retry", "Continue without them", "Quit"],
    defaultId: 0,
    cancelId: 1,
    title: "Install system dependencies",
    message: "The system dependencies were not installed.",
    detail,
  });
  if (response === 2) throw new SetupAborted("Quit after the system dependency install failed");
  return response === 0;
}

/** Runs install_dependencies.sh as root through sudo-prompt's GUI password dialog (not on Windows). */
async function runInstaller(splash) {
  if (isWindows) return InstallerResult.UNAVAILABLE;

  const projectRoot = getProjectRoot();
  const installerPath = path.join(projectRoot, "scripts", "install_dependencies.sh");
  const installMarker = fileURLToPath(
    new URL(`file://${path.join(app.getPath("userData"), ".installed")}`)
  );

  updateSplashProgress(splash, "Checking system dependencies...", 0);

  if (!fs.existsSync(installerPath)) {
    console.log(`Installer not found at ${installerPath}, skipping.`);
    return InstallerResult.UNAVAILABLE;
  }

  if (fs.existsSync(installMarker)) {
    console.log("Installer already run (marker present), skipping.");
    return InstallerResult.ALREADY_INSTALLED;
  }

  const confirm = showDialog(splash, {
    type: "question",
    buttons: ["Install", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    title: "Install system dependencies",
    message: "This application needs to install system dependencies.",
    detail: "You will be prompted for your administrator password.",
  });

  if (confirm.response !== 0) {
    console.log("User canceled installer.");
    return InstallerResult.CANCELED;
  }

  const sudoPrompt = require("@vscode/sudo-prompt");
  const escapedPath = installerPath.replace(/"/g, '\\"');
  const logDir = getLogsDirectory();
  const logFile = logDir ? path.join(logDir, "system-dependencies.log") : null;

  for (;;) {
    // sudo-prompt returns the output only at the end, so the splash cannot stream it.
    updateSplashProgress(splash, "Installing system dependencies (this can take several minutes)...", 5);
    try {
      await new Promise((resolve, reject) => {
        sudoPrompt.exec(`/bin/bash "${escapedPath}" -y`, { name: "Edge AI Demo Studio" }, (err, stdout, stderr) => {
          const output = `${stdout || ""}${stderr || ""}`;
          if (logFile) {
            try {
              fs.writeFileSync(logFile, output, "utf8");
            } catch (logErr) {
              console.error(`Could not write ${logFile}:`, logErr);
            }
          }
          if (err) {
            const lines = output.split("\n").filter((line) => line.trim());
            err.details = lines.slice(-ERROR_TAIL_LINES).join("\n");
            reject(err);
          } else {
            resolve();
          }
        });
      });

      fs.writeFileSync(installMarker, "installed\n", { encoding: "utf8" });
      updateSplashProgress(splash, "System dependencies installed.", 15);
      return InstallerResult.INSTALLED;
    } catch (err) {
      console.error("Installer failed:", err);
      if (!promptAfterInstallerFailure(splash, err, installerPath, logFile || "the logs folder")) {
        return InstallerResult.FAILED;
      }
    }
  }
}

// Next.js server

function getFrontendPath() {
  return getEnvironmentPath(
    path.join(__dirname, "..", "frontend", ".next", "standalone"),
    path.join(getRuntimeRoot(), "frontend")
  );
}

/**
 * Dev only: copies frontend/.next/static into .next/standalone, which Next.js leaves without the
 * compiled CSS/JS (the package scripts do this for packaged builds), so the page is not unstyled.
 */
function syncDevStaticAssets() {
  if (!isDevelopmentMode()) return;

  const nextDir = path.join(__dirname, "..", "frontend", ".next");
  const source = path.join(nextDir, "static");
  const target = path.join(getFrontendPath(), ".next", "static");

  if (!fs.existsSync(source)) {
    console.warn(`No static assets at ${source}; run the frontend build first.`);
    return;
  }

  fs.cpSync(source, target, { recursive: true, force: true });
  console.log(`Synced static assets to ${target}`);
}

/**
 * deployment.json from resources/ (packaged) or the project root (dev); a DEPLOYMENT_CONFIG_PATH
 * that names an existing .json file overrides it.
 */
function getDeploymentConfigPath() {
  const defaultPath = getEnvironmentPath(
    path.join(__dirname, "..", "deployment.json"),
    path.join(getRuntimeRoot(), "deployment.json")
  );

  const override = process.env.DEPLOYMENT_CONFIG_PATH;
  if (!override) {
    return defaultPath;
  }

  const resolvedOverride = fileURLToPath(new URL(`file://${path.resolve(override)}`));
  const isValid =
    path.extname(resolvedOverride).toLowerCase() === ".json" &&
    fs.existsSync(resolvedOverride) &&
    fs.statSync(resolvedOverride).isFile();

  if (!isValid) {
    console.error(
      `Ignoring invalid DEPLOYMENT_CONFIG_PATH "${override}": file does not exist or is not a .json file.`
    );
    return defaultPath;
  }

  return resolvedOverride;
}

/** Starts the Next.js server. The returned promise only rejects: when the server fails or exits. */
function startNextServer() {
  const frontendPath = getFrontendPath();
  const logDirPath = ensureLogsDirectory();
  syncDevStaticAssets();
  const logFilePath = path.join(logDirPath, "frontend.log");

  keepPreviousLog(logFilePath);
  const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  const nodePath = getNodePath();
  const serverProcess = spawn(nodePath, ["server.js"], {
    cwd: frontendPath,
    stdio: "pipe",
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      HOSTNAME: SERVER_HOST,
      NEXT_MANUAL_SIG_HANDLE: "true",
      DEPLOYMENT_CONFIG_PATH: getDeploymentConfigPath(),
    },
  });

  childProcesses.push(serverProcess);

  serverProcess.stdout.on("data", (data) => logStream.write(data));
  serverProcess.stderr.on("data", (data) => logStream.write(data));

  serverProcess.on("exit", (code, signal) => {
    logStream.end();
    console.log(`Next.js server exited with code ${code}, signal ${signal}`);
    removeChildProcess(serverProcess);
    if (runningServer === serverProcess) {
      runningServer = null;
      if (!isQuitting) {
        onServerStopped(code, signal).catch((err) => console.error("Server restart failed:", err));
      }
    }
  });

  // Callers attach .catch(() => {}) so an exit after startup is not an unhandled rejection.
  const failure = new Promise((_, reject) => {
    serverProcess.once("error", (err) => {
      reject(new Error(`Failed to start Next.js server: ${err.message}`));
    });
    serverProcess.once("exit", (code, signal) => {
      reject(
        new Error(
          signal
            ? `Next.js server was terminated by signal ${signal} (see frontend.log)`
            : `Next.js server exited with code ${code} (see frontend.log)`
        )
      );
    });
  });
  return { serverProcess, failure };
}

/** The server once it has answered; an exit after that is a crash, restarted by onServerStopped. */
let runningServer = null;
/** Times of recent automatic restarts, for SERVER_RESTART_LIMIT. */
const serverRestarts = [];

/** Starts the server and resolves once it answers; rejects if it exits or does not answer in time. */
async function startServerAndWait() {
  await assertServerPortFree();
  const { serverProcess, failure } = startNextServer();
  failure.catch(() => {});
  try {
    await Promise.race([waitForServer(APP_URL), failure]);
  } catch (err) {
    // Timed out: stop it, so a later retry finds the port free.
    if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
      await killChildProcessTree(serverProcess);
    }
    throw err;
  }
  runningServer = serverProcess;
}

/**
 * The server stopped after it had started: restart it, and reload the window once it answers.
 * After SERVER_RESTART_LIMIT restarts within SERVER_RESTART_WINDOW_MS, ask instead.
 */
async function onServerStopped(code, signal) {
  const reason = signal ? `was terminated by signal ${signal}` : `exited with code ${code}`;
  console.error(`The server ${reason} unexpectedly.`);
  updateTrayMenu();

  const now = Date.now();
  while (serverRestarts.length && now - serverRestarts[0] > SERVER_RESTART_WINDOW_MS) {
    serverRestarts.shift();
  }
  if (serverRestarts.length >= SERVER_RESTART_LIMIT) {
    const minutes = SERVER_RESTART_WINDOW_MS / 60000;
    // Over the window when it is up; a tray-only app has none to attach to.
    const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null;
    for (;;) {
      const { response } = showDialog(parent, {
        type: "error",
        buttons: ["Restart", "Open logs folder", "Quit"],
        defaultId: 0,
        cancelId: 2,
        title: "Edge AI Demo Studio",
        message: "The Edge AI Demo Studio server keeps stopping.",
        detail:
          `It has stopped ${SERVER_RESTART_LIMIT + 1} times within ${minutes} minutes; the last ` +
          `time it ${reason}. frontend.log and frontend.previous.log in the logs folder show why.`,
      });
      if (response === 1) {
        await openLogsFolder();
        continue;
      }
      if (response === 2) {
        app.quit();
        return;
      }
      break;
    }
    serverRestarts.length = 0;
  }
  serverRestarts.push(now);

  console.log("Restarting the server...");
  try {
    await startServerAndWait();
  } catch (err) {
    const failure = new Error(`The server stopped (it ${reason}) and could not be restarted: ${err.message}`);
    failure.details = err.details;
    await showErrorAndQuit(null, failure);
    return;
  }
  console.log("Server restarted.");
  updateTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
}

// Main window

/** True for a page of the studio itself, which stays in the app's windows. */
function isAppUrl(url) {
  try {
    return new URL(url).origin === new URL(APP_URL).origin;
  } catch {
    return false;
  }
}

/** Opens a web link in the default browser; other schemes are dropped. */
function openExternally(url) {
  if (!/^https?:\/\//i.test(url)) {
    console.warn(`Not opening ${url}: not a web link`);
    return;
  }
  shell.openExternal(url).catch((err) => console.error(`Could not open ${url}:`, err));
}

/**
 * Studio pages and about:blank (the exam-marking print preview writes into one) open in the app;
 * other links (Hugging Face, docs, a sample suite's own UI) open in the default browser, which has
 * the address bar and history an app window lacks.
 */
function routeLinks(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || isAppUrl(url)) return { action: "allow" };
    openExternally(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternally(url);
  });
}

let hiddenToTrayNotified = false;

/** Once per run, says where the window went when closing it only hid it. */
function notifyHiddenToTray() {
  if (hiddenToTrayNotified || !Notification.isSupported()) return;
  hiddenToTrayNotified = true;
  new Notification({
    title: "Edge AI Demo Studio is still running",
    body: "Its services keep running. Open it again or quit from the tray icon.",
  }).show();
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
  });

  // With a tray icon the window close button hides the window; the server
  // and workers keep running in the background. Quit lives in the tray menu.
  mainWindow.on("close", (event) => {
    if (tray && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      notifyHiddenToTray();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  routeLinks(mainWindow.webContents);
  // Windows the studio opens (window.open of its own pages) follow the same rules.
  mainWindow.webContents.on("did-create-window", (child) => routeLinks(child.webContents));

  // A crashed or killed renderer leaves a blank window; reload it, but not in a crash loop.
  let lastRendererReload = 0;
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`The window's renderer is gone (${details.reason}, exit code ${details.exitCode})`);
    if (details.reason === "clean-exit" || !mainWindow || mainWindow.isDestroyed()) return;
    if (Date.now() - lastRendererReload < 10000) return;
    lastRendererReload = Date.now();
    mainWindow.webContents.reload();
  });

  mainWindow.loadURL(url);

  return mainWindow;
}

/** Brings the main window to the front, creating it if it does not exist yet. */
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow(APP_URL);
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  return mainWindow;
}

// Start at login

/** The XDG autostart entry used on Linux, where Electron has no login-item API. */
function getLinuxAutostartPath() {
  const configHome =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "autostart", "edge-ai-demo-studio.desktop");
}

/** What the login item launches: the app binary, or the AppImage file when run as one. */
function getLaunchExecutable() {
  return process.env.APPIMAGE || process.execPath;
}

/** Installed builds only: in development `process.execPath` is the bare Electron binary. */
function canStartAtLogin() {
  return app.isPackaged;
}

function getStartAtLogin() {
  if (!canStartAtLogin()) return false;
  if (isWindows || isMac) {
    const settings = app.getLoginItemSettings({ args: LOGIN_ITEM_ARGS });
    // executableWillLaunchAtLogin also covers a Run entry written by the
    // installer, whose path casing may differ from process.execPath.
    return Boolean(settings.openAtLogin || settings.executableWillLaunchAtLogin);
  }
  return fs.existsSync(getLinuxAutostartPath());
}

/**
 * Registers or removes the login item: an HKCU Run value on Windows, a login item on macOS, an XDG
 * autostart .desktop file on Linux.
 */
function setStartAtLogin(enabled) {
  if (!canStartAtLogin()) return;

  if (isWindows || isMac) {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: getLaunchExecutable(),
      args: LOGIN_ITEM_ARGS,
    });
    return;
  }

  const rawDesktopFile = getLinuxAutostartPath();
  if (
    !path.isAbsolute(rawDesktopFile) ||
    !rawDesktopFile.endsWith(path.join("autostart", "edge-ai-demo-studio.desktop"))
  ) {
    throw new Error("Invalid autostart path");
  }
  let desktopFile = "";
  for (const ch of rawDesktopFile) {
    let allowedChar = "";
    for (const allowed of PATH_CHARS) {
      if (allowed === ch) {
        allowedChar = allowed;
        break;
      }
    }
    if (!allowedChar) throw new Error("Invalid autostart path character");
    desktopFile += allowedChar;
  }
  if (!enabled) {
    fs.rmSync(desktopFile, { force: true });
    return;
  }
  const exec = getLaunchExecutable().replace(/"/g, '\\"');
  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Edge AI Demo Studio",
    "Comment=Start Edge AI Demo Studio in the background at login",
    `Exec="${exec}" ${LOGIN_ITEM_ARGS.join(" ")}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(desktopFile), { recursive: true });
  fs.writeFileSync(desktopFile, entry, { encoding: "utf8" });
}

// Menu entry

/**
 * An AppImage has no installer, so each launch writes the menu entry and icon under $XDG_DATA_HOME,
 * or rewrites them when the AppImage has moved. TryExec hides the entry once the AppImage is deleted.
 */
function installAppImageMenuEntry() {
  const appImage = process.env.APPIMAGE;
  if (!app.isPackaged || !appImage || isWindows || isMac) return;
  if (/[\x00-\x1f]/.test(appImage)) throw new Error("Invalid AppImage path");

  const rawDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  if (!path.isAbsolute(rawDataHome)) throw new Error("Invalid XDG_DATA_HOME");
  let dataHome = "";
  for (const ch of rawDataHome) {
    let allowedChar = "";
    for (const allowed of PATH_CHARS) {
      if (allowed === ch) {
        allowedChar = allowed;
        break;
      }
    }
    if (!allowedChar) throw new Error("Invalid menu entry path character");
    dataHome += allowedChar;
  }
  const iconFile = path.join(dataHome, "icons", "hicolor", "512x512", "apps", "edge-ai-demo-studio.png");
  const desktopFile = path.join(dataHome, "applications", "edge-ai-demo-studio.desktop");

  const icon = fs.readFileSync(path.join(__dirname, "assets", "logo.png"));
  if (!fs.existsSync(iconFile) || !fs.readFileSync(iconFile).equals(icon)) {
    fs.mkdirSync(path.dirname(iconFile), { recursive: true });
    fs.writeFileSync(iconFile, icon);
  }

  // Desktop Entry escaping: \ " ` $ take a backslash inside a quoted Exec argument, then every \ is
  // doubled as in any string value; a literal % in Exec is %%.
  const escapeString = (s) => s.replace(/\\/g, "\\\\");
  const execArg = `"${appImage.replace(/[\\"`$]/g, "\\$&")}"`.replace(/%/g, "%%");
  const entry = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Edge AI Demo Studio",
    `Exec=${escapeString(execArg)} %U`,
    `TryExec=${escapeString(appImage)}`,
    `Icon=${escapeString(iconFile)}`,
    "Terminal=false",
    "StartupWMClass=edge-ai-demo-studio", // The WM_CLASS Electron gives its windows (package.json name)
    "Categories=Development;",
    "",
  ].join("\n");
  if (fs.existsSync(desktopFile) && fs.readFileSync(desktopFile, "utf8") === entry) return;
  fs.mkdirSync(path.dirname(desktopFile), { recursive: true });
  fs.writeFileSync(desktopFile, entry, { encoding: "utf8" });
}

// Tray

/** (Re)builds the tray menu after every toggle: Linux only shows changes on a new setContextMenu. */
function updateTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: runningServer ? `Running at ${APP_URL}` : "Server restarting...",
      enabled: false,
    },
    { type: "separator" },
    { label: "Open Edge AI Demo Studio", click: () => showMainWindow() },
    { label: "Open in browser", click: () => openExternally(APP_URL) },
    { label: "Open logs folder", click: () => openLogsFolder() },
    { type: "separator" },
    {
      label: "Start at login",
      type: "checkbox",
      enabled: canStartAtLogin(),
      checked: getStartAtLogin(),
      click: (item) => {
        try {
          setStartAtLogin(item.checked);
        } catch (err) {
          console.error("Failed to update start at login:", err);
        }
        updateTrayMenu();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

/** Creates the tray icon; once it exists, closing the main window hides it instead of quitting. */
function createTray() {
  if (tray) return tray;

  const iconPath = path.join(
    __dirname,
    "assets",
    isWindows ? "logo.ico" : "logo.png"
  );
  let icon = nativeImage.createFromPath(iconPath);
  if (!isWindows && !icon.isEmpty()) {
    icon = icon.resize({ width: 22, height: 22 });
  }

  tray = new Tray(icon);
  tray.setToolTip("Edge AI Demo Studio");
  updateTrayMenu();

  // Left click opens the window on Windows and macOS. On Linux the click
  // event is not reliably delivered, so the context menu carries everything.
  tray.on("click", () => showMainWindow());
  tray.on("double-click", () => showMainWindow());

  return tray;
}

// Process cleanup

/** SIGTERMs a process tree, then SIGKILLs it after SIGTERM_GRACE_MS if it is still alive. */
function killChildProcessTree(child) {
  return new Promise((resolve) => {
    if (!child || !child.pid || child.killed) {
      resolve();
      return;
    }

    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    child.once("exit", done);

    treeKill(child.pid, "SIGTERM", (err) => {
      if (err) {
        console.error(`Failed to SIGTERM process tree ${child.pid}:`, err);
        done();
      }
    });

    setTimeout(() => {
      if (resolved) return;
      treeKill(child.pid, "SIGKILL", (killErr) => {
        if (killErr) {
          console.error(`Failed to SIGKILL process tree ${child.pid}:`, killErr);
        }
        done();
      });
    }, SIGTERM_GRACE_MS);
  });
}

/** Kills every tracked child process tree. Idempotent: repeated calls share one promise. */
function cleanupChildProcesses() {
  if (cleanupPromise) return cleanupPromise;

  console.log("Cleaning up child processes...");
  cleanupPromise = Promise.all(
    childProcesses
      .filter((child) => child && child.pid && !child.killed)
      .map((child) => {
        console.log(`Terminating process ${child.pid}`);
        return killChildProcessTree(child);
      })
  );

  return cleanupPromise;
}

// Error handling

/**
 * Shows an error dialog (with the failing step's last output, if any) offering Retry, which
 * relaunches the app, Open logs folder, and Quit; then quits. `splash` may be null.
 */
async function showErrorAndQuit(splash, err) {
  // Quitting already (a signal, the splash closed during setup): the error is its consequence.
  if (isQuitting) return;
  isQuitting = true;
  console.error("Failed to start application:", err);

  // A read-only install cannot create the logs folder either; the dialog must still show.
  const logsDir = getLogsDirectory();
  const logHint = logsDir
    ? `The logs are in ${logsDir}`
    : "The logs folder could not be created.";

  finalizeSplash(splash, 1);

  let detail = err.message || String(err);
  if (err.details) detail += `\n\nLast output:\n${err.details}`;
  detail += `\n\n${logHint}`;

  const buttons = logsDir ? ["Quit", "Retry", "Open logs folder"] : ["Quit", "Retry"];
  let response;
  do {
    ({ response } = showDialog(null, {
      type: "error",
      buttons,
      defaultId: 0,
      cancelId: 0,
      title: "Edge AI Demo Studio",
      message: "Edge AI Demo Studio could not start.",
      detail,
    }));
    if (response === 2) await openLogsFolder();
  } while (response === 2);

  await cleanupChildProcesses();
  if (response === 1) {
    // The AppImage file, not the binary inside its mount, which goes away when this one exits.
    app.relaunch({ execPath: getLaunchExecutable(), args: process.argv.slice(1) });
  }
  app.quit();
}

// Event handlers and startup

// Signals go through app.quit() so will-quit runs the async teardown ('exit' can't run async code).
process.on("SIGINT", () => {
  console.log("SIGINT received. Cleaning up child processes...");
  app.quit();
});
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Cleaning up child processes...");
  app.quit();
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  if (app.isReady() && !isQuitting) {
    dialog.showErrorBox(
      "Edge AI Demo Studio",
      `Edge AI Demo Studio hit an unexpected error and will close.\n\n${error.stack || error}`
    );
  }
  isQuitting = true;
  cleanupChildProcesses().then(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

// will-quit fires just before the process exits; preventDefault() holds it until cleanup is done.
// app.exit, not app.quit: after SIGTERM/SIGINT a second app.quit() never finishes, leaving a
// windowless process that holds the single-instance lock.
app.on("will-quit", (event) => {
  if (cleanupPromise) return; // cleanup already in progress or complete
  event.preventDefault();
  cleanupChildProcesses().then(() => app.exit(0));
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // With a tray icon the app keeps running after its last window closes.
  if (!tray && !isMac) {
    app.quit();
  }
});

app.on("activate", () => {
  // macOS dock click with no window open
  if (tray && BrowserWindow.getAllWindows().length === 0) {
    showMainWindow();
  }
});

// Only one instance may run: a second one would fail to bind the server port.
// Launching the app again while it sits in the tray brings the window up.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (tray || mainWindow) {
      showMainWindow();
    } else if (splashWindow && !splashWindow.isDestroyed()) {
      // Still setting up or starting: bring the splash up instead.
      if (splashWindow.isMinimized()) splashWindow.restore();
      splashWindow.show();
      splashWindow.focus();
    }
  });
}

if (isWindows) {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

/** Shows the main window, closing `splash` once the page has loaded (or failed to). */
function openMainWindow(splash) {
  const window = showMainWindow();
  if (!splash || splash.isDestroyed()) return;
  const closeSplash = () => {
    if (!splash.isDestroyed()) splash.close();
  };
  window.webContents.once("did-finish-load", closeSplash);
  window.webContents.once("did-fail-load", closeSplash);
}

/** In tray mode, creates the tray icon and refreshes the Linux autostart entry. */
function startTray() {
  if (!trayMode) return;
  createTray();
  // The entry's Exec goes stale when the AppImage moves, or when an older version wrote it.
  if (!isWindows && !isMac && getStartAtLogin()) {
    try {
      setStartAtLogin(true);
    } catch (err) {
      console.warn("Could not refresh the autostart entry:", err);
    }
  }
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;

  startMainLog();
  console.log(
    `Edge AI Demo Studio ${app.getVersion()} (Electron ${process.versions.electron}) ` +
      `starting, args: ${process.argv.slice(1).join(" ") || "(none)"}`
  );

  Menu.setApplicationMenu(null);

  // --reconfigure re-runs setup, e.g. to change the llama.cpp backend after the first launch.
  const reconfigure = process.argv.includes("--reconfigure");

  try {
    installAppImageMenuEntry();
  } catch (err) {
    console.warn("Could not write the menu entry:", err);
  }

  try {
    await syncRuntimeRoot();
  } catch (err) {
    console.error(`Failed to prepare ${rawUserRuntimeDir}:`, err);
    await showErrorAndQuit(null, err);
    return;
  }

  let splash = null;

  if (isSetupComplete() && !reconfigure) {
    console.log("Setup already complete, skipping setup.");
    try {
      // Something to look at while the server starts; a --hidden start shows nothing until it is up.
      if (!startHidden) {
        splash = await createSplashScreen();
        updateSplashProgress(splash, "Starting Edge AI Demo Studio...", 90);
      }
      await startServerAndWait();
      startTray();
      if (!startHidden) openMainWindow(splash);
    } catch (err) {
      await showErrorAndQuit(splash, err);
    }
    return;
  }

  // First run or --reconfigure: the full setup behind the splash screen.
  try {
    splash = await createSplashScreen();
    setupRunning = true;

    // Ask before installing anything, so the rest of the setup runs unattended.
    const chosenBackend = await promptForBackend(splash, readSelectedBackend());
    const chosenTrayMode = promptForTrayMode(splash);
    saveTrayModeChoice(chosenTrayMode);
    const installerResult = await runInstaller(splash);
    const backend = finalizeBackend(chosenBackend);
    console.log(`llama.cpp backend: ${backend}, system dependencies: ${installerResult}`);

    const installerRan = installerResult === InstallerResult.INSTALLED;
    await setupWorkers(splash, installerRan ? 15 : 0);

    markSetupComplete();
    setupRunning = false;
    applyTrayMode(chosenTrayMode);

    updateSplashProgress(splash, "Setup complete. Starting Edge AI Demo Studio...", 95);
    await startServerAndWait();
    startTray();
    openMainWindow(splash);
  } catch (err) {
    setupRunning = false;
    if (err instanceof SetupAborted) {
      console.log(err.message);
      app.quit();
      return;
    }
    await showErrorAndQuit(splash, err);
  }
});
