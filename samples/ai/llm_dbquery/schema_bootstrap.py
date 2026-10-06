# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Schema Bootstrap — Generates _meta.json metadata files for databases.

Connects to each SQLite DB, introspects schema + sample data, then sends
it to the llama.cpp LLM to produce descriptions, JOIN hints, example
queries, and column aliases.  The result is saved as databases/{name}_meta.json.

Usage:
    python schema_bootstrap.py                     # process all DBs
    python schema_bootstrap.py --db central        # process one DB
    python schema_bootstrap.py --db central --auto # skip review
"""

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from typing import Dict, List, Optional


# ---------------------------------------------------------------------------
# Utility: compute a stable fingerprint of a database schema
# ---------------------------------------------------------------------------

def compute_fingerprint(db_path: str) -> str:
    """
    SHA-256 over sorted (table+column) names.  Changes whenever tables or
    columns are added / removed / renamed.  Column *types* are included
    so a type change (e.g. VARCHAR→INTEGER) also triggers re-generation.
    """
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    parts: List[str] = []

    # Tables
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    tables = [r[0] for r in cur.fetchall()]
    for tbl in tables:
        cur.execute(f'PRAGMA table_info("{tbl}")')
        cols = cur.fetchall()
        for c in cols:
            parts.append(f"T:{tbl}.{c[1]}:{c[2]}")  # name:type

    # Views
    cur.execute("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")
    views = [r[0] for r in cur.fetchall()]
    for vw in views:
        cur.execute(f'PRAGMA table_info("{vw}")')
        cols = cur.fetchall()
        for c in cols:
            parts.append(f"V:{vw}.{c[1]}:{c[2]}")

    conn.close()

    blob = "\n".join(sorted(parts)).encode()
    return hashlib.sha256(blob).hexdigest()


# ---------------------------------------------------------------------------
# Introspect: Tier 0 (structure) + Tier 1 (sample rows)
# ---------------------------------------------------------------------------

def introspect_database(db_path: str) -> Dict:
    """
    Returns a dict with:
      tables: {name: {columns: [{name,type,pk}], sample_rows: [...]}}
      views:  {name: {columns: [{name,type}], sample_rows: [...]}}
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    result: Dict = {"tables": {}, "views": {}}

    # ---- Tables ----
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    tables = [r[0] for r in cur.fetchall()]

    for tbl in tables:
        cur.execute(f'PRAGMA table_info("{tbl}")')
        columns = []
        for c in cur.fetchall():
            col_name = c[1]  # c is (cid, name, type, notnull, dflt, pk)
            if col_name == "IsDelete":
                continue
            columns.append({"name": col_name, "type": c[2], "pk": bool(c[5])})

        # Sample rows (Tier 1)
        sample_rows = []
        try:
            cur.execute(f'SELECT * FROM "{tbl}" LIMIT 3')
            col_names = [d[0] for d in cur.description]
            for row in cur.fetchall():
                sample_rows.append(dict(zip(col_names, row)))
        except Exception:
            pass

        result["tables"][tbl] = {"columns": columns, "sample_rows": sample_rows}

    # ---- Views ----
    cur.execute("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name")
    views = [r[0] for r in cur.fetchall()]

    for vw in views:
        cur.execute(f'PRAGMA table_info("{vw}")')
        columns = [{"name": c[1], "type": c[2]} for c in cur.fetchall()]

        sample_rows = []
        try:
            cur.execute(f'SELECT * FROM "{vw}" LIMIT 3')
            col_names = [d[0] for d in cur.description]
            for row in cur.fetchall():
                sample_rows.append(dict(zip(col_names, row)))
        except Exception:
            pass

        result["views"][vw] = {"columns": columns, "sample_rows": sample_rows}

    conn.close()
    return result


# ---------------------------------------------------------------------------
# Build the LLM prompt
# ---------------------------------------------------------------------------

