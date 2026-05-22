// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// ===================================
// DEPENDENCIES AND IMPORTS
// ===================================
const { app, BrowserWindow, Menu, dialog } = require("electron");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { fileURLToPath } = require("url");
const fs = require("fs");
const treeKill = require("tree-kill");
const readline = require("readline");

// ===================================
// GLOBAL VARIABLES
// ===================================
const childProcesses = []; // Array to track spawned processes
const isWindows = os.platform() === "win32";
let cleanupPromise = null; // Track cleanup to avoid duplicate cleanup runs

/** Grace period (ms) between SIGTERM and SIGKILL when stopping a process tree. */
const SIGTERM_GRACE_MS = 5000;

// ===================================
// UTILITY FUNCTIONS
// ===================================

/**
 * Determines if the app is running in development mode
 * @returns {boolean} True if in development mode
 */
function isDevelopmentMode() {
  return !app.isPackaged;
}

/**
 * Gets the appropriate path based on development or production mode
 * @param {string} devPath - Path for development mode
 * @param {string} prodPath - Path for production mode
 * @returns {string} The appropriate path
 */
function getEnvironmentPath(devPath, prodPath) {
  return isDevelopmentMode() ? devPath : prodPath;
}

/**
 * Ensures the logs directory exists and returns its path
 * @returns {string} The logs directory path
 */
function ensureLogsDirectory() {
  const logDirPath = getEnvironmentPath(
    path.join(__dirname, "logs"),
    path.join(process.resourcesPath, "logs")
  );

  if (!fs.existsSync(logDirPath)) {
    fs.mkdirSync(logDirPath, { recursive: true });
  }

  console.log(`Logs directory ensured at: ${logDirPath}`);
  return logDirPath;
}

/**
 * Removes a child process from the tracking array
 * @param {ChildProcess} process - The process to remove
 */
function removeChildProcess(process) {
  const index = childProcesses.indexOf(process);
  if (index > -1) {
    childProcesses.splice(index, 1);
  }
}

/**
 * Waits for a server to become available at the specified URL
 * @param {string} url - The URL to check
 * @param {number} timeout - Timeout in milliseconds (default: 20000)
 * @param {number} interval - Check interval in milliseconds (default: 500)
 * @returns {Promise<void>} Resolves when server is ready
 */
function waitForServer(url, timeout = 20000, interval = 500) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    async function check() {
      try {
        const response = await fetch(new URL(url));
        if (response.status === 200) {
          resolve();
        } else {
          retry();
        }
      } catch (error) {
        retry();
      }
    }

    function retry() {
      if (Date.now() - start > timeout) {
        reject(new Error("Server did not start in time"));
      } else {
        setTimeout(check, interval);
      }
    }

    check();
  });
}

// ===================================
// SPLASH SCREEN FUNCTIONS
// ===================================

/**
 * Creates and displays the splash screen
 * @returns {Promise<BrowserWindow>} The splash window instance
 */
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

  await new Promise((resolve) => {
    splash.once("ready-to-show", resolve);
    splash.loadFile(splashFilePath);
  });

  return splash;
}

/**
 * Updates splash screen progress
 * @param {BrowserWindow} splash - The splash window instance
 * @param {string} status - Status message
 * @param {number} progress - Progress percentage
 */
function updateSplashProgress(splash, status, progress) {
  splash.webContents.send("pip-progress", { status, progress });
}

/**
 * Finalizes splash screen and sends completion signal
 * @param {BrowserWindow} splash - The splash window instance
 * @param {number} exitCode - Exit code (0 for success, 1 for error)
 */
function finalizeSplash(splash, exitCode = 0) {
  splash.webContents.send("pip-done", exitCode);
}

/**
 * Sends a single raw log line to the splash screen log area.
 * @param {BrowserWindow} splash - The splash window instance
 * @param {string} line - The log line to display
 */
function sendSplashLog(splash, line) {
  if (splash && !splash.isDestroyed()) {
    splash.webContents.send("pip-log", line);
  }
}

// ===================================
// WORKER SETUP FUNCTIONS
// ===================================

/**
 * Gets the workers directory path based on environment
 * @returns {string} The workers directory path
 */
function getWorkersPath() {
  return getEnvironmentPath(
    path.join(__dirname, "..", "workers"),
    path.join(process.resourcesPath, "workers")
  );
}

