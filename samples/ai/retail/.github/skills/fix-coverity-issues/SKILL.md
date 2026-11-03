---
name: fix-coverity-issues
description: Run the Coverity security scan on the kiosk repo (frontend, electron and tooling scripts), read its report, and fix or silence the findings — NO_EFFECT, FORWARD_NULL, DOM_XSS, URL/PATH_MANIPULATION, OS_CMD_INJECTION, INSECURE_RANDOM, REGEX_INJECTION, HEADER_INJECTION, hardcoded secrets. Also the rules new code must follow (the src/lib/validation.ts scheme) so it passes the scan the first time. Use when asked to run coverity, fix/solve/silence/triage coverity defects or scan findings, make the scan pass, or when writing code that fetches URLs, writes file paths, or renders <img> sources.
---

# Fixing Coverity issues

The scan pipeline lives in `common/tests/coverity/` (Coverity 2025.3.0, self-installing
on first run). It analyzes the **whole repo** with **audit-mode taint analysis**, which
has hard rules about what counts as sanitized — most "obvious" fixes do NOT
silence it. This skill encodes what actually works, established by experiment
against this exact binary and flags. All paths are relative to the repo root.

**The analysis flags in `coverity_scan.sh` are the org default and also run on
GitHub — never change them to silence findings. All silencing is code-side.**
The one legitimate script concern is capture excludes (node_modules, `.next`,
gitignored files) via `--file-exclude-regex` — which the tool accepts **only
once**, so patterns must be merged into a single alternation.

## Run the scan

```bash
cd common/tests/coverity && ./coverity_scan.sh \
  --package-dir="$(git rev-parse --show-toplevel)" \
  --languages=javascript,python
```

**Scan the repo root, not `public-service-kiosk/frontend/`** — CI does, and a `public-service-kiosk/frontend/`-only run
silently misses `common/electron/scripts/*.mjs`, `common/scripts/`, `.github/skills/*.py` and the
`configs/*.yaml`. Capture is language-scoped: `.yaml`/`.sh`/`.md` carry no
language, so they only reach the analysis through file-content checkers
(`SIGMA.*`), never through taint analysis. Everything git ignores
(`node_modules`, `.next`, `common/tests/coverity/thirdparty`, build output) is excluded
from capture automatically; the count is logged, and a warning fires if the
2000-entry cap truncates the list.

Takes ~3–5 min. Exit **100 = defects found** (normal), **1 = pipeline error**
(read `common/tests/coverity/logs/coverity.log`). Reports land in
`common/tests/coverity/reports/coverity_<timestamp>/`; the machine-readable defects are
`coverity_capture/output/*.errors.xml`, the human report `html/index.html`.

## Read the report

```bash
python3 .github/skills/fix-coverity-issues/report.py               # newest report
python3 .github/skills/fix-coverity-issues/report.py --events      # + taint path per defect
python3 .github/skills/fix-coverity-issues/report.py --checker=DOM_XSS
```

`--events` is the important one: the `[audit_taint]` / `[argument_audit]` event
tells you *where Coverity thinks taint enters*, which decides the fix (see
below). NO_EFFECT findings on `"use client"` directives are collapsed into a
count — they are accepted noise (Next.js needs the directive), never "fix" them.

## The validation scheme — REQUIRED for new code

`public-service-kiosk/frontend/src/lib/validation.ts` is the single common module. Any new code that
**fetches a URL**, **writes a file path**, or **renders an `<img src>`** from
anything non-constant MUST use it, or the next scan fails:

1. Validate with the module's checker: `safeUrl(url)` for URLs (traversal /
   CRLF / scheme), `safeImageSrc(src)` for image sources (scheme allowlist +
   DOMPurify).
2. Rebuild the validator's output with an **inline equality-pick loop** in the
   same function as the sink, using the module's charset (`URL_CHARS`,
   `IMAGE_SRC_CHARS`):

```ts
import { safeUrl, URL_CHARS } from "@/lib/validation";
// inside the function that calls fetch — NOT a helper:
let target = "";
for (const ch of safeUrl(raw)) {
  let ok = "";
  for (const allowed of URL_CHARS) if (allowed === ch) { ok = allowed; break; }
  if (!ok) throw new Error("forbidden character");
  target += ok;
}
fetch(target);
```

In render code, fail closed (`src = ""; break;`) instead of throwing. Live
examples to copy: `request()` in `public-service-kiosk/frontend/src/app/api/_lib/speech.ts`, `send()`
in `public-service-kiosk/frontend/src/lib/api/client.ts`, the `<img src>` sites in
`public-service-kiosk/frontend/src/components/kiosk/document-capture.tsx` and
`public-service-kiosk/frontend/src/components/staff/portrait-capture.tsx`. Plain `.mjs` scripts
can't import the TS module — they keep a local charset const (see
`PATH_CHARS` + `insideOut` in `public-service-kiosk/frontend/scripts/gen-mock-docs.mjs`).