def build_llm_prompt(db_name: str, introspection: Dict) -> str:
    """Build a system+user prompt for the LLM to produce _meta.json content."""

    # Format Tier 0: schema listing
    schema_lines = []
    for tbl, info in introspection["tables"].items():
        cols_str = ", ".join(
            f"{c['name']}({c['type']}){'[PK]' if c['pk'] else ''}"
            for c in info["columns"]
        )
        schema_lines.append(f"Table {tbl}: {cols_str}")

    for vw, info in introspection["views"].items():
        cols_str = ", ".join(f"{c['name']}({c['type']})" for c in info["columns"])
        schema_lines.append(f"View {vw}: {cols_str}")

    schema_block = "\n".join(schema_lines)

    # Format Tier 1: sample rows
    sample_lines = []
    for tbl, info in introspection["tables"].items():
        if info["sample_rows"]:
            sample_lines.append(f"\n{tbl} sample rows:")
            for row in info["sample_rows"]:
                # Truncate long values
                items = []
                for k, v in row.items():
                    sv = str(v)
                    if len(sv) > 60:
                        sv = sv[:57] + "..."
                    items.append(f"{k}={sv}")
                sample_lines.append("  " + ", ".join(items))
    sample_block = "\n".join(sample_lines) if sample_lines else "(no sample data)"

    prompt = f"""You are a database documentation expert. Analyze this SQLite database and produce a JSON metadata document.

DATABASE: {db_name}

SCHEMA:
{schema_block}

SAMPLE DATA:
{sample_block}

Produce this EXACT JSON structure (no extra keys, no markdown, just the JSON):
{{
  "description": "One sentence describing the entire database and its business purpose",
  "tables": {{
    "TableName": {{
      "description": "What this table stores. One row = what.",
      "columns": {{
        "ColumnName": "Description ONLY for columns whose purpose is non-obvious from the name"
      }}
    }}
  }},
  "views": {{
    "ViewName": {{
      "description": "What this view provides and which tables it joins"
    }}
  }},
  "joins": [
    "Exact SQLite JOIN conditions inferred from FK columns. e.g. CAST(TableA.FkCol AS INTEGER) = TableB.ID"
  ],
  "reserved_words": ["Any table or column name that is a SQL reserved word, e.g. User, Limit, Order"],
  "column_aliases": {{
    "Aliased column name in views": "Canonical column name in base tables"
  }},
  "example_queries": [
    {{
      "question": "A natural language question a user might ask",
      "sql": "The correct SQLite query for that question"
    }}
  ]
}}

RULES:
- Inspect sample data for FK relationships (matching IDs across tables).
- For VARCHAR/TEXT columns holding numbers (like Duration), note that CAST is needed.
- Generate 5-8 diverse example queries covering aggregations, JOINs, filtering, and grouping.
- For column_aliases, compare view columns vs base table columns and map any renamed columns.
- If a column stores enumerated values (seen in sample data), mention them in the column description.
- Output ONLY the JSON object. No explanation text before or after."""

    return prompt


# ---------------------------------------------------------------------------
# Call the LLM
# ---------------------------------------------------------------------------

