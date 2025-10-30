# Development Guide

## Setting Up

To set up the development environment, run the `setup.sh` script:

```bash
./setup.sh
```

This script will install all necessary dependencies and configure the environment for development.

## Electron Development

To test the Electron app deployment, follow these steps:

For Linux/macOS:

```bash
export ELECTRON_GET_USE_PROXY=http://proxy:port
```

For Windows (PowerShell):

```powershell
$env:ELECTRON_GET_USE_PROXY="http://proxy:port"
```

1. Install the required npm dependencies:

   ```bash
   npm install
   ```

2. Start the Electron app in development mode:

   ```bash
   npm run start
   ```

This will launch the Electron application for testing purposes.