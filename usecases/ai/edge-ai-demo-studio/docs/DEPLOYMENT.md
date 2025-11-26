# Edge AI Demo Studio - Deployment

This directory contains the Deployment instructions for Edge AI Demo Studio.

## Deployment

### Packaging the Electron App

For Linux:
```bash
../scripts/bash/package.sh
```
For Windows (PowerShell/Command Prompt):
```bash
../scripts/win/package.ps1
```

This script will help ensure all dependencies are installed and configured correctly before packaging and then it will create the package in [electron/out](../electron/out).

If you have permission issue running the package script in Windows, please refer to [FAQ](#faq)

## Running on Ubuntu 24.04

If you're running the packaged Electron app on Ubuntu 24.04, you may need to adjust AppArmor settings to allow the application to run properly:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

This command disables AppArmor restrictions on unprivileged user namespaces, which is required for Electron apps to function correctly on Ubuntu 24.04.
## Prerequisites

Make sure you have ran the root setup script before running the commands above.

## FAQ

**Q: Why is Electron failed to install**

If you are running behind a proxy, please ensure you set proxy for Electron as below:

For Linux:
```bash
export ELECTRON_GET_USE_PROXY=http://proxy:port
```

For Windows (PowerShell):

```powershell
$env:ELECTRON_GET_USE_PROXY="http://proxy:port"
```

**Q: Why do I not have permission to run PowerShell scripts?**

This is usually due to Windows PowerShell's execution policy restrictions. 

**Quick Solution (Recommended):** Run the script with the `-ExecutionPolicy Bypass` flag each time:

```powershell
powershell -ExecutionPolicy Bypass -NoProfile -File package.ps1
```

This bypasses the execution policy for that single command without changing system settings.

**Alternative (Persistent Solution):** If you don't want to type the long command every time, you can change the execution policy for your entire PC. Open PowerShell as Administrator and run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine
```

When prompted, type `Y` to confirm.

**Note:** Only change the execution policy if you understand the security implications. `RemoteSigned` allows locally created scripts to run but requires downloaded scripts to be signed by a trusted publisher. You can revert to the default policy later with:

```powershell
Set-ExecutionPolicy Restricted
```