/**
 * Scans for worker directories
 * @returns {string[]} Array of worker directory paths
 */
function getWorkerDirectories() {
  const workersPath = getWorkersPath();
  const setupFile = isWindows ? "setup.ps1" : "setup.sh";

  const workerDirs = [];
  // Check if the workers root folder itself contains the setup script
  if (fs.existsSync(path.join(workersPath, setupFile))) {
    workerDirs.push(workersPath);
  }
  // Add subdirectories that contain the setup script
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

/**
 * Creates progress steps for worker setup
 * @param {string[]} workerDirs - Array of worker directories
 * @returns {Array<{status: string, progress: number}>} Progress steps
 */
function createProgressSteps(workerDirs, startProgress = 0) {
  const initialSetupSteps = [
    {
      status: "Setting up thirdparty dependencies...",
      progress: startProgress,
    },
  ];

  // Offset progress so first worker is above 0 and each step is visually distinct
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
 * Runs a setup script for a worker
 * @param {string} scriptPath - Path to the setup script
 * @param {string} cwd - Working directory for the script
 * @returns {Promise<void>} Resolves when script completes successfully
 */
function runSetupScript(scriptPath, cwd, onLog) {
  const logDirPath = ensureLogsDirectory();
  const sanitizedScriptPath = fileURLToPath(new URL(`file://${scriptPath}`));

  const type = path.basename(path.dirname(sanitizedScriptPath));
  const logFilePath = path.join(logDirPath, `${type}.log`);

  // Clean log file before starting
  fs.writeFileSync(logFilePath, "", { flags: "w" });
  const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  return new Promise((resolve, reject) => {
    const command = isWindows ? "powershell.exe" : "/bin/bash";
    const args = isWindows
      ? ["-File", sanitizedScriptPath]
      : [sanitizedScriptPath];

    const setupProcess = spawn(command, args, {
      cwd: new URL(`file://${cwd}`),
    });
    childProcesses.push(setupProcess);

    // Handle process output — split by line for live log streaming
    const rlOut = readline.createInterface({ input: setupProcess.stdout, crlfDelay: Infinity });
    const rlErr = readline.createInterface({ input: setupProcess.stderr, crlfDelay: Infinity });
    rlOut.on("line", (line) => { logStream.write(line + "\n"); if (onLog) onLog(line); });
    rlErr.on("line", (line) => { logStream.write(line + "\n"); if (onLog) onLog(line); });

    // Handle process completion
    setupProcess.on("close", (code) => {
      logStream.end();
      removeChildProcess(setupProcess);

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    // Handle process errors
    setupProcess.on("error", (error) => {
      logStream.end();
      removeChildProcess(setupProcess);
      console.error(`Error running setup script in ${cwd}:`, error);
      reject(error);
    });
  });
}

/**
 * Returns the path to the setup-complete marker file.
 * Stored under app.getPath('userData') so it is always user-writable,
 * regardless of where the app is installed.
 * @returns {string}
 */
function getSetupMarkerPath() {
  return path.join(app.getPath("userData"), ".setup-complete");
}

/**
 * Returns true if the full worker setup has already been completed.
 * @returns {boolean}
 */
function isSetupComplete() {
  return fs.existsSync(getSetupMarkerPath());
}

/**
 * Writes the setup-complete marker so future launches skip the setup flow.
 */
function markSetupComplete() {
  fs.writeFileSync(getSetupMarkerPath(), "installed\n", { encoding: "utf8" });
}

function getThirdpartyPath() {
  return getEnvironmentPath(
    path.join(__dirname, "../", "thirdparty"),
    path.join(process.resourcesPath, "thirdparty")
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
    path.join(process.resourcesPath, "scripts", scriptName)
  );

  // Ensure script exists
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Thirdparty setup script not found: ${scriptPath}`);
  }

  const command = isWindows ? "powershell.exe" : "/bin/bash";
  const args = isWindows
    ? ["-File", scriptPath, thirdpartyPath]
    : [scriptPath, thirdpartyPath];

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd: path.dirname(scriptPath) });
    const rlOut = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
    const rlErr = readline.createInterface({ input: proc.stderr, crlfDelay: Infinity });
    rlOut.on("line", (line) => { process.stdout.write(line + "\n"); if (onLog) onLog(line); });
    rlErr.on("line", (line) => { process.stderr.write(line + "\n"); if (onLog) onLog(line); });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Thirdparty setup failed with code ${code}`));
      }
    });
    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Sets up all workers with progress tracking
 * @returns {Promise<BrowserWindow>} The splash screen instance
 */
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

      await runSetupScript(setupScript, workerDir, onLog);

      progress++;
    }
  }

  updateSplashProgress(splash, "Finalizing installation...", 90);
}

