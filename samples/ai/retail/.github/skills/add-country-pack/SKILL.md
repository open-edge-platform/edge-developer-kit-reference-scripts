---
name: add-country-pack
description: Add a new country/language to the Vertical Reference Solutions Blueprint as a country pack (e.g. Vietnam/Vietnamese), or extend an existing pack's language coverage. Use when asked to support a new country, translate the kiosk, add a language, localize copy/prompts/speech, or change what the national ID document is called.
---

# Adding a country pack

A country pack owns everything country-shaped: the identity documents and
their names, on-screen and spoken copy, LLM prompt variables, the
speech-recognition vocabulary, locale formatting and
the service catalog itself. The shipped reference is
`public-service-kiosk/frontend/src/packs/malaysia/` — **copy its shape, never edit its content
for another country**. Background: `common/docs/country-packs.md`, `common/docs/i18n.md`.

All paths below are relative to `public-service-kiosk/frontend/`.

## Hard rules

- **Never edit Malaysia's strings** to make another country work. Its
  English values are byte-pinned by `tests/api/*.spec.ts` and by the agent
  prompts. A new country is a new directory.
- Pack modules must stay **client-safe pure data** — no registry fetches,
  no React components, no Node APIs — with two exceptions that are wired
  separately: `steps.tsx` (client components) and `chains.ts` (server-only).
- The pack id is lowercase, one word (`vietnam`), and must match everywhere
  it is registered.

## Steps

### 1. Scaffold `src/packs/<id>/`

Copy the file set from `malaysia/` and rewrite content:

- **`pack.ts`** — the `CountryPack` (contract in `src/packs/types.ts`):
  - `countries`: the citizen countries the registry enrols (first entry is
    the enrolment default).
  - `idDocuments`: `forCountry()` → `"mykad" | "passport"` today. If the
    country's card needs its own type id, extend `PackIdDocument` in
    `src/packs/types.ts` AND `IdentityDocumentType` in `src/lib/api/kiosk.ts`,
    then follow the compiler.
  - `locale`: BCP-47 `language` (`"vi"`), Intl locales and `currency`
    (ISO 4217).
  - `formatAddress`: the country's address line order.
  - `promptVars`: `country_adjective` ("Vietnamese"), `id_document`
    (the card's name), `language_instruction` — a non-English pack MUST set
    e.g. `"\nAlways reply in Vietnamese."` or the assistant answers in
    English.
- **`messages.ts`** — translate every key. `MessageKey` derives from
  Malaysia's catalog, so a missing key is a compile error. Keep `{{where}}`
  and any other `{{var}}` placeholders intact.
- **`speech.ts`** — the STT repair vocabulary
  (`Canonical=alias|alias;…` — what the recogniser mishears local terms as)
  and the transcript-repair prompt intro + worked examples, in the pack's
  language.
- **`catalog.ts`, `steps.tsx`, `chains.ts`** — copy Malaysia's three files
  verbatim except the import list in `chains.ts`; they discover this pack's
  own `services/` tree. Never point a `require.context` at another pack's
  directory (Turbopack dedupes contexts on the same dir).
- **`services/`** — the services this country offers. Per service see the
  `add-kiosk-service` skill. Do not copy Malaysian services wholesale: fees,
  agencies and eligibility law are the country's own.

### 2. Register the pack (4 one-line spots)

1. `src/packs/index.ts` — add to `PACKS`.
2. `src/services/catalog.ts` — add its catalog to `CATALOGS`.
3. `src/services/registry.tsx` — add its `packStep` to `PACK_STEPS`.
4. `src/packs/index.server.ts` — add its chains to `CHAINS`.

### 3. Data and config

- Seed registry: a citizens CSV for the country (`cms.citizens_csv`,
  format in `data/citizens.csv`) — or enrol via `/enroll`.
- Mock documents: `documents.mocks_dir` pointing at stand-ins in that
  country's paperwork (Malaysia's are drawn in
  `src/packs/malaysia/mock-documents.mjs` and written by
  `scripts/gen-mock-docs.mjs`; a new country needs its own module or
  hand-made PDFs, one folder per citizen with `good/` and `false/` sets).
- `configs/reference.yaml`, the committed documented config (and your own
  gitignored `config.yaml` copy) — or a `configs/<country>.yaml` profile:

```yaml
country: { pack: vietnam }
locale:
  language: vi
  money_locale: vi-VN
  date_locale: vi-VN
  clock_locale: vi-VN
  currency: VND
voice:
  tts: { voice: <a voice the TTS worker has for this language> }
```

The recognizer detects the spoken language itself (`voice.stt.language: auto`). Fonts already load the
`vietnamese` subset; another script means adding it (literally) to the two
`next/font` calls in `src/app/(kiosk)/layout.tsx`.

A chat terminal that should also *follow speakers of other languages* at
runtime (replies and narration voice — not the UI chrome) lists them
under `voice.languages` — see common/docs/i18n.md § Spoken-language detection.

### 4. Known cut-line (tell the user, don't silently fix)

Still English/Malaysia-shaped by design: generic shell strings ("Back",
"Processing…"), the staff desk and Payload admin, registry domain fields
(license classes, race/religion enums, `src/lib/road-tax.ts`), and
`plural()`/`countOf()` (English morphology — write full phrases in the
catalog instead). If the new country needs different registry schemas,
that's a Payload collections change, not a pack change.

## Verify

```bash
cd public-service-kiosk/frontend
npx tsc --noEmit                     # catches missing MessageKeys & registrations
KIOSK_CONFIG_FILE=<profile> npx next build
```

Then run it (see the `run-vertical-reference-solutions-blueprint` skill — production build, not
dev) with the new pack selected and click through: welcome copy, a chat
turn in the new language routing to a service via the keyword tables, the
reader instructions naming the right document, money/date formats.
`NEXT_PUBLIC_KIOSK_PACK` is **baked at build time** — rebuilding is required
after switching packs; a wrong pack id throws at startup with the known ids.

Regression: Malaysia must be untouched —
`KIOSK_CONFIG_FILE=configs/simulated.yaml npx playwright test tests/api`
(needs the Edge AI Studio gateway live; without it, at minimum diff the
briefing/prompts as in the docs and smoke-test with curl).
