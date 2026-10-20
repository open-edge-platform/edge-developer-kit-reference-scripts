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
public-service-kiosk/scripts/start.sh --mock   # http://localhost:3000, no AI gateway needed
common/scripts/dev/dev.sh --kiosk public-service --mock               # hot reload
```

Launcher flags, configuration and packaging: [common/README.md](../common/README.md)
and [common/docs/](../common/docs/).