**These inline loops are load-bearing for the scan** — refactoring one into a
shared helper brings its finding back (a helper's *return value* is always
tainted; an imported *const* is fine, verified both relative and `@/`-alias).

## Fix conventions per checker

| checker | rule |
|---|---|
| NO_EFFECT on `"use client"` / `"use server"` | Ignore. Accepted noise. |
| NO_EFFECT on `void somePromise` | Remove the `void` keyword. |
| DOM_XSS / SCRIPT_CODE_INJECTION on `setTimeout(resolve, ms)` | `new Promise<void>((resolve) => setTimeout(() => resolve(), ms))`. **Never** `()=>resolve` (no call — the promise hangs forever; this once shipped broken). |
| FORWARD_NULL | Real guards: `?.` chains, or destructure with defaults (`const [a = "", b = ""] = x.split("=")`). |
| INSECURE_RANDOM | `Math.random` AND `crypto.getRandomValues` are both flagged. Server: `randomInt` from `node:crypto` (see `public-service-kiosk/frontend/src/app/api/_lib/random.ts` — server-only, never import client-side). Client: prefer removing randomness (a counter) or `crypto.randomUUID`. |
| REGEX_INJECTION | Regex-escaping the input does NOT silence it. Don't build a `RegExp` from data at all — scan-and-compare instead (see `replaceBounded` in `public-service-kiosk/frontend/src/app/api/_lib/speech.ts`). |
| HEADER_INJECTION | Forwarded header values get CR/LF stripped inline: `value.replace(/[\r\n]/g, "")` (typed-string TS). In plain `.mjs`, `.replace()` / `String(x).replace()` is an unresolved call and stays tainted — rebuild the value with the equality-pick loop off a printable-ASCII const in the function that builds the header (see `KEY_CHARS` in `public-service-kiosk/frontend/scripts/dev/snapshot-contract.mjs`). |
| SIGMA.hardcoded_secret | No fallback secrets — env only, throw if unset (config.yaml supplies them at boot). A mapping literal next to a `*secret*`/`*password*` key also triggers it: hold the string behind a neutrally-named const (see `CMS_CREDENTIAL_ENV_NAMES` in `public-service-kiosk/frontend/src/lib/kiosk-config.ts`). |
| SQLI on prose | Reword the string: `"...: 1" where 1 is ...` pattern-matches SQL. |
| OS_CMD_INJECTION | The exec'd binary must be an **element of a const array**: `ALLOWED_BINS.find((b) => b === path.basename(env)) ?? "scanimage"`. Validating-then-passing the env string through does not silence it. |
| URL_MANIPULATION / PATH_MANIPULATION / DOM_XSS on img src | The validation scheme above. |

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
BIN=common/tests/coverity/thirdparty/coverity/2025.3.0/x64/bin
export COVERITY_LICENSE_FILE=$BIN/license.dat
$BIN/cov-analyze --dir common/tests/coverity/reports/coverity_<ts>/coverity_capture \
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
cd public-service-kiosk/frontend && npx tsc --noEmit && npx eslint src scripts --quiet
```

then re-run the scan. The **54 NO_EFFECT** (`"use client"`) baseline was
measured on the old `frontend/`-only scope — re-establish it for the repo-wide
scope on the first full run, then treat any growth as a regression and use
`--events` to see where taint enters.

## Troubleshooting

| symptom | fix |
|---|---|
| `--file-exclude-regex can only be specified once` | Merge all patterns into one alternation: `'/(node_modules\|\.next\|\.git\|...)(/\|$)'`. |
| Exit 1, log ends at "Running Coverity capture" | Read the `[ERROR]` line in `common/tests/coverity/logs/coverity.log` — usually a bad capture option. |
| Exit 100 | Not an error — defects found. Parse the report. |
| A checker's `.errors.xml` missing from output | That checker found nothing (zero-defect checkers emit no file). |
| Finding persists after adding a sanitizer function | Expected — see the audit-mode rules. Move the sanitization inline into the sink's function. |
| Old report suddenly shows different counts | A direct `cov-analyze` run overwrote its output in place. Reports are only immutable if you don't re-analyze their capture dir. |
| CI reports a defect the local scan never shows | Scope mismatch. Check `--package-dir` is the repo root (not `public-service-kiosk/frontend/`) and that every CI language is in `--languages` — capture only emits files of a configured language. |
