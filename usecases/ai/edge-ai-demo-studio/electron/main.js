// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// ===================================
// DEPENDENCIES AND IMPORTS
// ===================================
const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const { fileURLToPath } = require("url");
const fs = require("fs");

// ===================================
// GLOBAL VARIABLES
// ===================================
const childProcesses = []; // Array to track spawned processes
const isWindows = os.platform() === "win32";

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
    width: 400,
    height: 300,
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
function createProgressSteps(workerDirs) {
  const initialSetupSteps = [
    {
      status: "Setting up thirdparty dependencies...",
      progress: 0,
    },
  ];

  // Offset progress so first worker is above 0 and each step is visually distinct
  const totalSteps = workerDirs.length + 1; // +1 for initial setup
  return initialSetupSteps.concat(
    workerDirs.map((workerDir, index) => ({
      status: `Setting up ${path.basename(workerDir)}...`,
      progress: Math.round(((index + 1) / totalSteps) * 80),
    }))
  );
}

/**
 * Runs a setup script for a worker
 * @param {string} scriptPath - Path to the setup script
 * @param {string} cwd - Working directory for the script
 * @returns {Promise<void>} Resolves when script completes successfully
 */
function runSetupScript(scriptPath, cwd) {
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

    // Handle process output
    setupProcess.stdout.on("data", (data) => logStream.write(data));
    setupProcess.stderr.on("data", (data) => logStream.write(data));

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

async function setupThirdparty() {
  const thirdpartyPath = getThirdpartyPath();
  const scriptName = isWindows ? "setup_thirdparty.ps1" : "setup_thirdparty.sh";
  const scriptPath = getEnvironmentPath(
    path.join(__dirname, "..", "scripts", scriptName),
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
    proc.stdout.on("data", (data) => {
      process.stdout.write(data);
    });
    proc.stderr.on("data", (data) => {
      process.stderr.write(data);
    });
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
async function setupWorkers() {
  const workerDirs = getWorkerDirectories();

  const steps = createProgressSteps(workerDirs);
  const splash = await createSplashScreen();

  let progress = 0;

  const response = await setupThirdparty();
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

      try {
        await runSetupScript(setupScript, workerDir);
      } catch (error) {
        console.error(`Failed to run setup script for ${workerDir}:`, error);
      }

      progress++;
    }
  }

  updateSplashProgress(splash, "Finalizing installation...", 90);
  return splash;
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
 * @returns {void}
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

  // Handle server errors
  serverProcess.on("error", (err) => {
    console.error("Failed to start Next.js server:", err);
  });

  // Handle server exit
  serverProcess.on("exit", (code, signal) => {
    logStream.end();
    console.log(`Next.js server exited with code ${code}, signal ${signal}`);
    removeChildProcess(serverProcess);
  });
}

// ===================================
// WINDOW MANAGEMENT FUNCTIONS
// ===================================

/**
 * Creates the main application window
 * @returns {BrowserWindow} The main window instance
 */
function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // mainWindow.webContents.openDevTools();
  mainWindow.loadURL("http://localhost:8080/text-generation");

  return mainWindow;
}

// ===================================
// PROCESS CLEANUP FUNCTIONS
// ===================================

/**
 * Cleans up all child processes gracefully
 * @returns {void}
 */
function cleanupChildProcesses() {
  console.log("Cleaning up child processes...");

  childProcesses.forEach((child) => {
    if (child && child.pid && !child.killed) {
      try {
        console.log(`Terminating process ${child.pid}`);

        // First try SIGTERM for graceful shutdown
        child.kill("SIGTERM");

        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (child && child.pid && !child.killed) {
            console.log(`Force killing process ${child.pid}`);
            child.kill("SIGKILL");
          }
        }, 5000);
      } catch (error) {
        console.error(`Error killing process ${child.pid}:`, error);
      }
    }
  });
}

// ===================================
// EVENT HANDLERS AND STARTUP
// ===================================

// Process event handlers
process.on("exit", cleanupChildProcesses);
process.on("SIGINT", () => {
  console.log("SIGINT received. Cleaning up child processes...");
  cleanupChildProcesses();
  process.exit();
});
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Cleaning up child processes...");
  cleanupChildProcesses();
  process.exit();
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  cleanupChildProcesses();
  process.exit(1);
});

// Electron app event handlers
app.on("before-quit", () => {
  console.log("App is quitting. Cleaning up processes...");
  cleanupChildProcesses();
});

app.on("window-all-closed", () => {
  cleanupChildProcesses();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Main application startup
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  try {
    // Setup workers and show splash screen
    const splash = await setupWorkers();

    // Start the Next.js server
    startNextServer();

    // Wait for server to be ready
    finalizeSplash(splash, 0);
    await waitForServer("http://localhost:8080/text-generation");

    // Create and show main window
    const mainWindow = createMainWindow();

    // Close splash after main window loads
    mainWindow.webContents.once("did-finish-load", () => {
      splash.close();
    });
  } catch (err) {
    console.error("Failed to start application:", err);
    // Could send error status to splash here if needed
  }
});