/**
 * Run install_dependencies.sh with root privileges on Unix platforms only.
 * Uses sudo-prompt to show a native GUI password popup.
 * @param {BrowserWindow} splash - The splash window for progress updates.
 * @returns {Promise<boolean>} True if the installer ran and succeeded.
 */
async function runInstaller(splash) {
  if (isWindows) return false;

  const projectRoot = getEnvironmentPath(path.join(__dirname, ".."), process.resourcesPath);
  const installerPath = path.join(projectRoot, "scripts", "install_dependencies.sh");
  const installMarker = path.join(app.getPath("userData"), ".installed");

  updateSplashProgress(splash, "Checking system dependencies...", 0);

  if (!fs.existsSync(installerPath)) {
    console.log(`Installer not found at ${installerPath}, skipping.`);
    return false;
  }

  if (fs.existsSync(installMarker)) {
    console.log("Installer already run (marker present), skipping.");
    return false;
  }

  const confirm = await dialog.showMessageBox(splash, {
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
    return false;
  }

  updateSplashProgress(splash, "Installing system dependencies...", 5);

  try {
    const sudoPrompt = require("@vscode/sudo-prompt");
    const escapedPath = installerPath.replace(/"/g, '\\"');
    await new Promise((resolve, reject) => {
      sudoPrompt.exec(`/bin/bash "${escapedPath}" -y`, { name: "Edge AI Demo Studio" }, (err, stdout, stderr) => {
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
        if (err) reject(err);
        else resolve();
      });
    });

    fs.writeFileSync(installMarker, "installed\n", { encoding: "utf8" });
    updateSplashProgress(splash, "System dependencies installed.", 15);
    return true;
  } catch (err) {
    console.error("Installer failed:", err);
    await dialog.showMessageBox(splash, {
      type: "error",
      buttons: ["OK"],
      title: "Installer failed",
      message: "Failed to install system dependencies.",
      detail: err.message || String(err),
    });
    return false;
  }
}

// ===================================
// SERVER MANAGEMENT FUNCTIONS
// ===================================

/**
 * Gets the frontend path based on environment
 * @returns {string} The frontend directory path
 */
function getFrontendPath() {
  return getEnvironmentPath(
    path.join(__dirname, "..", "frontend", ".next", "standalone"),
    path.join(process.resourcesPath, "frontend")
  );
}

/**
 * Starts the Next.js server
 * @returns {Promise<never>} A rejection-only promise that rejects if the server exits before being declared ready
 */
function startNextServer() {
  const frontendPath = getFrontendPath();
  const logDirPath = ensureLogsDirectory();
  const logFilePath = new URL(
    `file://${path.join(logDirPath, "frontend.log")}`
  );

  // Clean log file before starting
  fs.writeFileSync(logFilePath, "", { flags: "w" });
  const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  const nodePath = getNodePath();
  const serverProcess = spawn(nodePath, ["server.js"], {
    cwd: frontendPath,
    stdio: "pipe",
    env: { ...process.env, PORT: "8080" },
  });

  childProcesses.push(serverProcess);

  // Handle server output
  serverProcess.stdout.on("data", (data) => logStream.write(data));
  serverProcess.stderr.on("data", (data) => logStream.write(data));

  // Handle server exit (for logging)
  serverProcess.on("exit", (code, signal) => {
    logStream.end();
    console.log(`Next.js server exited with code ${code}, signal ${signal}`);
    removeChildProcess(serverProcess);
  });

  // Return a rejection-only promise that fires if the server exits before being declared ready.
  // A separate .catch(() => {}) attached by the caller suppresses unhandled rejections once the
  // server is confirmed healthy.
  return new Promise((_, reject) => {
    serverProcess.once("error", (err) => {
      reject(new Error(`Failed to start Next.js server: ${err.message}`));
    });
    serverProcess.once("exit", (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            signal
              ? `Next.js server was terminated by signal ${signal}`
              : `Next.js server exited with code ${code}`
          )
        );
      }
    });
  });
}

