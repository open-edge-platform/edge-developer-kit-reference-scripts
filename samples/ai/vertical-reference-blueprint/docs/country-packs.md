# Country packs

Everything about the kiosk that belongs to a country rather than to the
machine lives in a **country pack** under `frontend/src/packs/<pack>/`. The
shipped pack is `malaysia`; a second country is a new directory beside it
plus a handful of one-line registrations — no changes to the flow engine,
the peripherals, or the screens.

Select the pack with `country.pack` in `config.yaml`
(`NEXT_PUBLIC_KIOSK_PACK`). Like `terminal.mode`, it is **baked in at build
time**: a packaged kiosk serves one country, and switching means rebuilding.

## What a pack owns

```
frontend/src/packs/<pack>/
  pack.ts        CountryPack: countries, id documents, locale, formatAddress,
                 prompt vars — plus the modules below
  messages.ts    every UI/flow string another country would say differently
  speech.ts      STT repair vocabulary + transcript-repair prompt examples
  nlu.ts         keyword router tables (service synonyms, "my requests"
                 phrases), phonetic hints and routing examples
  catalog.ts     folder discovery over services/ (categories, groups, services)
  steps.tsx      folder discovery of custom step screens in services/
  chains.ts      static imports of every service's chain.ts (server-only)
  services/      the service tree:
    <category>/category.ts
    <category>/<group>/group.ts
    <category>/<group>/<service>/service.ts    declarative definition + fields
    <category>/<group>/<service>/chain.ts      flow planner (server-only)
    <category>/<group>/<service>/steps/*.tsx   custom touch screens (optional)
```

A service is defined **once**, in its own directory:

- `service.ts` — label, fee/pricing, documents, flow, and `fields` (the
  application answers it collects, as the agent briefing describes them).
  The single-turn agent briefing is **derived** from this
  (`api/_lib/service-briefing.ts`); there is no separate briefing table to
  keep in sync.
- `chain.ts` — the flow planner (`ChainSpec`): eligibility gates and runtime
  asks built from registry facts. Server-only; it is reachable only through
  the pack's `chains.ts` and `src/packs/index.server.ts`, never from client
  code.
- `steps/*.tsx` — touch-kiosk screens that override the shared ones in
  `src/services/shared/steps/`.

## Registration points

Pack discovery is deliberately static (Turbopack dedupes `require.context`
calls on the same directory, and the client and server bundles must agree),
so a new pack is registered by hand in four places:

1. `src/packs/index.ts` — add it to `PACKS` (messages, locale, speech, NLU).
2. `src/services/catalog.ts` — add its `catalog.ts` to `CATALOGS`.
3. `src/services/registry.tsx` — add its `steps.tsx` to `PACK_STEPS`.
4. `src/packs/index.server.ts` — add its `chains.ts` to `CHAINS`.

Every entry is one import plus one record line; TypeScript flags a pack
whose message catalog misses a key (`MessageKey` derives from the Malaysia
catalog).

## Adding a country (e.g. Vietnam) — checklist

1. `src/packs/vietnam/` with `pack.ts`: `countries`, `idDocuments`
   (which document a citizen presents, and what the card is called),
   `locale` (`language: "vi"`, Intl locales, `currency: "VND"`,
   `minKeywordWordLength: 2` — Vietnamese words are short),
   `formatAddress`, `promptVars` (`country_adjective`, `id_document`, and a
   `language_instruction` such as `"\nAlways reply in Vietnamese."`).
2. `messages.ts` covering every `MessageKey`, `speech.ts` (Vietnamese STT
   vocabulary), `nlu.ts` (Vietnamese keywords).
3. A `services/` tree for the services that country actually offers, each
   with `service.ts` + `chain.ts` (+ custom steps if needed), and the pack's
   `catalog.ts`/`steps.tsx`/`chains.ts` (copy Malaysia's three files and
   change the import list).
4. The four registrations above.
5. Config: `country.pack: vietnam`, `locale:` block, plus per-country data —
   `cms.citizens_csv` (seed registry) and `documents.mocks_dir` (stand-in
   documents; see `frontend/scripts/gen-mock-docs.mjs` for how Malaysia's
   were generated).
6. Fonts already load the `vietnamese` subset (see `(kiosk)/layout.tsx`);
   voice needs a Vietnamese-capable STT/TTS worker (`voice.stt.language`
   is `locale.language` by default; pick a suitable `voice.tts.voice`).

What is **not** yet pack-driven (known cut-line, see `docs/i18n.md`):
generic shell strings ("Back", "Processing…"), the staff enrolment desk,
Payload admin copy, and the registry's domain fields
(`payload/collections/` — license classes, race/religion, road-tax bands in
`src/lib/road-tax.ts`). A pack whose services need different registry
schemas extends the collections rather than the pack.

## Peripherals are configuration, not pack content

Which reader or scanner a terminal has is an install fact, not a country
fact — see `nfc.driver`, `documents.scanner.driver` and
`documents.scanner.profile` in `config.yaml`, and
`src/app/api/_lib/peripherals/` for the driver contract (a new scanner
model is a new `ScannerStatusProfile`, not a fork of the driver).
