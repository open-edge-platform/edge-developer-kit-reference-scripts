---
applyTo: "**"
---

# Project Guidelines

## Overview

This is **Demo Studio** — an AI demo platform with a Next.js frontend that orchestrates Python-based AI worker services (embedding, speech-to-text, text-to-speech, image generation, etc.). The frontend manages service lifecycle, health monitoring, and provides interactive demo UIs for each AI capability.

---

## Part 1: Codebase Structure

### Monorepo Layout

- `frontend/` — Next.js 16 app (App Router) with Payload CMS (SQLite), React 19, TypeScript
- `workers/` — Standalone Python FastAPI services spawned as child processes by the frontend

### Frontend (`frontend/`)

- **App Router** with route groups: `(dashboard)/` for main UI, `(payload)/` for CMS admin, `api/` for route handlers
- **Payload CMS** (SQLite) manages service state (status, ports, models, health checks) as the source of truth
- **Engine system** (`src/engines/`) abstracts inference backends
- **Service registry** (`src/services/`) — convention-based auto-discovery. Each service lives in `src/services/<name>/` with `data.ts` + `demo.tsx`
- **Use case registry** (`src/samples/`) — same pattern, `data.ts` with `sample` export
- **Context providers** (`src/context/`): `ServiceStatusContext` (polls service state), `SettingsContext` (localStorage), `SystemInfoContext` (OS/device detection)
- **API proxying**: `next.config.ts` rewrites `/api/<service-name>/*` to worker `http://localhost:<port>/*`

### Workers (`workers/`)

- Each worker is a standalone **FastAPI** server started via **UV** package manager
- Frontend's `process-handler.ts` spawns workers as child processes with rotating log streams
- Workers expose REST endpoints (e.g., `/v1/stt/transcribe`, `/v1/embeddings`)
- Two execution modes: `"worker"` (standalone process) or `"multiserve"` (shared OpenVINO engine)

### Tech Stack

#### Frontend

- Next.js 16, React 19, TypeScript 5
- Tailwind CSS 4, shadcn/ui (New York style, lucide icons), Radix UI
- Payload CMS 3.x with SQLite
- Eslint linting/formatting
- React Compiler enabled (babel-plugin-react-compiler)
- TanStack React Query for data fetching

#### Workers

- Python 3.11+, FastAPI, Uvicorn
- UV as package manager (not pip)
- OpenVINO, PyTorch, HuggingFace ecosystem
- Per-worker `pyproject.toml` for dependencies

### Service Lifecycle

Status flow: `inactive` → `prepare` → `active` (or `error`), with `restart` as a transition state.

- Start/stop via `PATCH /api/services/[id]` with `{ action: "start" | "stop" | "restart" }`
- Payload hooks trigger process spawn/kill
- Health check service polls worker endpoints every 10 seconds with JSONata-based response validation
- `ServiceStatusContext` polls `/api/services` every 5 seconds for UI updates

### Key Files Reference

- `src/services/types.ts` — Core `Service`, `ServiceMeta`, `WorkerConfig` types
- `src/engines/types.ts` — `Engine`, `EngineBackend` types
- `src/lib/process-handler.ts` — Worker process lifecycle management
- `src/lib/healthcheck.ts` — Health polling with JSONata evaluation
- `src/lib/constants.ts` — Paths (`WORKER_DIR`, `MODELS_DIR`, `LOGS_DIR`, `UV_PATH`), allowed ports
- `src/payload/collections/Services.ts` — Payload CMS service schema and hooks
- `scripts/generate-registries.mjs` — Auto-discovery codegen script
- `src/services/_generated/` — Auto-generated registries (do not edit manually)
- `src/engines/_generated/` — Auto-generated engine registry (do not edit manually)
- `src/samples/_generated/` — Auto-generated sample registry (do not edit manually)

---

## Part 2: Development Guidelines

### Build & Development Commands

```bash
# Frontend
cd frontend
npm run dev          # Start dev server
npm run build        # Production build (stop dev server first — .next/lock conflict)
npm run codegen      # Regenerate service/sample/engine registries
npm run lint         # eslint check
npm run lint:fix     # eslint auto-fix
```

