<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Physical AI Scene Builder Development Guide

This guide covers local setup, running the application, and creating a production build.

## Prerequisites

- Node.js* 20.9 or newer and npm* 11 or newer
- uv* (Python* 3.12+ on Linux* for native Generate and Evaluate workers)
- Docker* with Docker Compose, used only to run PostgreSQL*; the web application runs natively and
  is not containerized
- Git*, `build-essential`, `pkg-config`, and `python3-dev`
- A Chromium*-compatible browser

## Setup

From the `physical-ai-scene-builder` directory:

```sh
./setup.sh
npm run db:up && npm run dev
```

`./setup.sh` creates the root `.env` and `apps/web/.env` with a PostgreSQL password and a generated
`PAYLOAD_SECRET`, then installs the dependencies and builds the app.

Open <http://localhost:3000>. Start PostgreSQL with `npm run db:up`, then start the development
server with `npm run dev`. PostgreSQL listens on `127.0.0.1` only.

To build and run the web application without the development server:

```sh
npm run build
npm run start --workspace @mujoco-studio/web
```

## Python Workers

The web application can run without the native Python workers. To enable Generate and Evaluate
workers, install the runtime dependencies from the sample root:

```sh
uv sync --project integrations/python --extra teleoperation
```

## LAN Access

For trusted-LAN access, configure the root `.env`:

```dotenv
BIND_ADDRESS=0.0.0.0
PORT=3000
```

Then run `./start.sh` after building, or use `npm run db:up && npm run dev`. Expose the application only to
trusted networks; it does not provide user authentication. See the [README](../README.md) for
networking and client configuration details.

## Configuration

Source development reads `apps/web/.env` for application settings and the root `.env` for
networking and PostgreSQL settings, including the required `POSTGRES_PASSWORD`. See
[Known Issues](../README.md#known-issues) for common setup issues.

\*Other names and brands may be claimed as the property of others.
