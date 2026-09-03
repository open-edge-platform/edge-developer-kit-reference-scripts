# Kiosk profiles

These are the committed, complete operating presets. **`frontend/config.yaml`
itself is not committed** — it is this terminal's own copy of one of them, which
the launcher scripts create on the first run and never overwrite afterwards:

```bash
./setup.sh                      # copies reference.yaml -> ../config.yaml
./setup.sh --profile hardware   # copies hardware.yaml instead
```

`reference.yaml` is the documented default: every setting the kiosk has, with a
comment beside the value it sets. Read it as the configuration reference, and
edit `../config.yaml` (your copy of it) for the terminal in front of you.

`simulated.yaml` never accesses hardware or external AI workers. It provides
mock identity and documents, and accepts documents without verification.

`hardware.yaml` is strict: card-reader, scanner, OCR, face-recognition and LLM
failures stop the relevant kiosk action instead of falling back to a simulation.
Set its `nfc.reader`, scanner `device`, and secrets for the installed terminal.

A profile can also be run in place, without copying:

```bash
KIOSK_CONFIG_FILE=configs/simulated.yaml npm run dev
KIOSK_CONFIG_FILE=configs/hardware.yaml npm run dev
```

A profile is read *whole* — it is not layered over `../config.yaml`. The
`config.local.yaml` that merges on top is the one beside the **selected** file,
so for these it is `configs/config.local.yaml`. Environment variables still
override both.

None of the committed profiles carries `cms.admin_password`: the launchers
generate one into the gitignored `../config.yaml`, so no credential is ever
committed. A `KIOSK_CONFIG_FILE=` run therefore seeds no CMS admin user — put a
password in `configs/config.local.yaml` if you need `/admin` on one.

`cms.payload_secret` is blank for the same reason. It needs no launcher: the
first boot mints one into `.payload-secret` beside the database and reuses it
from then on, so every install signs its admin sessions with its own key.
