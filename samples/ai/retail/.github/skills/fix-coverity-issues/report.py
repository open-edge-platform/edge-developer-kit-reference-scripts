#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Compact view of a Coverity report's *.errors.xml.

Usage:
  python3 report.py                  # newest report, defect list per checker
  python3 report.py --events         # + full event trail per defect (the taint path)
  python3 report.py --checker=DOM_XSS
  python3 report.py <report-dir>     # a specific tests/coverity/reports/coverity_* dir

NO_EFFECT findings on "use client"/"use server" directives are collapsed into a
count — they are accepted noise, not work.
"""

import glob
import os
import re
import sys

try:
    from defusedxml.ElementTree import fromstring as xml_fromstring
except ModuleNotFoundError:
    # Parses local Coverity output only.
    from xml.etree.ElementTree import fromstring as xml_fromstring  # nosec B405

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
REPORTS = os.path.join(REPO, "tests", "coverity", "reports")


def strip_markup(desc: str) -> str:
    desc = re.sub(r"<[^>]+>", "", desc or "")
    return re.sub(r"\{Cov[^{]*|\{\{code\{|\}\}|\{t\{|\{L\}|\}", "", desc)


def main() -> int:
    events = "--events" in sys.argv
    checker_filter = next(
        (a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--checker=")), None
    )
    named = [a for a in sys.argv[1:] if not a.startswith("--")]
    if named:
        report = named[0]
    else:
        dirs = sorted(glob.glob(os.path.join(REPORTS, "coverity_*")))
        if not dirs:
            print(f"no reports under {REPORTS} — run the scan first", file=sys.stderr)
            return 2
        report = dirs[-1]
    out = os.path.join(report, "coverity_capture", "output")
    files = sorted(glob.glob(os.path.join(out, "*.errors.xml")))
    if not files:
        print(
            f"no *.errors.xml under {out} — the scan found nothing or failed",
            file=sys.stderr,
        )
        print(f"report dir: {report}")
        return 0

    print(f"report: {report}")
    total = 0
    for f in files:
        name = os.path.basename(f).replace(".errors.xml", "")
        if checker_filter and checker_filter not in name:
            continue
        content = open(f, encoding="utf-8", errors="replace").read()
        tree = xml_fromstring(  # nosec B314 # parses local Coverity output only
            "<root>" + re.sub(r"<\?xml[^?]*\?>", "", content) + "</root>"
        )
        rows = []
        directives = 0
        for err in tree.iter("error"):
            main_ev = next(
                (ev for ev in err.iter("event") if ev.findtext("main") == "true"), None
            )
            desc = (
                main_ev.findtext("description") if main_ev is not None else ""
            ) or ""
            if "use client" in desc or "use server" in desc:
                directives += 1
                continue
            file_ = (err.findtext("file") or "").replace(REPO + "/", "")
            line = main_ev.findtext("line") if main_ev is not None else "?"
            rows.append((err, f"{file_}:{line} | {strip_markup(desc)[:140]}"))
        total += len(rows) + directives
        suffix = (
            f"  (+{directives} 'use client' directives — ignore)" if directives else ""
        )
        print(f"\n== {name}: {len(rows) + directives}{suffix}")
        for err, row in rows:
            print("  " + row)
            if events:
                for ev in err.iter("event"):
                    evfile = (ev.findtext("file") or "").replace(REPO + "/", "")
                    print(
                        f"    [{ev.findtext('tag')}] {evfile}:{ev.findtext('line')} "
                        + strip_markup(ev.findtext("description") or "")[:150]
                    )
    print(f"\nTOTAL: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