**Always run `npm run lint` before committing** to ensure code passes eslint checks. For a smooth development experience, install the recommended VS Code extensions when prompted (eslint, Tailwind CSS IntelliSense, Payload, etc.).

### TypeScript / React Conventions

- Use **Biome** rules: 2-space indentation, organized imports, no `console.*` (use `src/lib/logger.ts` instead)
- Path aliases: `@/*` maps to `src/*`, `@payload-config` maps to `src/payload.config.ts`
- Prefer Server Components by default (RSC enabled). Use `"use client"` only when needed for interactivity
- UI components go in `src/components/ui/` (shadcn primitives) or `src/components/dashboard/` (app-specific)
- Use `cn()` from `@/lib/utils` for conditional class merging (clsx + tailwind-merge)
- Service demo components receive `{ service: Service }` prop and use `DemoParameterSidebar` for controls
- Never import from `_generated/services.ts` in server config contexts — use `_generated/meta.ts` instead (it has no React dependencies)

### API Calls — TanStack Query

All API calls in the frontend **must** use TanStack React Query. Never fetch directly inside components.

- Wrap every API call in a dedicated hook (e.g., `useTranscribe`, `useEmbeddings`) that calls `useQuery` or `useMutation`
- Always handle all three states in the UI: loading, error, and success
- Co-locate the hook with the feature it belongs to (see Shared Code placement rules below)

```tsx
// ✅ correct — dedicated hook
export function useTranscribe(options?: UseMutationOptions) {
  return useMutation({
    mutationFn: (file: File) => fetch("/api/speech-to-text/v1/stt/transcribe", { ... }).then(r => r.json()),
    ...options,
  })
}

// ✅ correct — status handling in component
const { mutate, isPending, isError, data } = useTranscribe()
```

### Modularity & Dependency Rules

The codebase is divided into three first-class registries: **engines**, **services**, and **samples**. Respect the following dependency direction:

```
engines  ←  services  ←  samples
```

- **Samples** may import components, hooks, and types from **services**, but **services must never import from samples**
- **Services** may import from **engines**, but engines must never import from services or samples
- Cross-cutting violations (e.g., a service importing a sample hook) are always wrong

### Shared Code Placement

Place shared code in the most specific scope that covers all its consumers:

| Shared by | Location |
|-----------|----------|
| Multiple **services** only | `src/services/common/` |
| Multiple **samples** only | `src/samples/common/` |
| Multiple **engines** only | `src/engines/common/` |
| UI components only (no business logic) | `src/components/` |
| Across services, samples, **and** engines | `src/types/` (types) or `src/lib/` (utilities) |

Do not hoist code to a broader scope unless it is genuinely needed there.

### Adding a New Service

1. Create `src/services/<name>/data.ts` — export `service: ServiceMeta` (and optionally `worker: WorkerConfig`)
2. Create `src/services/<name>/demo.tsx` — export a React demo component
3. Optionally create `docs.ts` and `config.ts`
4. Create `src/services/<name>/hooks/use-params.ts` — export a params hook (see **Demo Parameter Hooks** below)
5. Place any hooks or components used only by this service inside `src/services/<name>/`
6. Run `npm run codegen` to regenerate `_generated/` registries
7. Add the corresponding worker in `workers/<name>/` if using `"worker"` execution mode

### Demo Parameter Hooks

Each service exposes a **params hook** in `hooks/use-params.ts` that encapsulates all demo parameter state (sliders, selects, etc.) and returns both the current values and a `DemoParam[]` array for rendering controls.

```
src/services/<name>/
├── hooks/
│   ├── use-params.ts     # Parameter state hook
│   ├── use-<action>.ts   # API mutation hooks (e.g., use-transcribe.ts)
│   └── index.ts          # Barrel re-exports
```

#### Hook signature

Each hook follows this pattern:

