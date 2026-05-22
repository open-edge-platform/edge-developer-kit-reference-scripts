# Deployment

This document explains how to package and run the application builds for Windows and Linux.

## 1. Package the app

- Windows (PowerShell): run the packaging script:

- [scripts/win/package.ps1](../scripts/win/package.ps1)

- Linux / macOS (bash): run the packaging script:

- [scripts/bash/package.sh](../scripts/bash/package.sh)

The packaging scripts produce an `out/` folder. Inside `out/` you'll find the packaged build artifacts — a ZIP archive and an unzipped application directory (the application folder).

## 2. Run the packaged application

 - Windows: open the unzipped application folder inside `out/` and run the EXE (double-click or from PowerShell):

	- `EdgeAIDemoStudio.exe`

 - Linux (Ubuntu, other distros): open a terminal, change into the unzipped application folder inside `out/` and run:

	- `./EdgeAIDemoStudio`

	If the binary is not executable, make it executable first:

	- `chmod +x EdgeAIDemoStudio`

## 3. Ubuntu / Electron sandbox notes

Some Linux systems restrict unprivileged user namespaces, which can prevent Electron's sandbox from working. If the app fails to start due to sandboxing, enable unprivileged user namespaces and reload sysctl settings:

```bash
sudo sysctl -w kernel.unprivileged_userns_clone=1
```

After that change the setting persists across reboots. If enabling user namespaces is not possible in your environment, you can run the app with the `--no-sandbox` flag as a temporary workaround (not recommended for production).

## 4. Troubleshooting

- If packaging fails, inspect the packaging script output in the terminal.
- Check `resources/logs/` in the repository  for runtime errors from the packaged app.