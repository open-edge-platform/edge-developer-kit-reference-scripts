# Edge AI Demo Studio - Deployment

This directory contains the Deployment instructions for Edge AI Demo Studio.

## Deployment

### Packaging the Electron App

For Linux/macOS:
```bash
../scripts/package.sh
```
For Windows (PowerShell):
```bash
../scripts/package.ps1
```

This script will help ensure all dependencies are installed and configured correctly before packaging and then it will create the package in [electron/out](../electron/out).

## Running on Ubuntu 24.04

If you're running the packaged Electron app on Ubuntu 24.04, you may need to adjust AppArmor settings to allow the application to run properly:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

This command disables AppArmor restrictions on unprivileged user namespaces, which is required for Electron apps to function correctly on Ubuntu 24.04.
## Prerequisites

Make sure you have ran the root setup script before running the commands above.