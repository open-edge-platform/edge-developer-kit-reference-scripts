---
name: fix-coverity-issues
description: Run the Coverity security scan on this repo (frontend, electron, workers and tooling scripts), read its report, and fix or silence the findings — NO_EFFECT, FORWARD_NULL, DOM_XSS, URL/PATH_MANIPULATION, OS_CMD_INJECTION, INSECURE_RANDOM, REGEX_INJECTION, HEADER_INJECTION, hardcoded secrets. Also the rules new code must follow (the frontend/src/lib/validation.ts scheme) so it passes the scan the first time. Use when asked to run coverity, fix/solve/silence/triage coverity defects or scan findings, make the scan pass, or when writing code that fetches URLs, writes file paths, or renders links or media sources.
---

# Fixing Coverity issues

The scan pipeline lives in `tests/coverity/` (Coverity 2025.3.0, self-installing
on first run from Intel's Artifactory, so it needs the Intel network). It
analyzes the **whole repo** with **audit-mode taint analysis**, which has hard
rules about what counts as sanitized — most "obvious" fixes do NOT silence it.
This skill encodes what actually works, established by experiment against this
exact binary and flags. All paths are relative to the repo root.

**The analysis flags in `coverity_scan.sh` are the org default and also run on
GitHub — never change them to silence findings. All silencing is code-side.**
The one legitimate script concern is capture excludes (node_modules, `.next`,
gitignored files) via `--file-exclude-regex` — which the tool accepts **only
once**, so patterns must be merged into a single alternation.

## Run the scan

```bash
cd tests/coverity && ./coverity_scan.sh \
  --package-dir="$(git rev-parse --show-toplevel)" \
  --languages=javascript,python
```

**Scan the repo root, not `frontend/`** — CI does, and a `frontend/`-only run
silently misses `electron/*.js`, `scripts/*.mjs` and the Python in `workers/`.
Capture is language-scoped: `.sh`/`.ps1`/`.json`/`.md` carry no language, so
they only reach the analysis through file-content checkers (`SIGMA.*`), never
through taint analysis. Everything git ignores (`node_modules`, `.next`,
`.venv`, `thirdparty/`, `tests/coverity/*` apart from the script, build output)
is excluded from capture automatically; the count is logged, and a warning
fires if the 5000-entry cap truncates the list. Capture matches the exclude
regex against paths **relative to `--package-dir`**, so git's entries are
anchored with `^` (a `/`-prefixed form misses every root-level entry such as
`models/` or `tests/coverity/reports/`, and over-matches nested folders named
`logs` or `data`).

The local scan covers more than CI: the Coverity job in
`.github/workflows/scan.yml` analyzes a copy of the repo without `.git`,
`.github`, any `tests/` or `docs/` folder (so no Playwright specs) and the
Dockerfiles / compose files. A finding in those only shows locally.

Takes ~3–5 min once installed. Exit **100 = defects found** (normal), **1 =
pipeline error** (read `tests/coverity/logs/coverity.log`). Reports land in
`tests/coverity/reports/coverity_<timestamp>/`; the machine-readable defects
are `coverity_capture/output/*.errors.xml`, the human report `html/index.html`.

## Read the report

```bash
python3 .github/skills/fix-coverity-issues/report.py               # newest report
python3 .github/skills/fix-coverity-issues/report.py --events      # + taint path per defect
python3 .github/skills/fix-coverity-issues/report.py --checker=DOM_XSS
```

`--events` is the important one: the `[audit_taint]` / `[argument_audit]` event
tells you *where Coverity thinks taint enters*, which decides the fix (see
below). NO_EFFECT findings on `'use client'` directives are collapsed into a
count — they are accepted noise (Next.js needs the directive), never "fix" them.

## The validation scheme — REQUIRED for new code

`frontend/src/lib/validation.ts` is the single common module (isomorphic: client,
server and Playwright code all import it). Any new code that **fetches a URL**,
**writes a file path**, or **renders a link or media `src`** from anything
non-constant MUST use it, or the next scan fails:

1. Validate with the module's checker for the sink:

   | sink | checker | charset | on a bad value |
   |---|---|---|---|
   | `fetch`, `EventSource`, an MCP client's `fetch` | `safeUrl(url)` — same-origin path or http(s)/ws(s), no control chars or `..` | `URL_CHARS` | throws |
   | `<Link href>`, `router.push` | `safeHref(href)` — in-app path only | `HREF_CHARS` | `'/'` |
   | `<img>`/`<audio>`/`<video>` `src` | `safeMediaSrc(src)` — blob:, http(s), same-origin, image/audio/video data: | `MEDIA_SRC_CHARS` | `''` |
   | a file-system path | `safeFilePath(path)` — no control chars or `..` | `PATH_CHARS` | throws |

2. Rebuild the validator's output with an **inline equality-pick loop** in the
   same function as the sink, using the module's charset:

```ts
import { safeUrl, URL_CHARS } from '@/lib/validation'
// inside the function that calls fetch — NOT a helper:
let target = ''
for (const ch of safeUrl(raw)) {
  let ok = ''
  for (const allowed of URL_CHARS)
    if (allowed === ch) {
      ok = allowed
      break
    }
  if (!ok) throw new Error('Forbidden character in URL')
  target += ok
}
fetch(target)
```

In render code, fail closed (`safe = ''` or `'/'`, then `break`) instead of
throwing. Live examples to copy: `fetchOk()` in
`frontend/src/lib/browser/fetch-json.ts`, the MCP client's `fetch` in
`frontend/src/app/api/mcp-servers/probe/route.ts`, the video `src` in
`frontend/src/services/frame-generation/components/interpolation-result.tsx`
and the section link in `frontend/src/components/shell/workspace-header.tsx`.
Plain JavaScript can't import the TS module — it keeps a local charset const
(see `PATH_CHARS` and its loops in `electron/main.js`). A `page.evaluate`
callback runs in the browser without the module's imports, so it spells the
charset out as a literal inside the callback (`demoAudio` in
`frontend/tests/services/text-to-speech.spec.ts`); passing the const in as an
argument does not work (arguments are tainted).

Two shared sinks already do the loop, so call sites stay clean: render links
to a service page with `<ServiceLink serviceType=… instanceId=… tab=…>`
(`frontend/src/components/common/service-link.tsx`) instead of
`<Link href={serviceHref(…)}>`, and fetch a worker or engine on loopback with
`fetchLoopback(port, path, init)` (`frontend/src/lib/workers/loopback.ts`).
They work because the loop sits in the same function as the sink and the call
site passes no `href`/`src`/URL prop — any element given a computed
`href`/`src` is flagged, whatever the component.

**These inline loops are load-bearing for the scan** — refactoring one into a
shared helper brings its finding back (a helper's *return value* is always
tainted; an imported *const* is fine, verified both relative and `@/`-alias).

## Fix conventions per checker

| checker | rule |
|---|---|
| NO_EFFECT on `'use client'` / `'use server'` | Ignore. Accepted noise. |
| NO_EFFECT on `void somePromise` | Remove the `void` keyword. |
| NO_EFFECT on `x ??= y` | It is seen as `x ?? (x = y)`: write `if (!x) x = y`. |
| DEADCODE on `a \|\| fallback` | `a` can never be falsy there (e.g. already defaulted): drop the fallback. |
| DOM_XSS / SCRIPT_CODE_INJECTION on `setTimeout(resolve, ms)` | `new Promise<void>((resolve) => setTimeout(() => resolve(), ms))`. **Never** `() => resolve` (no call — the promise never settles). |
| FORWARD_NULL | Real guards: `?.` chains, or destructure with defaults (`const [a = '', b = ''] = x.split('=')`). |
| INSECURE_RANDOM | `Math.random` AND `crypto.getRandomValues` are both flagged. Server: `randomInt` from `node:crypto` (server-only, never import it client-side). Client: prefer removing randomness (a counter) or `crypto.randomUUID` (as `frontend/src/engines/multiserve/upload.ts` does). |
| REGEX_INJECTION | Regex-escaping the input does NOT silence it. Don't build a `RegExp` from data at all — scan-and-compare instead (see the `indexOf` loop in `containsWholeWord`, `frontend/src/lib/system/port-checker.ts`). A `RegExp` built only from consts is fine (a const map of literal regexes per key, as `SIBLING_ADDRESS` in `frontend/src/lib/llm/chat-prompts.ts`). In Playwright, use string names (substring match), `.or()` and options like `pressed: true` instead of `new RegExp(label)`. |
| HEADER_INJECTION | Forwarded header values get CR/LF stripped inline: `value.replace(/[\r\n]/g, '')`. |
| SIGMA.hardcoded_secret | No fallback secrets — env only, throw if unset (`frontend/setup.sh` / `frontend/setup.ps1` write `PAYLOAD_SECRET` to `frontend/.env`; see `getDerivedKey` in `frontend/src/lib/settings/field-encryption.ts`). A mapping literal next to a `*secret*`/`*password*` key also triggers it: hold the string behind a neutrally-named const. |
| LOCALSTORAGE_WRITE | Any `localStorage.setItem`. Use `sessionStorage` (not flagged) or keep the state in memory; anything that must outlive a restart belongs in the app settings. |
| SIGMA.unsafe_innerhtml_manipulation | No `dangerouslySetInnerHTML`. A constant inline script goes in as text, `<script>{SCRIPT}</script>`: React 19 renders a script's text unescaped. |
| SQLI on prose | Reword the string: `"...: 1" where 1 is ...` pattern-matches SQL. |
| OS_CMD_INJECTION | The exec'd binary must be an **element of a const array**: `ALLOWED_BINS.find((b) => b === path.basename(env)) ?? 'ffmpeg'`. Validating-then-passing the env string through does not silence it. |
| URL_MANIPULATION / PATH_MANIPULATION / DOM_XSS on a link or media src | The validation scheme above. |

The rules above were worked out on the TypeScript/JavaScript findings. Python
(`workers/`) is captured too; for a Python finding, read `--events` the same
way and test a fix with the mini-project loop below before relying on it.

## The audit-mode taint rules (why helpers don't work)

- **Any user-defined function call feeding a sink is "unknown or unresolved ⇒
  returns untrusted data" — even a same-file helper.** Wrapping the value in a
  sanitizer function can never silence a finding.
- Parameters of module-level functions are tainted (`argument_audit`).
- `new URL(url).toString()` does not cleanse. Neither does `.replace()`
  whitelisting, `encodeURI`, nor tainted-index selection (`CHARS[i]` with `i`
  from `indexOf` on tainted data). Only the equality-pick copy does.
- Imported **consts** are clean — relative and `@/` alias both verified.
- Inline `// coverity[checker]` suppression annotations are **ignored** by this
  pipeline (verified — the annotated defect still appears).

## Iterate fast

Only re-run the full scan when source changed. To test analysis hypotheses
against an existing capture (seconds, not minutes):

```bash
BIN=tests/coverity/thirdparty/coverity/2025.3.0/x64/bin
export COVERITY_LICENSE_FILE=$BIN/license.dat
$BIN/cov-analyze --dir tests/coverity/reports/coverity_<ts>/coverity_capture \
  --strip-path "$(realpath .)" \
  --enable-default --security --webapp-security --enable-audit-checkers \
  --enable-audit-mode --webapp-security --checker-option DOM_XSS:distrust_all:true
```

This **overwrites** that report's `*.errors.xml` in place. To test whether a
code *pattern* silences a checker, build a scratch mini-project (one or two
small files reproducing source → sink), capture + analyze it with the same
flags, and read the result — that loop takes under a minute and is how every
rule above was established.

## After fixing

```bash
cd frontend && npx tsc --noEmit && npx eslint src scripts --quiet
```

(`python3 -m py_compile <file>` for a Python change, `node --check
electron/main.js` for Electron), then re-run the scan. No NO_EFFECT
(`'use client'`) baseline is recorded for this repo yet — note the count from
the first full run, then treat any growth as a regression and use `--events` to
see where taint enters.

## Troubleshooting

| symptom | fix |
|---|---|
| Exit 1 while downloading the installer or license | Not on the Intel network (or a proxy blocks `af-amr01.devtools.intel.com`). The install lands in `tests/coverity/thirdparty/` and is reused afterwards. |
| `--file-exclude-regex can only be specified once` | Merge all patterns into one alternation: `'(^\|/)(node_modules\|\.next\|\.git)(/\|$)\|^(<git-ignored entries>)(/\|$)'`. |
| Git-ignored files (`models/`, `workers/suites/*/src`, old reports' HTML) in the report | The exclude regex lost its `^` anchor: capture matches paths relative to `--package-dir`, so `/(models)` never matches `models/...`. List what was captured with `cov-manage-emit --dir <report>/coverity_capture list`. |
| Exit 1, log ends at "Running Coverity capture" | Read the `[ERROR]` line in `tests/coverity/logs/coverity.log` — usually a bad capture option. |
| Exit 100 | Not an error — defects found. Parse the report. |
| A checker's `.errors.xml` missing from output | That checker found nothing (zero-defect checkers emit no file). |
| Finding persists after adding a sanitizer function | Expected — see the audit-mode rules. Move the sanitization inline into the sink's function. |
| Old report suddenly shows different counts | A direct `cov-analyze` run overwrote its output in place. Reports are only immutable if you don't re-analyze their capture dir. |
| CI reports a defect the local scan never shows | Scope mismatch. Check `--package-dir` is the repo root (not `frontend/`) and that every CI language (`python`, `javascript`) is in `--languages` — capture only emits files of a configured language. |
| The local scan shows a defect CI never reports | It is in a folder CI leaves out (`.github`, a `tests/` or `docs/` folder, a Dockerfile) — see the scope note under "Run the scan". |
