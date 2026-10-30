<!-- Copyright (C) 2025 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Intel AMT & DMT MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes **Intel AMT out-of-band device management** — built on the official MCP Python SDK (`mcp.server.MCPServer`) and the [DMT (Device Management Toolkit)](https://github.com/device-management-toolkit) Console REST API.

It lets any MCP client (LLM agent, IDE, chat UI) inspect and **self-heal managed PCs without touching the OS**: capture the screen over AMT KVM redirection even when the machine is BSOD'd or hung, read the hardware System Event Log, and fire out-of-band power actions (power cycle, boot to BIOS/PXE, reset).

This server is the MCP **provider** consumed by the sibling [`amt-agent`](../amt-agent/README.md) (DMT Operator Agent).

---

## Capabilities

| # | Capability | How |
| :--- | :--- | :--- |
| 1 | Capture out-of-band screen frames | Direct TCP/TLS + APF digest auth + RFB (VNC) to AMT KVM (ports 16995/16994) — returns MCP `ImageContent` |
| 2 | Diagnose BSOD / kernel panics | Screen capture + vision analysis happens client-side; SEL read server-side |
| 3 | Inspect hardware SEL event logs | DMT REST API (watchdog timeouts, thermal trips, ECC errors, …) |
| 4 | Out-of-band remediation | Power cycle, reset, boot to BIOS, boot to PXE, power on/off, sleep, hibernate |
| 5 | Verify recovery | Re-capture live display after remediation |
| 6 | Compliance incident logging | Structured JSON incident reports written to disk |

---

## Quick Start

### 1. Prerequisites

- **Python ≥ 3.10** and [Astral `uv`](https://docs.astral.sh/uv/)
- A running **DMT Console** REST API (default `http://127.0.0.1:8181`) with provisioned AMT devices
- AMT devices with **KVM redirection enabled** and known AMT admin credentials

### 2. Install dependencies

```bash
uv sync
```

### 3. Save AMT credentials (recommended)

Screen capture over KVM needs the AMT admin username/password. Store them once in the local SQLite vault so tools never need a password argument. Passwords are encrypted at rest with AES-256-GCM (see [Credential Vault](#credential-vault)); a key file is generated automatically on first use:

```bash
uv run python dmt_client.py credentials set <hostname-or-guid> \
    --amt-user admin --amt-password 'P@ssw0rd!'
uv run python dmt_client.py credentials list
```

### 4. Start the MCP server

```bash
# DMT Console connection. TLS certificate verification can't be disabled;
# pin the running console's own self-signed certificate instead. DMT_URL's
# hostname must match the cert's CN/SAN (the console's default cert covers
# "localhost", not an IP), or hostname validation will fail.
export DMT_URL=https://localhost:8181
export DMT_USER=<console username>
export DMT_PASSWORD=<console password>
openssl s_client -connect localhost:8181 -servername localhost </dev/null 2>/dev/null \
    | openssl x509 -outform PEM > dmt-console.pem
export DMT_TLS_VERIFY="$(pwd)/dmt-console.pem"

# SSE transport (default) — http://localhost:8000/sse
uv run python dmt_mcp_server.py --transport sse --host 0.0.0.0 --port 8000

# or stdio (for local MCP clients like Claude Desktop / IDE integrations)
uv run python dmt_mcp_server.py --transport stdio

# or streamable HTTP
uv run python dmt_mcp_server.py --transport streamable-http --port 8000
```

### 5. Register with an MCP client

```json
{
  "mcpServers": {
    "dmt-amt": {
      "url": "http://localhost:8000/sse"
    }
  }
}
```

---

## MCP Tools

| Tool | Description | Key parameters |
| :--- | :--- | :--- |
| `dmt_get_all_devices` | List all registered AMT devices in the DMT Console | `top`, `tags`, `hostname`, `friendly_name` (all optional filters) |
| `dmt_get_system_info` | Hardware inventory, firmware/BIOS version, OS metadata, live power state | `device` (GUID, hostname, or friendly name; omit for the only/first device) |
| `dmt_capture_screen` | Live out-of-band screen frame over KVM RFB — returns `ImageContent` (in memory, nothing saved to disk) + a markdown summary | `hostname` (required); `username`/`password` optional (fall back to the SQLite vault); `timeout` |
| `dmt_get_event_log` | Intel AMT System Event Log (SEL) for root-cause analysis | `device`, `top` (default 30) |
| `dmt_remediate_device` | Out-of-band power/recovery action | `device`, `action`: `power_cycle`, `reset`, `boot_to_bios`, `boot_to_pxe`, `power_on`, `power_off`, `sleep`, `hibernate` |
| `dmt_log_incident` | Write a structured JSON incident report for compliance/telemetry | `device`, `incident_type`, `recovery_status`, `actions_taken`, `stop_code`, `failing_module`, `notes`, `report_filename` |

> **Note:** `dmt_capture_screen` error messages may mention a `dmt_save_amt_credentials` tool — credential storage is currently done through the **CLI vault** (`dmt_client.py credentials set`), not an MCP tool.

---

## Configuration

### CLI options (`dmt_mcp_server.py`)

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--transport` | `sse` | `sse`, `stdio`, or `streamable-http` |
| `--host` | `0.0.0.0` (`MCP_HOST`) | Bind host for HTTP/SSE server |
| `--port` | `8000` (`MCP_PORT`) | Bind port for HTTP/SSE server |
| `--dmt-url` | `DMT_URL` / `https://127.0.0.1:8181` | DMT Console REST API base URL |

### Environment variables

| Variable | Default | Used by | Description |
| :--- | :--- | :--- | :--- |
| `DMT_URL` | `http://127.0.0.1:8181` | server + CLI | DMT Console REST API URL (use `https://...` if the console serves TLS) |
| `DMT_USER` / `DMT_PASSWORD` | — | `DMTClient` | DMT Console login. When `DMT_USER` is set, the client logs in automatically on the first request and again on a `401` |
| `DMT_TLS_VERIFY` | `1` | `DMTClient` | TLS verification for DMT Console REST calls: `1`/unset verifies against the system trust store; any other non-boolean value is a path to the console's certificate/issuing CA bundle PEM (self-signed console). `0`/`false`/`no` is rejected at startup — certificate verification can't be disabled |
| `MCP_HOST` / `MCP_PORT` | `0.0.0.0` / `8000` | server | Transport bind address |
| `AMT_DB_PATH` | `./amt_credentials.db` | vault | SQLite credentials vault location (path is normalized; file is chmod `0600`) |
| `AMT_VAULT_KEY_FILE` | `<AMT_DB_PATH>.key` | vault | AES-256-GCM key file (hex, chmod `0600`, auto-generated on first use). See [Credential Vault](#credential-vault) |
| `AMT_TLS_VERIFY` | unset | KVM capture | Set to `1`/`true` to enforce full TLS certificate + hostname validation on AMT KVM sessions (requires trusted/pinned device certs). Required (together with/instead of `AMT_TLS_CA_FILE`) since certificate verification can no longer be disabled |
| `AMT_TLS_CA_FILE` | unset | KVM capture | Path to the AMT device's own certificate/issuing CA PEM (self-signed devices); pins trust to it without requiring hostname validation. At least one of `AMT_TLS_VERIFY=1` or `AMT_TLS_CA_FILE` is required for TLS KVM captures |

---

## How It Works

```
MCP client (agent / LLM / chat UI)
        │  SSE | streamable-http | stdio
        ▼
dmt_mcp_server.py ──── REST ────► DMT Console (127.0.0.1:8181)
        │                            devices, power, SEL, hardware, features …
        ├── direct TCP/TLS ───────► Intel AMT KVM (16995 TLS / 16994 plain)
        │                            APF digest auth → RFB/VNC frame grab
        └── SQLite vault ◄────────  amt_credentials.db (AES-256-GCM encrypted AMT admin creds)
                                     + amt_credentials.db.key (vault key)
```

- **`dmt_client.py`** is both the shared client library and a standalone CLI:
  - `AMTVault` — SQLite-backed AMT credential store (lookup by GUID, hostname, or friendly name); passwords encrypted with AES-256-GCM
  - `IntelAMTClient` — raw socket → TLS → APF digest challenge → RFB negotiation → full-frame PNG (Pillow)
  - `DMTClient` — thin REST client covering power, hardware, network, logs, consent, KVM, features, profiles, CIRA, and raw API passthrough
- Captured frames are returned to the MCP client as in-memory `ImageContent`; the server does not write them to disk.
- Device identifiers are resolved flexibly: **GUID, IP/hostname, or friendly name** all work.

---

## Credential Vault

AMT admin credentials are kept in a local SQLite database (`amt_credentials.db`). **Passwords are encrypted at rest with AES-256-GCM**; usernames, ports and notes are stored in the clear.

| Aspect | Behavior |
| :--- | :--- |
| Key | Random 256-bit key stored hex-encoded in `<AMT_DB_PATH>.key` (or `AMT_VAULT_KEY_FILE`), created automatically with `0600` permissions on first use |
| Ciphertext format | `v1:<base64(96-bit nonce ‖ ciphertext+tag)>`; a fresh random nonce is used for every write |
| Row binding | The credential identifier is authenticated as AAD, so ciphertext copied to another row fails to decrypt |
| Lookup | By GUID, hostname, or friendly name (case-insensitive) |
| Missing/wrong key | Fails with `Failed to decrypt credential ...`. If the key file is missing but the DB already holds credentials, the vault refuses to start rather than creating a new key |
| Legacy plaintext DBs | **Not supported.** Delete the old `.db` and re-save credentials with `credentials set` |

Operational notes:

- **Back up the key file** and, where possible, keep it on a different volume from the DB (`AMT_VAULT_KEY_FILE`). Without it the stored credentials are unrecoverable.
- By default the key sits next to the DB, so encryption protects against a leaked or copied DB file, not against someone with access to the whole directory.
- `credentials list` and `--json` output mask passwords, but `credentials get` prints the decrypted password.
- Both files are git-ignored (`*.db`, `*.key`).

---

## Standalone CLI (`dmt_client.py`)

The same functionality is available without MCP — useful for testing connectivity before wiring up an agent:

```bash
uv run python dmt_client.py devices                       # list registered devices
uv run python dmt_client.py info <device>                 # system/firmware/power overview
uv run python dmt_client.py power <device> cycle          # on|off|cycle|reset|bios|pxe|sleep|hibernate
uv run python dmt_client.py event-log <device> --top 30   # SEL events (or --download out.txt)
uv run python dmt_client.py capture <device> -o shot.png  # direct KVM screen grab
uv run python dmt_client.py credentials set <device> -u admin -p 'P@ssw0rd!'
uv run python dmt_client.py features <device>             # view/modify KVM, SOL, IDER, consent
uv run python dmt_client.py raw /api/v1/devices           # raw REST passthrough (GET/POST/PATCH/…)
```

Common flags: `--json` (machine-readable output), `--url` (DMT URL), `--device/-d`, `--amt-user/-u`, `--amt-password/-p`. Run without arguments for full help.

---

## Project Layout

```
amt-mcp-server/
├── dmt_mcp_server.py    # MCP server: tools, SSE/streamable-http/stdio transports
├── dmt_client.py        # AMTVault + IntelAMTClient (KVM/RFB) + DMTClient (REST) + standalone CLI
├── pyproject.toml       # uv project (name: dmt-amt-client, package = false)
├── amt_credentials.db   # SQLite AMT credentials vault, passwords AES-GCM encrypted (git-ignored)
└── amt_credentials.db.key  # AES-256 vault key, 0600 (git-ignored)
```

---

## Testing

```bash
uv sync --group test
uv run --group test pytest tests/ -v
```

The suite mocks all sockets/HTTP (no DMT Console or Intel AMT hardware
needed) and runs against an isolated, file-based SQLite vault. See
[tests/README.md](./tests/README.md) for what each test file covers and its
one documented scope limitation (the KVM/RFB binary handshake isn't faked
end-to-end).

---

## Troubleshooting

| Symptom | Likely cause / fix |
| :--- | :--- |
| `Connection refused` to DMT API | DMT Console not running or wrong `DMT_URL` (`--dmt-url`) |
| `HTTP 400 ... HTTP request to an HTTPS server` | `DMT_URL` uses `http://` but the console serves HTTPS — use `https://` |
| `CERTIFICATE_VERIFY_FAILED` on DMT calls | Self-signed console cert — set `DMT_TLS_VERIFY=/path/to/console-cert.pem` |
| `... IP address mismatch, certificate is not valid for '...'` | `DMT_URL`'s hostname doesn't match the console cert's CN/SAN (default cert covers `localhost`, not an IP) — use that hostname in `DMT_URL` |
| `TLS certificate verification is required for Intel AMT KVM connections` | Set `AMT_TLS_VERIFY=1` (system trust store) or `AMT_TLS_CA_FILE=/path/to/device-cert.pem` (pin the device's own cert) |
| `HTTP 401 ... request does not contain an access token` | Set `DMT_USER` and `DMT_PASSWORD` so the client can log in automatically |
| `Failed to start KVM redirection session ... status 3 busy` | Another KVM/redirection session is active (DMT web KVM, MeshCommander, or a not-yet-released capture) — close it and retry |
| `Could not find session for ID` / `404` on `/messages/` | MCP client holds a stale SSE session (server restarted or stream dropped) — reconnect the client |
| `Intel AMT password ... not found` | Populate the vault: `dmt_client.py credentials set <device> -u admin -p ...` |
| `Failed to decrypt credential ...` | Wrong or missing key file, corrupted row, or a legacy plaintext DB. Restore the original key (`AMT_VAULT_KEY_FILE`), or delete the DB and re-save credentials |
| `Vault key file not found ... contains encrypted credentials` | The `.key` file was moved or deleted — restore it (or set `AMT_VAULT_KEY_FILE` to its location) |
| KVM connect timeout | KVM redirection disabled on the device, user consent required, or port 16995/16994 blocked by firewall |
| TLS handshake failure | Device provisioned without TLS — use port 16994 / `--no-tls` in the vault entry |
| `Pillow (PIL) is required` | Install Pillow (`uv sync` covers it) — needed only for screen capture |
