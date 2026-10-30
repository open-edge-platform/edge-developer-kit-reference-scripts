<!-- Copyright (C) 2025 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# AMT MCP Server Quick Start

Start the Intel AMT & DMT MCP server and connect an MCP client to it.

> **Before running:** the `dmt_remediate_device` tool can power-cycle, reset, or
> power off managed devices. Use a test endpoint first.

## 1. Prerequisites

- Python 3.10 or newer and [uv](https://docs.astral.sh/uv/).
- A running DMT Console REST API (default `http://127.0.0.1:8181`) with
  provisioned AMT devices.
- AMT devices with KVM redirection enabled and known AMT admin credentials.

Run the commands below from the `amt-mcp-server` directory.

## 2. Install dependencies

```bash
uv sync
```

## 3. Configure the DMT Console connection

```bash
export DMT_URL="https://localhost:8181"
export DMT_USER="<console username>"
export DMT_PASSWORD="<console password>"

# TLS certificate verification can't be disabled (DMT_TLS_VERIFY=0 isn't
# supported). Pin the console's own self-signed certificate instead: fetch it
# from the already-running console and trust exactly that cert.
openssl s_client -connect localhost:8181 -servername localhost </dev/null 2>/dev/null \
    | openssl x509 -outform PEM > dmt-console.pem
export DMT_TLS_VERIFY="$(pwd)/dmt-console.pem"
```

`DMT_URL`'s hostname must match the cert's CN/SAN — the console's default
self-signed cert is issued for `localhost`, not an IP — or hostname
validation will fail. Re-run the `openssl`/`export DMT_TLS_VERIFY` steps
whenever the console restarts with a freshly regenerated certificate.

Check connectivity and list the registered devices:

```bash
uv run python dmt_client.py devices
```

## 4. Save AMT credentials

Screen capture over KVM needs the AMT admin credentials. Store them once in the
local vault (passwords are encrypted at rest with AES-256-GCM; the key file is
created on first use):

```bash
uv run python dmt_client.py credentials set <hostname-or-guid> --amt-user admin --amt-password '<amt password>' --no-tls
uv run python dmt_client.py credentials list
```

Back up the generated `amt_credentials.db.key` file. Without it the stored
credentials cannot be recovered.

## 5. Start the server

```bash
uv run python dmt_mcp_server.py --transport sse --host 127.0.0.1 --port 8000
```

The SSE endpoint is <http://localhost:8000/sse>. The server binds to `0.0.0.0`
by default and has no authentication; restrict network access appropriately.

Other transports:

```bash
uv run python dmt_mcp_server.py --transport stdio
uv run python dmt_mcp_server.py --transport streamable-http --port 8000
```

## 6. Connect an MCP client

```json
{
  "mcpServers": {
    "dmt-amt": {
      "url": "http://localhost:8000/sse"
    }
  }
}
```

The sibling [amt-agent](../amt-agent/QUICK-START.md) uses this endpoint through
`MCP_SSE_URL`.

## Available tools

`dmt_get_all_devices`, `dmt_get_system_info`, `dmt_capture_screen`,
`dmt_get_event_log`, `dmt_remediate_device`, and `dmt_log_incident`. See the
[README](./README.md#mcp-tools) for parameters.

## Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| `Connection refused` to DMT API | Start the DMT Console or correct `DMT_URL`. |
| `HTTP 401 ... access token` | Set `DMT_USER` and `DMT_PASSWORD`. |
| `CERTIFICATE_VERIFY_FAILED` | Set `DMT_TLS_VERIFY` to the console certificate/issuing CA PEM. |
| `Intel AMT password ... not found` | Run `credentials set` for the device (step 4). |
| `Failed to start KVM redirection session ... busy` | Close other KVM sessions (DMT web KVM, MeshCommander) and retry. |

See the [README troubleshooting table](./README.md#troubleshooting) for more.
