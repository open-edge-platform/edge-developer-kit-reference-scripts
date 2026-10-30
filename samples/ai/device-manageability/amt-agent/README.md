<!-- Copyright (C) 2025 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# DMT Operator Agent — Autonomous Intel AMT / DMT Site Operator

An extensible Python framework for building and running autonomous SRE / hardware-management agents. The shipped agent, **`dmt_operator`**, continuously audits Intel AMT (DMT) managed endpoints **out-of-band**, diagnoses failures with a multimodal Vision-Language Model (screen vision) plus System Event Log (SEL) analysis, self-heals devices with out-of-band power actions, and produces enterprise PDF incident reports.

This project is an MCP **client/consumer**: it drives the tools exposed by the sibling [`amt-mcp-server`](../amt-mcp-server/README.md) (Intel AMT / DMT device management over SSE) and additionally exposes its own **FastAPI control/status API** for external tooling and dashboards.

---

## Quick Start

For a standalone walkthrough, see [QUICK-START.md](./QUICK-START.md).

### 1. Prerequisites

- **Python ≥ 3.12** and [Astral `uv`](https://docs.astral.sh/uv/)
- The sibling [`amt-mcp-server`](../amt-mcp-server/README.md) running and reachable (default `http://localhost:8000/sse`)
- An **OpenAI-compatible vision LLM endpoint** for screen diagnostics (e.g. llama.cpp / vLLM serving a multimodal model)

### 2. Install dependencies

```bash
uv sync
```

### 3. Configure endpoints (optional — defaults shown)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `MCP_SSE_URL` | `http://localhost:8000/sse` | SSE endpoint of the `amt-mcp-server` |
| `LLM_API_BASE` | `http://localhost:8080/v1` | Base URL of an OpenAI-compatible endpoint (vision model) |
| `LLM_API_KEY` | `dummy-key` | API key sent to the LLM endpoint (unused by most local servers) |
| `LLM_MODEL` | `unsloth/gemma-4-26B-A4B-it-GGUF` | Model name requested from the endpoint |
| `LLM_MAX_TOKENS` | `4096` | Maximum completion tokens per screen analysis, including reasoning tokens on servers that count them |

Other built-in defaults (`DMTOperatorConfig`): control API `0.0.0.0:8100`, background monitor interval 15 s, MCP request timeout 30 s (+20 s headroom for screen captures).

> **Note:** the agent starts without a vision endpoint, but failed screen analyses return `UNKNOWN` with zero confidence and are not considered healthy or proof of successful recovery. An analysis failure alone does not trigger power remediation; critical SEL events and explicit forced remediation still apply.

#### Troubleshooting VLM JSON errors

`Expecting value: line 1 column 1 (char 0)` means the model reply was empty or did not start with valid JSON. It does not indicate a screenshot JSON problem.

- The vision endpoint must support OpenAI-compatible JSON mode (`response_format: {"type": "json_object"}`) and image inputs.
- If a warning reports `finish_reason=length` or that the response reached `LLM_MAX_TOKENS`, increase the budget, for example `LLM_MAX_TOKENS=8192 uv run python main.py --agent dmt_operator`. Reasoning models can consume the budget before producing their final JSON answer.
- For empty or non-JSON replies, check the server's vision support, chat template, and reasoning settings. Ensure `LLM_MODEL` matches the model served by the endpoint.
- Run with `--verbose` to log the model, finish reason, response character count, and token usage. Screenshots and response contents are not included in these diagnostics.

### 4. Run your first audit (single pass)

```bash
uv run python main.py --agent dmt_operator
```

You get a rich status table: one row per registered device with screen state, health, remediation action, and a clickable link to any generated PDF report.

### 5. Continuous monitoring

```bash
uv run python main.py -a dmt_operator -c -i 15    # 15 s cycles
# equivalent:
uv run dmt-operator-agent -c -i 15
```

### 6. Or run the REST control API instead of the TUI

```bash
uv run dmt-operator-api    # http://localhost:8100 — interactive docs at /docs
```

Endpoints are listed under [Control / Status API](#control--status-api) below.

---

## How It Works

Each monitoring cycle (default every **15 s**) runs `audit_device()` for every registered endpoint through the `OperatorEngine` state machine.

Key behaviors verified in `engine.py`:

- **Recovery tracking is asynchronous**: an incident opens an `ActiveRecoveryContext`; subsequent cycles re-capture the screen and check whether the OS reached `NORMAL_DESKTOP` / `LOGIN_SCREEN` (or `is_fully_booted`). Boot progress is tracked indefinitely across cycles rather than with fixed wait times.
- **Ransomware is contained, never rebooted**: a `RANSOMWARE` screen triggers an immediate out-of-band `power_off`; the device is marked **contained** and stays non-operational until an operator clears it (`clear <hostname>` in the TUI, or the REST endpoint).
- **Offline devices are never "fixed" blindly**: if no screen frame is returned (`OFFLINE`) or AMT reports the unit is powered off, remediation is skipped — a power action cannot be delivered out-of-band to an unreachable device.
- **BLACK_SCREEN is disambiguated** with a live AMT power-state probe → `BLACK_SCREEN (POWERED OFF)` vs `BLACK_SCREEN (HUNG)`.
- **Evidence hygiene**: screen captures are kept only long enough to embed in the PDF report, then deleted. Resolved incidents also log a JSON record back to the MCP server (`dmt_log_incident`, `<incident-id>.json`).
- **SEL diagnostics**: `SELAnalyzer` classifies AMT event-log entries as CRITICAL (watchdog, thermal trip, ECC, bus error, hardware reset, …) or WARNING (fan, voltage, degraded, …); critical events alone are enough to trigger remediation.

### Health states shown by the TUI / API

| State | Meaning |
| :--- | :--- |
| `OPERATIONAL` | Healthy — normal desktop/login, no critical SEL events |
| `OFFLINE` | No screen frame retrievable; device unreachable out-of-band |
| `CONTAINED` | Deliberately powered off (ransomware containment) pending review |
| `REBOOTING` / `BOOTING (…)` | Remediation applied, boot sequence being tracked |
| `RESOLVED` | Recovery verified; PDF incident report generated |
| `ANOMALY` / `FAULT` | Crash screen (BSOD/recovery), hang, or critical hardware events |

---

## Architecture

```
amt-agent/
├── src/
│   ├── agentic_framework/             # Core shared framework
│   │   ├── base.py                    # BaseAgent ABC — setup/step/shutdown lifecycle,
│   │   │                              #   continuous loop, SIGINT/SIGTERM handling, rich logging
│   │   ├── config.py                  # FrameworkBaseConfig — paths, MCP + LLM settings (env-driven)
│   │   ├── mcp_client.py              # Async JSON-RPC over SSE MCP client (custom, no SDK)
│   │   └── registry.py                # @register_agent decorator + auto-discovery of src/ packages
│   │
│   └── dmt_operator_agent/            # Intel AMT / DMT Site Operator Agent
│       ├── agent.py                   # DMTOperatorAgent — TUI monitoring loop + stdin commands
│       ├── api.py                     # FastAPI control/status API (background monitor + REST)
│       ├── config.py                  # DMTOperatorConfig — poll interval, API port, recovery timings
│       ├── engine.py                  # OperatorEngine — audit/remediation/recovery/containment state machine
│       ├── reporting.py               # IncidentPDFGenerator — single-page PDF reports (reportlab)
│       ├── sel_analyzer.py            # SELAnalyzer — AMT System Event Log parser/classifier
│       └── vlm.py                     # VLMAnalyzer — OpenAI-compatible vision model screen diagnostics
│
├── main.py                            # Framework CLI launcher & agent dispatcher
├── captures/                          # Temporary incident screen captures (auto-cleaned)
└── reports/                           # Generated PDF incident reports (+ JSON sidecars)
```

### Framework layer (`agentic_framework`)

- **`BaseAgent`** — abstract lifecycle (`setup()` → repeated `step(cycle)` → `shutdown()`), continuous-mode loop with `interval` sleep, graceful SIGINT/SIGTERM shutdown, rich-based logging setup.
- **`MCPClient`** — hand-rolled async MCP client: opens the SSE stream, discovers the POST endpoint, performs `initialize` / `notifications/initialized` (protocol `2024-11-05`), then `tools/call` with per-request timeouts. Adds DMT convenience wrappers: `get_all_devices`, `get_system_info`, `capture_screen` (downloads the image the server returns by path or URL), `get_event_log`, `remediate_device`, `log_incident`.
- **`registry.py`** — `@register_agent("name")` decorator + `discover_agents()` which imports every sibling package under `src/`, so new agents are picked up automatically.

### Operator layer (`dmt_operator_agent`)

- **`VLMAnalyzer`** (`vlm.py`) — sends the captured screen PNG to an OpenAI-compatible vision endpoint and gets back a structured `ScreenAnalysisResult`: `screen_state` (`NORMAL_DESKTOP`, `LOGIN_SCREEN`, `BOOTING_STAGE`, `BIOS_POST`, `BLACK_SCREEN`, `BSOD_CRASH`, `RECOVERY_SCREEN`, `RANSOMWARE`, `UNKNOWN`), `is_fully_booted`, `stop_code`, `failing_module`, `recommended_action`, confidence and summary.
- **`SELAnalyzer`** (`sel_analyzer.py`) — normalizes AMT event-log payloads (dict/list/`result.records` shapes) and keyword-classifies severity.
- **`OperatorEngine`** (`engine.py`) — the decision state machine described above; owns `_active_recoveries` and `_contained_devices`.
- **`IncidentPDFGenerator`** (`reporting.py`) — single-page letter-size PDF: incident ID, device GUID/hostname, crash + recovery screenshots, stop code / failing module, SEL critical events, remediation timeline, recovery status.
- **`api.py`** — FastAPI app with a lifespan-managed MCP connection and a **background monitor task** that audits all devices every `poll_interval_seconds`, caching the latest result per hostname for the REST endpoints.

---

## Usage

### CLI launcher (`main.py`)

```bash
uv run python main.py --list-agents                    # discover registered agents
uv run python main.py --agent dmt_operator             # single audit pass
uv run python main.py -a dmt_operator -c -i 15         # continuous monitoring, 15 s cycles
uv run python main.py -a dmt_operator -d host.local    # target one device
uv run python main.py --verbose                        # debug logging
```

Flags: `--agent/-a` (default `dmt_operator`), `--list-agents/-l`, `--continuous/-c`, `--interval/-i` (default 15), `--device/-d`, `--verbose/-v`. Unknown flags are ignored; only constructor params an agent accepts are forwarded.

### Installed console scripts (`pyproject.toml`)

```bash
uv run dmt-operator-agent --continuous --interval 30   # agent TUI directly
uv run dmt-operator-api                                # FastAPI control API (uvicorn, port 8100)
```

### TUI commands (agent mode)

While the TUI agent runs, type commands on stdin:

- `clear <hostname>` — lift containment on a powered-off (contained) device after forensic review
- `contained` — list devices currently under containment
- `help` — show commands

Report paths in the results table are clickable OSC-8 hyperlinks in terminals that support them.

---

## Control / Status API

```bash
uv run dmt-operator-api
```

JSON API at `http://localhost:8100/` (OpenAPI docs at `/docs`). A background task audits **all** devices every 15 s; the endpoints below read the cache or act immediately.

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Liveness probe |
| `GET` | `/devices` | Registered devices with last audit status, containment flag, monitor cycles completed |
| `GET` | `/devices/{hostname}/status` | Last cached audit result for one device |
| `POST` | `/devices/{hostname}/audit` | Trigger a fresh audit (`?force_remediation=true` to force action) |
| `POST` | `/devices/{hostname}/remediate` | Out-of-band action: `power_cycle`, `reset`, `boot_to_bios`, `boot_to_pxe`, `power_off`, `power_on` (`power_off` also marks the device contained) |
| `POST` | `/devices/{hostname}/clear-containment` | Manually lift containment after review |
| `GET` | `/reports` | List generated PDF incident reports (+ JSON sidecars) |
| `GET` | `/reports/{filename}` | View/download a specific PDF inline |

---

## Incident Reports

Every resolved or contained incident produces:

- `reports/INCIDENT_<INC-id>_<timestamp>.pdf` — single-page evidence report: crash screenshot, recovery screenshot, VLM diagnosis (stop code, failing module), critical SEL events, remediation timeline, recovery status.
- A JSON incident record logged to the MCP server (`dmt_log_incident`, filename `<INC-id>.json`).

Incident IDs look like `INC-20261020-A1B2C3`.

---

## Testing

```bash
uv sync --group test
uv run --group test pytest tests/ -v
```

The suite mocks all I/O (OpenAI-compatible vision endpoint, MCP client,
filesystem) and needs no running MCP server, LLM endpoint, or Intel AMT/DMT
hardware. See [tests/README.md](./tests/README.md) for what each test file
covers and its documented scope limitations.

---

## Adding a New Agent

1. Create `src/<your_agent_pkg>/` — `discover_agents()` imports it automatically.
2. Subclass `BaseAgent` and register it:

```python
from agentic_framework.base import BaseAgent
from agentic_framework.registry import register_agent

@register_agent("network_security")
class NetworkSecurityAgent(BaseAgent):
    def __init__(self, continuous=False, interval=15, **kwargs):
        super().__init__(name="network_security", description="Network Anomaly Agent",
                         continuous=continuous, interval=interval)

    async def setup(self):
        # e.g. self.mcp = MCPClient(framework_config.mcp_sse_url); await self.mcp.connect()
        pass

    async def step(self, cycle_num: int):
        # one monitoring pass
        pass

    async def shutdown(self):
        pass
```

3. Launch it: `uv run python main.py --agent network_security`

Reuse the shared pieces freely: `framework_config` (paths, MCP URL, LLM settings), `MCPClient` (including the DMT tool wrappers), and the PDF/SEL/VLM modules under `dmt_operator_agent` as reference implementations.