def call_llm(prompt: str) -> Optional[str]:
    """Send prompt to llama.cpp and return raw response text."""
    try:
        import openai
    except ImportError:
        print("❌ openai package not installed.  Run: pip install openai")
        return None

    base_url = os.getenv("LLAMA_CPP_URL", "http://127.0.0.1:9091/v1")
    client = openai.OpenAI(base_url=base_url, api_key="")

    print(f"  🤖 Sending to LLM at {base_url} ...")

    try:
        response = client.chat.completions.create(
            model="local-model",
            messages=[
                {"role": "system", "content": "You are a database documentation expert. Return ONLY valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"  ❌ LLM call failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Parse + validate the LLM JSON response
# ---------------------------------------------------------------------------

def parse_llm_response(raw: str) -> Optional[Dict]:
    """Try to parse JSON from LLM response, stripping markdown fences if present."""
    text = raw.strip()

    # Strip markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        # Remove first and last ``` lines
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        meta = json.loads(text)
    except json.JSONDecodeError as e:
        print(f"  ❌ Failed to parse JSON from LLM: {e}")
        print(f"  Raw response (first 500 chars): {text[:500]}")
        return None

    # Validate required keys exist (with defaults for missing ones)
    required_keys = ["description", "tables", "views", "joins",
                     "reserved_words", "column_aliases", "example_queries"]
    for key in required_keys:
        if key not in meta:
            if key in ("tables", "views", "column_aliases"):
                meta[key] = {}
            elif key in ("joins", "reserved_words"):
                meta[key] = []
            elif key == "example_queries":
                meta[key] = []
            elif key == "description":
                meta[key] = "(no description generated)"
            print(f"  ⚠ Missing key '{key}' — added default")

    return meta


# ---------------------------------------------------------------------------
# Scaffold: generate empty _meta.json without LLM
# ---------------------------------------------------------------------------

def scaffold_meta(db_name: str, introspection: Dict, fingerprint: str) -> Dict:
    """Build a skeleton _meta.json with empty descriptions for manual fill-in."""
    meta: Dict = {
        "schema_fingerprint": fingerprint,
        "db_name": db_name,
        "description": "",
        "tables": {},
        "views": {},
        "joins": [],
        "reserved_words": [],
        "column_aliases": {},
        "example_queries": [],
    }

    for tbl, info in introspection["tables"].items():
        meta["tables"][tbl] = {
            "description": "",
            "columns": {c["name"]: "" for c in info["columns"]},
        }

    for vw, info in introspection["views"].items():
        meta["views"][vw] = {"description": ""}

    return meta


# ---------------------------------------------------------------------------
# Main entry point for ONE database
# ---------------------------------------------------------------------------

def generate_meta(db_path: str, auto: bool = False, force: bool = False) -> bool:
    """
    Generate _meta.json for a single database.

    Returns True if meta was saved, False otherwise.
    """
    db_dir = os.path.dirname(db_path)
    db_filename = os.path.basename(db_path)
    db_key = os.path.splitext(db_filename)[0].replace("_db", "")
    meta_path = _meta_path(db_dir, db_key)

    print(f"\n{'='*60}")
    print(f"📋 BOOTSTRAP: {db_key} ({db_filename})")
    print(f"{'='*60}")

    # Step 1: compute fingerprint
    fingerprint = compute_fingerprint(db_path)
    print(f"  Schema fingerprint: {fingerprint[:16]}...")

    # Step 2: check existing meta
    if os.path.exists(meta_path) and not force:
        with open(meta_path, "r", encoding="utf-8") as f:
            existing = json.load(f)
        stored_fp = existing.get("schema_fingerprint", "")
        if stored_fp == fingerprint:
            print(f"  ✓ Meta already up-to-date ({meta_path})")
            if not auto:
                answer = input("  Regenerate anyway? [y/N]: ").strip().lower()
                if answer != "y":
                    return True
            else:
                return True
        else:
            print(f"  🔄 Schema changed! Old fp: {stored_fp[:16]}... New fp: {fingerprint[:16]}...")
            print(f"  Will regenerate metadata.")

    # Step 3: introspect
    print(f"  🔍 Introspecting database...")
    introspection = introspect_database(db_path)
    table_count = len(introspection["tables"])
    view_count = len(introspection["views"])
    print(f"  Found {table_count} tables, {view_count} views")

    # Step 4: try LLM
    prompt = build_llm_prompt(db_key, introspection)
    raw_response = call_llm(prompt)

    meta = None
    if raw_response:
        meta = parse_llm_response(raw_response)

    if meta is None:
        print("  ⚠ LLM generation failed or unavailable.")
        if not auto:
            answer = input("  Save empty scaffold for manual editing? [Y/n]: ").strip().lower()
            if answer == "n":
                return False
        meta = scaffold_meta(db_key, introspection, fingerprint)
        meta["schema_fingerprint"] = fingerprint
        meta["db_name"] = db_key
        _save_meta(meta_path, meta)
        print(f"  📝 Scaffold saved to {meta_path}")
        print(f"     Edit this file to add descriptions, JOINs, and examples.")
        return True

    # Inject fingerprint + db_name
    meta["schema_fingerprint"] = fingerprint
    meta["db_name"] = db_key

    # Step 5: review
    if not auto:
        print(f"\n{'─'*60}")
        print("  📄 Generated metadata preview:")
        print(f"{'─'*60}")
        print(f"  Description: {meta.get('description', '(none)')}")
        print(f"  Tables documented: {len(meta.get('tables', {}))}")
        print(f"  Views documented: {len(meta.get('views', {}))}")
        print(f"  JOIN rules: {len(meta.get('joins', []))}")
        print(f"  Reserved words: {meta.get('reserved_words', [])}")
        print(f"  Column aliases: {len(meta.get('column_aliases', {}))}")
        print(f"  Example queries: {len(meta.get('example_queries', []))}")

        for eq in meta.get("example_queries", [])[:3]:
            print(f"    Q: {eq.get('question', '?')}")
            sql_preview = eq.get("sql", "")
            if len(sql_preview) > 80:
                sql_preview = sql_preview[:77] + "..."
            print(f"    SQL: {sql_preview}")

        print(f"{'─'*60}")
        answer = input("  Save this metadata? [Y/n]: ").strip().lower()
        if answer == "n":
            print("  ❌ Discarded.")
            return False

    # Step 6: save
    _save_meta(meta_path, meta)
    print(f"  ✅ Saved to {meta_path}")
    return True


def _save_meta(meta_path: str, meta: Dict):
    """Write meta dict to JSON file."""
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)


def _list_sqlite_files(db_dir: str) -> List[str]:
    """Return regular SQLite files directly inside the database directory."""
    root_dir = os.path.realpath(db_dir)
    if not os.path.isdir(root_dir):
        return []
    sqlite_files = []
    for entry in os.scandir(root_dir):
        if not entry.is_file(follow_symlinks=False) or not entry.name.endswith(".sqlite"):
            continue
        candidate = os.path.realpath(entry.path)
        if os.path.dirname(candidate) == root_dir:
            sqlite_files.append(candidate)
    return sorted(sqlite_files)


def _meta_path(db_dir: str, db_key: str) -> str:
    """Build a metadata path from a database key without accepting path segments."""
    if not db_key or os.path.basename(db_key) != db_key or db_key in {".", ".."}:
        raise ValueError("Invalid database key")
    root_dir = os.path.realpath(db_dir)
    candidate = os.path.realpath(os.path.join(root_dir, f"{db_key}_meta.json"))
    if os.path.dirname(candidate) != root_dir:
        raise ValueError("Metadata path escapes the database directory")
    return candidate


# ---------------------------------------------------------------------------
# Helper: check meta status for all databases (used by other modules)
# ---------------------------------------------------------------------------

def check_all_meta_status(db_dir: str) -> Dict[str, str]:
    """
    Check meta status for every .sqlite file in db_dir.

    Returns dict: {db_key: status} where status is one of:
      'ok'       — meta exists and fingerprint matches
      'missing'  — no _meta.json
      'stale'    — schema changed since meta was generated
    """
    status_map = {}
    sqlite_files = _list_sqlite_files(db_dir)

    for db_path in sqlite_files:
        db_filename = os.path.basename(db_path)
        db_key = os.path.splitext(db_filename)[0].replace("_db", "")
        meta_path = _meta_path(db_dir, db_key)

        if not os.path.exists(meta_path):
            status_map[db_key] = "missing"
            continue

        current_fp = compute_fingerprint(db_path)
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                stored = json.load(f)
            stored_fp = stored.get("schema_fingerprint", "")
            if stored_fp == current_fp:
                status_map[db_key] = "ok"
            else:
                status_map[db_key] = "stale"
        except (json.JSONDecodeError, Exception):
            status_map[db_key] = "stale"

    return status_map


def load_meta(db_dir: str, db_key: str) -> Optional[Dict]:
    """Load _meta.json for a database if it exists and is valid."""
    try:
        meta_path = _meta_path(db_dir, db_key)
    except ValueError:
        return None
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, Exception):
        return None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate _meta.json for SQLite databases")
    parser.add_argument("--db", type=str, default=None,
                        help="Process only this database key (e.g., 'central')")
    parser.add_argument("--auto", action="store_true",
                        help="Skip interactive review, save immediately")
    parser.add_argument("--force", action="store_true",
                        help="Regenerate even if fingerprint matches")
    parser.add_argument("--domain", choices=["manu", "retail"], default=None,
                        help="Domain database set to process: 'manu' (databases/db_manu) or 'retail' (databases/db_retail)")
    args = parser.parse_args()

    # Locate databases folder
    script_dir = os.path.dirname(os.path.abspath(__file__))
    database_root = os.path.join(script_dir, "databases")
    domain_dirs = {
        None: database_root,
        "manu": os.path.join(database_root, "db_manu"),
        "retail": os.path.join(database_root, "db_retail"),
    }
    db_dir = domain_dirs[args.domain]

    if not os.path.exists(db_dir):
        print(f"❌ Databases folder not found: {db_dir}")
        sys.exit(1)

    sqlite_files = _list_sqlite_files(db_dir)

    if not sqlite_files and not args.domain:
        # Check if domain subdirs exist and guide the user
        manu_files = _list_sqlite_files(os.path.join(script_dir, "databases", "db_manu"))
        retail_files = _list_sqlite_files(os.path.join(script_dir, "databases", "db_retail"))
        if manu_files or retail_files:
            print(f"❌ No .sqlite files found directly in {db_dir}")
            print(f"   Databases are organised by domain. Please specify --domain:")
            if manu_files:
                print(f"     python schema_bootstrap.py --domain manu   ({len(manu_files)} DBs)")
            if retail_files:
                print(f"     python schema_bootstrap.py --domain retail  ({len(retail_files)} DBs)")
            sys.exit(1)

    if not sqlite_files:
        print(f"❌ No .sqlite files found in {db_dir}")
        sys.exit(1)

    # Filter to specific DB if requested
    if args.db:
        target = args.db.lower()
        sqlite_files = [
            f for f in sqlite_files
            if os.path.splitext(os.path.basename(f))[0].replace("_db", "").lower() == target
        ]
        if not sqlite_files:
            print(f"❌ Database '{args.db}' not found in {db_dir}")
            sys.exit(1)

    print(f"\n{'='*60}")
    print(f"🛠  SCHEMA BOOTSTRAP — Metadata Generator")
    print(f"{'='*60}")
    print(f"Databases folder: {db_dir}")
    print(f"Databases to process: {len(sqlite_files)}")
    print(f"Auto mode: {'Yes' if args.auto else 'No (interactive review)'}")
    print(f"Force: {'Yes' if args.force else 'No'}")

    # Show current status
    status = check_all_meta_status(db_dir)
    print(f"\nCurrent metadata status:")
    for db_key, st in status.items():
        icon = {"ok": "✓", "missing": "⚠", "stale": "🔄"}.get(st, "?")
        print(f"  {icon} {db_key}: {st}")

    results = {}
    for db_path in sqlite_files:
        ok = generate_meta(db_path, auto=args.auto, force=args.force)
        db_key = os.path.splitext(os.path.basename(db_path))[0].replace("_db", "")
        results[db_key] = ok

    # Summary
    print(f"\n{'='*60}")
    print(f"📊 BOOTSTRAP SUMMARY")
    print(f"{'='*60}")
    for db_key, ok in results.items():
        icon = "✅" if ok else "❌"
        print(f"  {icon} {db_key}")

    success = all(results.values())
    if success:
        print(f"\n✅ All metadata files generated successfully!")
    else:
        print(f"\n⚠ Some databases could not be processed.")

    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
