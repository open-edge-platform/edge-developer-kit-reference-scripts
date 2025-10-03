<!-- Copyright (C) 2025 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

## Text-To-Speech Worker

This worker provides a Text-to-Speech (TTS) service using the Kokoro FastAPI server and Intel hardware acceleration.

### Setup

To set up the Text-to-Speech worker, you need to download third-party packages (such as espeak and Kokoro-FastAPI) and install all required dependencies.

**For Ubuntu/Linux:**
```bash
./setup.sh
```

**For Windows:**
```powershell
.\setup.ps1
```

This will ensure all necessary components are installed before you run the worker.

### Usage

To start the Text-to-Speech worker, run:

```bash
uv run main.py --port 5002
```

Replace `--port` with your desired value if needed. See the options below for details.

**Options:**

- `--port`: Port to serve the API (default: 5002)

### What Happens

- Downloads the Kokoro TTS model if not present.
- Starts the FastAPI server with the specified port.

### Notes

- For GPU support, make sure your system has the required Intel drivers.