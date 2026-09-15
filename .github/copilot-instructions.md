# Copilot Instructions

This repository is a collection of independent Intel® Edge Developer Kit samples,
scripts, and automation under `samples/`, `automation/`, and the repo root. There's
no single shared build or test command — each sample is self-contained.

## Root-level installer scripts

These set up the host platform itself (drivers, runtimes) and are independent of
any sample under `samples/`. Every standalone script directly under the repo root
(installer scripts, plus the smaller reporting/telemetry helpers alongside them)
is directly runnable — read its own header comment for what it does and its
options/env vars before changing it.

One thing isn't obvious from a single script's header, so note it here instead
of repeating it per-script: `main_installer.sh` is the entry point; it
orchestrates the others (menu-driven, or `DEVKIT_AUTO_INSTALL=1` for
unattended install) and owns the `/run/reboot-required` restart-banner logic
— don't duplicate that policy in another script.

`automation/` holds separate devkit provisioning tooling (BKC/image flashing, CI
runner setup, PXE post-install) — see [automation/README.md](../automation/README.md);
it doesn't feed into the installers above.

## Per-sample instructions

Before making changes inside `samples/<category>/<sample-name>/`, check whether that
sample has its own `.github/copilot-instructions.md`. When present, it's authoritative
for that sample (conventions, constraints, and — where applicable — how to run and
validate its tests) and takes precedence over generic assumptions, in addition to
(not instead of) this file. For example:

- `samples/ai/local-lingua/.github/copilot-instructions.md`
- `samples/ai/edge-ai-demo-studio/.github/copilot-instructions.md`

If a sample has a `tests/README.md` (or similar), use it to run and validate that
sample's test suite after making a change — don't assume a repo-wide test command.

## Documentation

Markdown files (`**/*.md`, `**/*.rst`, `**/*.txt`) are covered by
[.github/instructions/docs-review.instructions.md](instructions/docs-review.instructions.md)
— grammar/clarity, trademark handling (e.g. `GitHub*`, `Docker*`), and Intel product
naming conventions apply whenever you create or edit one.

## Security scanning

Root-level, generic Coverity* scan tooling lives under
[tests/scans/](../tests/scans/README.md) and can be run against any sample or
the root installer scripts (see that README for usage). When fixing findings
from that scan in Python or JavaScript* files, follow
[.github/instructions/coverity-security-fixes.instructions.md](instructions/coverity-security-fixes.instructions.md)
for the vulnerability-specific fix patterns and the suppression-comment
convention for confirmed false positives.

