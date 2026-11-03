---
name: add-kiosk-service
description: Add, change or remove a public service in the Vertical Reference Solutions Blueprint's catalog (a new application/payment/registration flow with its fees, documents, eligibility rules and screens). Use when asked to add a service, change a service's fees/documents/questions/eligibility, or retire one.
---

# Adding or changing a kiosk service

A service lives in ONE directory inside a country pack:

```
public-service-kiosk/frontend/src/packs/<pack>/services/<category>/<group>/<service>/
  service.ts    declarative definition (all three kiosks read it)
  chain.ts      guided-flow planner (the chat agent, over MCP; server-only)
  steps/*.tsx   custom touch screens (optional)
```

The touch catalog and step screens are folder-discovered — no registration.
The ONE registration a service needs: an import line in the pack's
`chains.ts` (only if it has a `chain.ts`). The agent briefing is generated
from `service.ts`, so there is no third copy to write.

Study one complete example before writing:
`packs/malaysia/services/transport-licensing/vehicle-traffic-services/vehicle-registration-renewal-road-tax/`
(dynamic fees + registry gates) or `…/traffic-fine-payment/` (lookup
before identity, repeatable). Types: `src/services/types.ts`
(`ServiceDefinition`, `FieldSpec`, `DocumentRequirement`),
`app/api/_lib/flows/types.ts` (`ChainSpec`, `Ask`, `ApplicationPlan`).

## 1. `service.ts`

Exports `service: ServiceDefinition`:

- `id` — short snake/lowercase, unique across the pack; it is the flow-data
  and MCP service key everywhere.
- `fee` + optional `pricing: { field, rates }` (fee override keyed on an
  application answer). Computed fees (per-cc, per-year…) are done in the
  registry/chain instead — see how roadtax does it.
- `documents` — use `PROOF_OF_IDENTITY` / `supportingDocument()` from
  `src/services/shared/flow.ts`. Per requirement: `accepts` (each
  alternative paperwork named separately — a compound label makes the
  verifier refuse everything), `holderDetails` (only details that paperwork
  actually prints), `holderRole` for documents naming several people.
- `flow` — ordered step ids. Shared steps: consent, identity, documents,
  payment, receipt (+ details, service). Anything else needs a
  `steps/<id>.tsx`.
- `fields` — one `{ id, briefing }` per application answer, phrased for the
  agent ("plate — the vehicle to renew, one of the citizen's …-registered
  plates (picked automatically when they own exactly one)"). Enumerable
  values belong in the briefing text. `briefingNotes` for service-level
  caveats. **This is what the single-turn agent knows about the service —
  keep it in lockstep with chain.ts.** Healthcare only: `ahead: true` marks
  a field a patient says before the flow asks (a doctor's name, a day);
  start_service_flow takes it up front and the multi-turn agent is told
  about it too. The chain must act on such a value once: a single-turn
  agent repeats it on every call (see `slotRound` in `_lib/booking.ts`).

New category/group = `category.ts` / `group.ts` alongside (see neighbors).

## 2. `chain.ts` (if the flow has an `application` step)

Exports `chain: ChainSpec` — `application(ctx)` returns an
`ApplicationPlan` via the builders in `app/api/_lib/flows/plan.ts`
(`ask`/`halt`/`done`/`READY`), plus optional `finalize(ctx)` for derived
fields like `priceKey`. Registry lookups via `app/api/_lib/flows/bridge.ts`.
House rules, learned the hard way (see the existing planners' comments):

- Auto-answer single options (`vehicles.length === 1` → don't ask).
- Ask a lookup *method* on its own round, never alongside its *reference* —
  the method answer lands in the reference field otherwise.
- Validate free-text loosely and delete a rejected value from `ctx.data`
  so it can't resurface from the saved draft.
- Question/say text is relayed to the citizen verbatim — write it for
  speech, currency via `formatMoney(x, CURRENCY)` (never a literal), and
  eligibility refusals as `halt()` with the reason and where to go instead.
- Mirror the touch step exactly: same gates, same options, same fees.

Register it: one import + one record line in the pack's `chains.ts`.
No application step → no chain.ts needed (see the address service).

## 3. `steps/application.tsx` (custom touch screens)

Default-export a component taking `StepProps`
(`src/services/shared/step-props.ts`); build with the `shared/fields` kit
(`TextField`, `OptionCards`, `SectionLabel`, `ListHeading`) and `StepShell`;
finish with `actions.stepCompleted("<step-id>", data)`. Wrap registry reads
in `shared/lookup`'s `LookupGate` (spinner/retry triage); render eligibility
dead-ends with `StatusStep` from `shared/step-shell`. A file named like a
shared step overrides it for this service only.

## 4. Make the assistant find it

Nothing to register: the chat agent's briefing lists every service's id,
label and description from `service.ts`. Write the `description` the way a
citizen would ask for it — that line is all the model has to recognise
"I need to …" as this service.

## 5. Data & removal

If the flow needs registry rows (vehicles, licenses…), extend
`payload/seed.ts` / the citizens CSV so demos have data; document
requirements need mock PDFs in `documents.mocks_dir` for simulated capture
(`src/packs/malaysia/mock-documents.mjs` draws them; `scripts/gen-mock-docs.mjs`
writes them and `/mock-documents` serves them).

Removing a service: delete the folder, its `chains.ts` line, and its test
spec.

## Verify

```bash
cd public-service-kiosk/frontend && npx tsc --noEmit && KIOSK_CONFIG_FILE=configs/simulated.yaml npx next build
```

Run it (production build — see `run-vertical-reference-solutions-blueprint`) and check all three
surfaces: the touch tile + full flow, a chat turn naming the service
(needs the live LLM), and `curl :3000/api/catalog` / the agent briefing listing
it. Add a `tests/api/<service>.spec.ts` modeled on a neighbor — the suite
pins each service's copy and gates, and needs the live AI gateway to run.
