# Edge AI Studio - Electron Builder Version

This directory contains the Electron Builder implementation of Edge AI Studio, running in parallel with the Electron Forge version for comparison and testing.

## Differences from Electron Forge

| Feature | Electron Forge | Electron Builder |
|---------|---------------|------------------|
| Configuration | `forge.config.js` | `build` in `package.json` |
| Package Command | `electron-forge package` | `electron-builder --dir` |
| Make Command | `electron-forge make` | `electron-builder` |
| Dependencies | Multiple `@electron-forge/*` packages | Single `electron-builder` package |

## Setup

From the project root, run:

```bash
# Linux/macOS
./setup.sh

# Windows PowerShell
./setup.ps1
```

Or setup just this directory:

```bash
# Linux/macOS
cd electron-builder
./setup.sh

# Windows PowerShell
cd electron-builder
./setup.ps1
```

## Development

### Start in Development Mode

```bash
cd electron-builder
npm start
```

This will launch the Electron app pointing to your local frontend server.

## Building

### Build Package Directory (No Installer)

```bash
cd electron-builder
npm run build:dir
```

This creates an unpacked directory at `../out/linux-unpacked/` (or `win-unpacked` on Windows).

### Build Distributable

```bash
# Linux
npm run build:linux

# Windows
npm run build:win

# Both
npm run build
```

This creates distributable installers:
- **Linux**: ZIP and DEB files
- **Windows**: Squirrel installer

Output is in `../out/`.

## Configuration

The build configuration is in `package.json` under the `build` key. Key settings:

- **appId**: `com.intel.edge-ai-studio`
- **productName**: `EdgeAIStudio`
- **extraResources**: Copies `frontend`, `workers`, and `scripts` from `../build/`
- **electronFuses**: Same security settings as Forge version
- **Linux targets**: ZIP and DEB
- **Windows targets**: Squirrel

## Package Script

To use the automated package script (similar to Forge):

```bash
cd ../scripts
./package-builder.sh
```

This will:
1. Create `../build/` directory
2. Copy workers (excluding `.venv`, `__pycache__`, etc.)
3. Copy scripts
4. Build frontend
5. Run `electron-builder`
6. Create final ZIP package

## Comparing with Forge

Both versions are functionally identical. You can test both to compare:

1. **Build time**: Which is faster?
2. **Package size**: Any difference in final output?
3. **Ease of use**: Which configuration is clearer?
4. **Features**: Any missing capabilities?

## Migration Status

✅ **Completed**:
- Package.json with build configuration
- All source files (main.js, preload.js, splash files)
- Setup scripts (Linux & Windows)
- Electron Fuses configuration
- Extra resources configuration

📋 **To Do**:
- Create package script for automated builds
- Test on Windows
- Compare output with Forge version

## Notes

- The `main.js` file is identical to the Forge version
- Output directory is shared (`../out/`) but different subdirectories
- Both versions can coexist without conflicts
