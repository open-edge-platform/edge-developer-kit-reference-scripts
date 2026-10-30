<!-- Copyright (C) 2025 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# DMT Operator Agent Quick Start

Run an Intel AMT device audit using screen analysis and hardware event logs.

> **Before running:** this agent can automatically reset, power-cycle, or power
> off managed devices when it detects faults. Use a test endpoint first.

## 1. Prerequisites

- Python 3.12 or newer and [uv](https://docs.astral.sh/uv/).
- The sibling [AMT MCP server](../amt-mcp-server/README.md) running, with your
  target devices registered and reachable.
- An OpenAI-compatible vision model server that accepts image inputs and JSON
  mode (`response_format: {"type": "json_object"}`).

Run the commands below from the `amt-agent` directory.

## 2. Install dependencies

```bash
uv sync
```

## 3. Configure the endpoints

Export these variables in the terminal where you will start the agent. Replace
the model name and endpoint URLs if your servers use different values.

```bash
export MCP_SSE_URL="http://localhost:8000/sse"
export LLM_API_BASE="http://localhost:9931/v1"
export LLM_MAX_TOKENS="4096"
```

These are the current code defaults. Use your endpoint's API key if authentication
is required; `dummy-key` is only for local servers that do not require one.

Check that the model server is reachable and that the requested model is listed:

```bash
curl --fail --show-error \
  -H "Authorization: Bearer $LLM_API_KEY" \
  "$LLM_API_BASE/models"
```

Listing models checks connectivity, not image-input or JSON-mode support.

## 4. Start continuous monitoring

```bash
uv run python main.py --agent dmt_operator --continuous --interval 15
```

Press `Ctrl+C` to stop. In the running TUI, use `contained` to list contained
devices and `help` for commands. Use `clear <hostname>` only after reviewing a
contained device; it clears the agent's containment tracking.

## 5. Alternative: start the REST API

Run this instead of the TUI monitor:

```bash
uv run dmt-operator-api
```

- Health check: <http://localhost:8100/health>
- Device status: <http://localhost:8100/devices>
- Interactive API documentation: <http://localhost:8100/docs>

The API starts background monitoring of all registered devices. It binds to
`0.0.0.0:8100` by default; restrict network access appropriately.

## Results

- Incident PDF reports are written to [reports/](./reports/) when recovery is
  verified or a device is contained.
- [captures/](./captures/) holds temporary screen evidence that the agent cleans
  up as audits and reports complete.
- `UNKNOWN` means screen analysis could not determine the device state. It is
  not a healthy result or proof of successful recovery.
- `OFFLINE` means no screen frame was retrieved.
- Ransomware detection triggers power-off containment, not a reboot.

## Troubleshooting vision responses

If you see `Expecting value: line 1 column 1 (char 0)`, the model returned empty
or non-JSON text. Restart the agent after changing configuration.

1. Run with `--verbose` and inspect the VLM warning and response metadata.
2. Confirm that `LLM_MODEL` matches the served vision model and that the server
   supports both images and JSON mode.
3. If the warning says the response reached `LLM_MAX_TOKENS`, increase the budget:

   ```bash
   export LLM_MAX_TOKENS="8192"
   uv run python main.py --agent dmt_operator --device host.local --verbose
   ```

4. If replies are still empty, check the model server's vision configuration,
   chat template, and reasoning settings. Reasoning can consume the output budget
   before the final JSON answer is produced.

Failed analysis returns `UNKNOWN` with zero confidence and does not trigger a
power action by itself. Critical hardware events or explicit forced remediation
can still trigger an action.

See the [README](./README.md) for architecture, API routes, and detailed behavior.
