# Public Service Operational Efficiency Kiosk

The civic self-service kiosk: MyKad identity check, document capture and
AI-assisted flows for 10 government services (road tax, traffic fines, driving
licences, MyKad, police clearance, birth and marriage registration, welfare,
address change).

| Path | What |
|---|---|
| `frontend/` | The Next.js + Payload app; services under `frontend/src/packs/malaysia/services/` |
| `kiosk.json` | Product name, app id, desktop data folder, studio sample id and port |
| `deployment.json` | The Edge AI Studio services each terminal mode runs, with their model and devices |
| `scripts/` | `setup.sh` `start.sh` `uninstall.sh` (+ `_win.bat`): the `common/` launchers with this kiosk selected |

From the repository root:

```bash
public-service-kiosk/scripts/start.sh --mock   # http://127.0.0.1:3000, no AI gateway needed
common/scripts/dev/dev.sh --kiosk public-service --mock               # hot reload
```

Chat mode is agentic: a tool-calling model reads what the citizen says or taps
and drives the services through the kiosk's own MCP server (`/api/mcp`) — there
is no keyword routing. It needs a live model: under `--mock` the chat screen
only says so, so use touch mode there (the `simulated` profile starts in it).

The agent knows every service's steps and fields up front (`agent.turns:
single`), so one sentence goes a long way: "renew road tax for WXY 1234 for a
year" starts Road Tax Renewal with the plate and period, which wait through the
card and face scan and skip their questions; "pay my saman, then renew my road
tax" starts the fine and queues the road tax, which starts by itself when the
fine is done. Once the citizen has verified, the next service in the same chat
(**Something else**, or just asking) skips the card; **Finish & sign out**,
**Restart** or the idle reset ends it.

The assistant beside the conversation is the same lip-synced person as the
healthcare kiosk's: the studio's lipsync service (Wav2Lip) streams them over
WebRTC and says each reply a sentence or two at a time, in step with the lips.
If the stream cannot connect the tile says **Not connected** and replies play
from the page; with `voice.avatar` unset the conversation takes the whole
width. Settings: `voice.avatar`
([configuration.md](../common/docs/configuration.md#lip-synced-avatar-chat-mode));
`deployment.json` runs the lipsync service on the NPU in chat mode.

Launcher flags, configuration and packaging: [common/README.md](../common/README.md)
and [common/docs/](../common/docs/).
