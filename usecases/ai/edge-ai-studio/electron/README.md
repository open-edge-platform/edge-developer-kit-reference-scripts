# Edge AI Studio - Electron App

This directory contains the Electron application for Edge AI Studio.

## Development

### Prerequisites

Before starting, ensure you have the following installed:

- **Node.js** and **npm**

If you're behind a proxy, export the following environment variable before installing dependencies:

For Linux/macOS:

```bash
export ELECTRON_GET_USE_PROXY=http://proxy:port
```

For Windows (PowerShell):

```powershell
$env:ELECTRON_GET_USE_PROXY="http://proxy:port"
```


### Starting the Electron App

To start the Electron app in development mode:

```bash
npm run start
```

### Packaging the Electron App

To package the Electron app for distribution:

```bash
npm run make
```

**Note:** Before running `npm run make`, ensure that all dependencies are set up properly by running the package script:

```bash
../scripts/package.sh
```

This script will help ensure all dependencies are installed and configured correctly before packaging.

## Running on Ubuntu 24.04

If you're running the packaged Electron app on Ubuntu 24.04, you may need to adjust AppArmor settings to allow the application to run properly:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

This command disables AppArmor restrictions on unprivileged user namespaces, which is required for Electron apps to function correctly on Ubuntu 24.04.

## Project Structure

- `main.js` - Main Electron process
- `preload.js` - Preload script for renderer process
- `splash.html` - Splash screen HTML
- `splash.js` - Splash screen JavaScript
- `forge.config.js` - Electron Forge configuration
- `logs/` - Application log files

## Prerequisites

Make sure you have Node.js and npm installed before running the commands above.