// ===================================
// WINDOW MANAGEMENT FUNCTIONS
// ===================================

/**
 * Creates the main application window
 * @returns {BrowserWindow} The main window instance
 */
function createMainWindow(url) {
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // mainWindow.webContents.openDevTools();
  mainWindow.loadURL(url);

  return mainWindow;
}

// ===================================
// PROCESS CLEANUP FUNCTIONS
// ===================================

/**
 * Kill a single child process tree using tree-kill, escalating to SIGKILL
 * after SIGTERM_GRACE_MS if the process has not exited.
 * @param {ChildProcess} child - The process to kill
 * @returns {Promise<void>} Resolves once the process has exited or SIGKILL was sent
 */
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

    // Resolve early if the process exits on its own after SIGTERM
    child.once("exit", done);

    treeKill(child.pid, "SIGTERM", (err) => {
      if (err) {
        console.error(`Failed to SIGTERM process tree ${child.pid}:`, err);
        done();
      }
    });

    // Escalate to SIGKILL after the grace period if still alive
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

/**
 * Cleans up all tracked child processes gracefully.
 * Idempotent — concurrent or repeated calls return the same promise.
 * @returns {Promise<void>}
 */
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

// ===================================
// ERROR HANDLING
// ===================================

/**
 * Shows an error dialog directing the user to the logs folder, then quits the app.
 * @param {BrowserWindow|null} splash - The splash window (may be null if creation failed)
 * @param {Error} err - The error that caused the failure
 */
async function showErrorAndQuit(splash, err) {
  const logDirPath = ensureLogsDirectory();

  if (splash && !splash.isDestroyed()) {
    finalizeSplash(splash, 1);
  }

  await dialog.showMessageBox({
    type: "error",
    buttons: ["Close"],
    title: "Setup Failed",
    message: "Setup encountered an error and cannot continue.",
    detail: `${err.message || String(err)}\n\nPlease check the logs folder for more details:\n${logDirPath}`,
  });

  await cleanupChildProcesses();
  app.quit();
}

// ===================================
// EVENT HANDLERS AND STARTUP
// ===================================

// Process event handlers
//
// NOTE: 'exit' is synchronous — async cleanup cannot run there.
// Signal handlers route through app.quit() so that Electron's will-quit
// event (below) handles the async teardown in one place.
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
  cleanupChildProcesses().then(() => process.exit(1));
});

// Electron app event handlers
//
// will-quit fires after all windows are closed, just before the process exits.
// event.preventDefault() holds the quit until async cleanup is done.
app.on("will-quit", (event) => {
  if (cleanupPromise) return; // cleanup already in progress or complete
  event.preventDefault();
  cleanupChildProcesses().then(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Main application startup
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  const url = "http://localhost:8080";

  // If setup has already been completed, skip the splash screen and go straight
  // to starting the server and opening the main window.
  if (isSetupComplete()) {
    console.log("Setup already complete — skipping splash and setup.");
    try {
      const serverFailure = startNextServer();
      serverFailure.catch(() => {});
      await Promise.race([waitForServer(url), serverFailure]);
      createMainWindow(url);
    } catch (err) {
      console.error("Failed to start application:", err);
      await showErrorAndQuit(null, err);
    }
    return;
  }

  // First run — show the splash screen and run the full setup flow.
  let splash = null;
  try {
    splash = await createSplashScreen();

    const installerRan = await runInstaller(splash);

    await setupWorkers(splash, installerRan ? 15 : 0);

    // Persist the marker so future launches skip setup entirely.
    markSetupComplete();

    const serverFailure = startNextServer();
    serverFailure.catch(() => {});

    finalizeSplash(splash, 0);
    await Promise.race([waitForServer(url), serverFailure]);

    // Create and show main window
    const mainWindow = createMainWindow(url);

    // Close splash after main window loads
    mainWindow.webContents.once("did-finish-load", () => {
      splash.close();
    });
  } catch (err) {
    console.error("Failed to start application:", err);
    await showErrorAndQuit(splash, err);
  }
});