```tsx
export function use<Name>Params(initial?: Partial<ParamValues>) {
  // useState for each parameter with defaults
  const [param, setParam] = useState(initial?.param ?? DEFAULT)

  // Build DemoParam[] array for DemoParameterSidebar
  const params: DemoParam[] = [
    { type: "slider", label: "...", value: param, onValueChange: setParam, ... },
  ]

  return { values: { param, ... }, params }
}
```

- **`values`** — typed object with current parameter values, consumed by API mutation hooks
- **`params`** — `DemoParam[]` passed directly to `<DemoParameterSidebar params={params} />`

#### Usage in service demos

```tsx
const { values, params } = useTextGenParams()
// Use `values` when calling the API, pass `params` to the sidebar
```

#### Usage in samples

Sample hooks in `src/samples/common/hooks/` import the service params hook and wrap it with `ServiceParamGroup` metadata (online status, optional toggle, config link) for `<DemoConfigSheet>`:

```tsx
import { useTextGenParams } from "@/services/text-generation/hooks"

export function useTextGenerationParams(online: boolean) {
  const { values, params } = useTextGenParams()
  const group: ServiceParamGroup = { name: "Text Generation", online, params }
  return { values, group }
}
```

### Adding a New Sample

1. Create `src/samples/<name>/data.ts` — export `sample`
2. Optionally add `demo.tsx` for component-based demos
3. Reuse hooks/components from `src/services/` where needed — do not duplicate them
4. Run `npm run codegen`

### Adding a New Engine

1. Create `src/engines/<name>/data.ts` — export `engine: Engine`
2. Create `src/engines/<name>/process-handler.ts` — export `start<PascalName>Model`
3. Run `npm run codegen`

### Python Worker Conventions

- Each worker has a `main.py` with FastAPI app, CORS middleware, and `uvicorn.run()` entrypoint
- Use `argparse` for CLI args (port, device, model, source)
- Global model instances initialized at startup
- Expose health-checkable endpoints

#### UV Project Setup

Each worker must be a proper UV project so it works with a simple `uv run`:

```
workers/<name>/
├── main.py
├── pyproject.toml      # managed by UV
├── start.sh            # Linux/macOS start script
└── start.ps1           # Windows start script
```

Common UV commands when working on a worker:

```bash
uv init                 # create a new worker project
uv add <dependency>     # add a dependency (updates pyproject.toml + uv.lock)
uv sync                 # install all dependencies from uv.lock
uv run main.py          # run the worker
```

Workers do **not** have setup scripts (only `engine` and `helper` do). All prerequisite checks (UV, OVMS, FFmpeg, etc.) and any one-time provisioning (venv creation, model downloads, repo clones, patch application) run inside `start.sh`/`start.ps1` on first service launch, guarded by file/directory checks so they run only once. `uv run` auto-syncs dependencies from `pyproject.toml` on every launch — no manual `uv sync` needed.

### Database Migrations

Payload CMS auto-generates SQLite migrations in `src/migrations/`. Follow these rules whenever you change the database schema (collections, fields, etc.):

- **If a release migration already exists** (i.e., the migration has been shipped/tagged) — do **not** modify it. Create a new migration instead by running `next build` or the Payload migration CLI.
- **If no release exists yet** (still in development) — you may modify the latest migration file directly rather than stacking a new one.
- Never edit `payload-types.ts` manually — it is regenerated from the schema automatically.

### Common Pitfalls

- **Do not edit `_generated/` files** — they are overwritten by `npm run codegen`
- **Run `npm run codegen`** after adding, removing, or renaming services/samples/engines
- **Do not use `console.log`** — Biome enforces `noConsole: error`. Use the logger from `@/lib/logger`
- **Config-safe imports**: In `next.config.ts`, Payload config, or any server config context, import from `_generated/meta.ts` (not `services.ts`) to avoid pulling in React dependencies
- **Port conflicts**: Each service must have a unique port defined in its `data.ts`
- **`payload-types.ts` is auto-generated** by Payload CMS — do not edit manually
- **Use TanStack Query for all API calls** — do not fetch directly in components
- **Respect dependency direction**: Engines ← Services ← Samples. No circular imports.
- **Do not use eslint-disable** comments without a very good reason. Instead, fix the underlying issue or adjust the code to comply with linting rules.
