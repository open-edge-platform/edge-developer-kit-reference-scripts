---
name: configure-peripherals
description: Swap, add, mock or troubleshoot the kiosk's hardware peripherals — NFC/ID card readers, document scanners (SANE), camera, speech devices. Use when asked to support a different reader or scanner model, run without hardware, add a scanner status profile, wire a new peripheral driver, or diagnose "no reader / nothing scanned / device unreachable".
---

# Configuring & extending peripherals

The peripheral layer lives in `public-service-kiosk/frontend/src/app/api/_lib/peripherals/`
(contract: `types.ts`; driver selection: `policy.ts`; health:
`registry.ts`; scanner models: `scanner-profiles.ts`). The drivers
themselves are `_lib/nfc.ts` (PC/SC) and `_lib/scanner.ts` (SANE).
Reference tables: `common/docs/configuration.md` §Hardware.

**The design invariant — keep it or you'll break trust in the kiosk:**
every failure knows whether the hardware actually ran
(`PeripheralError.attempted`). A failure the device never attempted
(no bindings, no daemon, no device) may be stood in for under
`simulate: auto`; a failure the device *answered* with (empty feeder, card
that won't read) must NEVER be — a stand-in there accepts paperwork nobody
presented. Mock results always carry `simulated: true` on the wire.

## Decision tree

**Just different hardware of a supported kind → config only, no code.**

```yaml
nfc:
  driver: pcsc            # or "mock" to never touch hardware
  reader: <substring of the driver name — `npm run nfc:probe` prints it>
  gesture: insert|tap     # what the citizen is told to do (NEXT_PUBLIC, build-baked)
  uid_command: FFCA000000 # change only for a reader wanting a different APDU
  simulate: never         # always "never" once real hardware is attached!
documents:
  source: scanner         # upload | scanner | mock (NEXT_PUBLIC, build-baked)
  scanner:
    driver: sane          # or "mock"
    profile: fi-800r      # or "none" — see below
    device: <scanimage -L id>
    mode/source/args:     # ONLY options this backend accepts (scanimage -d <dev> -A);
                          # an unknown option fails the whole scan
    simulate: never
```

Profiles `configs/hardware.yaml` (strict, nothing simulated) and
`configs/simulated.yaml` (no hardware at all) are complete working presets —
select with `KIOSK_CONFIG_FILE=`. Driver-free scanner testing: SANE's
virtual backend, `device: test:0` + `profile: none` (comment out
mode/source/args — they are fi-800R spellings).

**A different scanner model → add a status profile (small code change).**
The scan itself is already generic SANE; only "how does it say paper is
loaded" is per-model. In `peripherals/scanner-profiles.ts` add a
`ScannerStatusProfile` — the status tool's name, its status-word bits, and
`documentLoaded()` (mind quirks: the fi-800R keeps its chute-empty bit set
while loaded) — register it in `PROFILES`, document the value in
`configs/reference.yaml` + `common/docs/configuration.md`. No status tool at all →
`profile: none` already does the right thing (scan immediately; the scan is
the check).

**A genuinely new driver (different transport, e.g. a network scanner or a
different card-reader stack) → implement the module, register the id.**

1. Model it on the existing pair: typed result, failures as
   `PeripheralError` subclasses with honest `attempted` flags, config read
   **per call** (never `const X = process.env…` at module load — see the
   note in `peripherals/policy.ts`).
2. Add the driver id to `policy.ts` (`NfcDriverId`/`ScannerDriverId` and the
   parser), branch on it where the capture functions run
   (`_lib/nfc.ts` `readCardUid` / `_lib/scanner.ts` `captureDocument`), and
   give it a health answer in `peripherals/registry.ts`.
3. Native Node addons must be added to `serverExternalPackages` in
   `next.config.ts` (like `pcsc-mini`/`pdfkit`), and installed as an
   `optionalDependency` if not every platform has prebuilds.
4. New config keys go in THREE places or they silently don't exist:
   `configs/reference.yaml` (the committed, documented file — `config.yaml`
   itself is a gitignored per-install copy of it), the `SETTINGS` tree in
   `src/lib/kiosk-config.ts`, and `common/docs/configuration.md`.

**A new peripheral kind (printer, barcode…):** same recipe; also add its
`kind` to `PeripheralDriver`, an entry in `/api/health`
(`app/api/health/route.ts` — report-only, never flips `ok`), and its
failure copy to the country pack's message catalog if the citizen sees it.

## Simulation semantics (don't reinvent)

`simulate: auto|always|never` per peripheral; `driver: mock` ≡ `always`.
Under `auto`, only `attempted: false` failures fall back. `shouldStandIn()`
in `peripherals/types.ts` is the single decision point — route new failure
paths through it.

## Verify

```bash
cd public-service-kiosk/frontend && npx tsc --noEmit && KIOSK_CONFIG_FILE=<profile> npx next build
curl -s 127.0.0.1:3000/api/health          # nfc/scanner: ok | off | unreachable
curl -s 127.0.0.1:3000/api/identity/document   # end-to-end read (simulates per policy)
curl -s "127.0.0.1:3000/api/identity/card?timeout=0"  # bench route — NEVER simulates
npm run nfc:probe                          # raw PC/SC probe, prints reader + UID
```

With real hardware attached, set `simulate: never` and test the failure
paths too (pull the card early, empty feeder) — the citizen-facing copy for
each failure is what you're actually shipping. Remember `documents.source`
and `nfc.gesture` are baked at build time: a packaged kiosk needs a rebuild
to switch capture source.
