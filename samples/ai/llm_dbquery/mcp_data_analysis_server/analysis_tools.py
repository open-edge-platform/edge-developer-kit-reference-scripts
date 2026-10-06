# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Data Analysis Tools
Performs statistical analysis on database query results — no LLM needed.
Returns a structured text report with key metrics, distributions, and insights.
"""

import json
import re
import pandas as pd
import numpy as np
from typing import List, Tuple


# ============================================================
# DATA PARSING (reuse robust parsing from visualization_tools)
# ============================================================

def _try_json_parse(text: str):
    """Try to parse JSON, return parsed result or None"""
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None


def _parse_input_data(data) -> List[Tuple[str, pd.DataFrame]]:
    """Parse input data into list of (name, DataFrame) tuples.
    Handles: proper JSON, double-encoded JSON, markdown-wrapped JSON,
    query_database wrapper format, pipe tables, CSV."""

    if isinstance(data, (dict, list)):
        return _convert_parsed(data)

    if not isinstance(data, str):
        raise ValueError(f"Cannot parse data of type {type(data)}")

    text = data.strip()
    if not text:
        raise ValueError("Empty data string")

    # 1. Direct JSON
    parsed = _try_json_parse(text)
    if parsed is not None:
        return _convert_parsed(parsed)

    # 2. Double-encoded
    if (text.startswith('"') and text.endswith('"')) or (text.startswith("'") and text.endswith("'")):
        inner = text[1:-1].replace('\\"', '"').replace('\\n', '\n').replace('\\\\', '\\')
        parsed = _try_json_parse(inner)
        if parsed is not None:
            return _convert_parsed(parsed)

    # 3. Markdown code block
    md_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    if md_match:
        parsed = _try_json_parse(md_match.group(1).strip())
        if parsed is not None:
            return _convert_parsed(parsed)

    # 4. Find JSON in text
    for pattern in [r'(\[\s*\{[\s\S]*\}\s*\])', r'(\{[\s\S]*\})']:
        match = re.search(pattern, text)
        if match:
            parsed = _try_json_parse(match.group(1))
            if parsed is not None:
                return _convert_parsed(parsed)

    # 5. Pipe table
    if '|' in text:
        df = _try_parse_pipe_table(text)
        if df is not None:
            return [("dataset", df)]

    # 6. CSV/TSV
    for sep in ['\t', ',']:
        lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
        if len(lines) >= 2 and sep in lines[0]:
            try:
                from io import StringIO
                df = pd.read_csv(StringIO(text), sep=sep)
                if len(df.columns) >= 2 and not df.empty:
                    return [("dataset", df)]
            except Exception:
                pass

    raise ValueError(f"Could not parse data. Received ({len(text)} chars): {text[:200]}...")


def _try_parse_pipe_table(text: str):
    """Parse a pipe-delimited markdown table into a DataFrame"""
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    table_lines = [l for l in lines if '|' in l]
    if len(table_lines) < 2:
        return None

    def parse_row(line):
        cells = [c.strip() for c in line.split('|')]
        if cells and cells[0] == '':
            cells = cells[1:]
        if cells and cells[-1] == '':
            cells = cells[:-1]
        return cells

    headers = parse_row(table_lines[0])
    if not headers:
        return None

    data_start = 1
    if data_start < len(table_lines):
        maybe_sep = table_lines[data_start].replace('|', '').replace('-', '').replace(':', '').strip()
        if maybe_sep == '':
            data_start = 2

    rows = [parse_row(line) for line in table_lines[data_start:] if len(parse_row(line)) == len(headers)]
    if not rows:
        return None

    df = pd.DataFrame(rows, columns=headers)
    for col in df.columns:
        try:
            df[col] = pd.to_numeric(df[col])
        except (ValueError, TypeError):
            pass
    return df


def _normalize_column_names(df):
    """Normalize aliased column names from SQL views to canonical names.
    Loads aliases from _meta.json if available, falls back to hardcoded map."""
    # Try to load from meta files
    aliases = _load_column_aliases_from_meta()

    if not aliases:
        aliases = {
            "Station_ID": "StationID",
            "Station_Name": "StationName",
            "Cavity ID": "CavityID",
            "User ID": "UserID",
            "Serial Number": "SerialNumber",
            "Overall Result": "OverallResult",
            "Error Code": "ErrorCode",
            "Error Description": "ErrorDescription",
            "Start Time": "StartTime",
            "End Time": "EndTime",
            "Contractor ID": "ContractorID",
            "Contractor Name": "ContractorName",
        }

    rename_map = {c: aliases[c] for c in df.columns if c in aliases}
    if rename_map:
        df = df.rename(columns=rename_map)
    return df


def _load_column_aliases_from_meta():
    """Load column_aliases from any _meta.json in databases/ folder."""
    try:
        db_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "databases")
        if not os.path.exists(db_dir):
            return None
        import glob as _glob
        meta_files = _glob.glob(os.path.join(db_dir, "*_meta.json"))
        merged_aliases = {}
        for mf in meta_files:
            try:
                import json as _json
                with open(mf, "r", encoding="utf-8") as f:
                    meta = _json.load(f)
                ca = meta.get("column_aliases", {})
                if ca:
                    merged_aliases.update(ca)
            except Exception:
                pass
        return merged_aliases if merged_aliases else None
    except Exception:
        return None


def _convert_parsed(parsed):
    """Convert parsed JSON to list of (name, DataFrame) tuples.
    Auto-unwraps query_database response: {"data": [...], "reasoning": {...}}"""

    # Unwrap query_database response
    if isinstance(parsed, dict) and "data" in parsed and isinstance(parsed["data"], list):
        parsed = parsed["data"]

    # Multiple datasets with _metadata
    if isinstance(parsed, dict) and "_metadata" in parsed:
        datasets = []
        for key in sorted(parsed.keys()):
            if key.startswith("result_"):
                datasets.append((key, _normalize_column_names(pd.DataFrame(parsed[key]))))
        if datasets:
            return datasets

    if isinstance(parsed, list):
        if len(parsed) == 0:
            raise ValueError("Empty data array")
        return [("dataset", _normalize_column_names(pd.DataFrame(parsed)))]
    elif isinstance(parsed, dict):
        if all(isinstance(v, list) for v in parsed.values()):
            return [("dataset", _normalize_column_names(pd.DataFrame(parsed)))]
        else:
            return [("dataset", _normalize_column_names(pd.DataFrame([parsed])))]
    else:
        raise ValueError(f"Cannot convert data of type {type(parsed)}")


# ============================================================
# ANALYSIS ENGINE (pure computation, no LLM)
# ============================================================

def _analyze_dataframe(df: pd.DataFrame, analysis_request: str = "") -> str:
    """Perform statistical analysis on a DataFrame and return text report"""
    sections = []
    req_lower = analysis_request.lower()

    # --- Overview ---
    sections.append(f"DATA OVERVIEW: {len(df)} rows x {len(df.columns)} columns")
    sections.append(f"Columns: {', '.join(df.columns.tolist())}")

    numeric_cols = df.select_dtypes(include=['number']).columns.tolist()
    text_cols = df.select_dtypes(include=['object']).columns.tolist()

    # --- Data Table (compact) ---
    if len(df) <= 30:
        sections.append(f"\nFULL DATA:\n{df.to_string(index=False)}")
    else:
        sections.append(f"\nFIRST 20 ROWS:\n{df.head(20).to_string(index=False)}")
        sections.append(f"... ({len(df) - 20} more rows)")

    # --- Numeric Statistics ---
    if numeric_cols:
        sections.append("\nNUMERIC SUMMARY:")
        stats = df[numeric_cols].describe().round(2)
        sections.append(stats.to_string())

        # Totals
        totals = df[numeric_cols].sum()
        sections.append(f"\nTOTALS: {', '.join(f'{col}={totals[col]:g}' for col in numeric_cols)}")

    # --- Categorical Distributions ---
    if text_cols:
        sections.append("\nCATEGORICAL DISTRIBUTIONS:")
        for col in text_cols:
            nunique = df[col].nunique()
            if nunique <= 20:
                vc = df[col].value_counts()
                total = len(df)
                dist_lines = []
                for val, count in vc.items():
                    pct = count / total * 100
                    dist_lines.append(f"  {val}: {count} ({pct:.1f}%)")
                sections.append(f"\n{col} ({nunique} unique values):")
                sections.append('\n'.join(dist_lines))
            else:
                sections.append(f"\n{col}: {nunique} unique values (top 5: {', '.join(df[col].value_counts().head(5).index.tolist())})")

    # --- Pass/Fail Analysis (FCT-specific) ---
    pass_fail_col = None
    for col in df.columns:
        if col.lower() in ['overallresult', 'overall_result', 'result', 'status']:
            pass_fail_col = col
            break
        vals = df[col].astype(str).str.lower().unique()
        if set(vals) <= {'pass', 'fail', 'skip', 'nan', 'none'}:
            pass_fail_col = col
            break

    if pass_fail_col:
        sections.append(f"\nPASS/FAIL ANALYSIS (column: {pass_fail_col}):")
        vc = df[pass_fail_col].value_counts()
        total = vc.sum()
        for val, count in vc.items():
            pct = count / total * 100
            sections.append(f"  {val}: {count} ({pct:.1f}%)")

        pass_count = sum(vc.get(v, 0) for v in vc.index if str(v).lower() == 'pass')
        if total > 0:
            yield_pct = pass_count / total * 100
            sections.append(f"  YIELD: {yield_pct:.1f}%")

        # Pass/fail breakdown by group columns
        for group_col in text_cols:
            if group_col != pass_fail_col and df[group_col].nunique() <= 15 and df[group_col].nunique() > 1:
                sections.append(f"\n  {pass_fail_col} by {group_col}:")
                ct = pd.crosstab(df[group_col], df[pass_fail_col])
                row_totals = ct.sum(axis=1)
                for idx in ct.index:
                    parts = [f"{col}={ct.loc[idx, col]}" for col in ct.columns]
                    total_row = row_totals[idx]
                    pass_in_row = ct.loc[idx, 'Pass'] if 'Pass' in ct.columns else 0
                    pct = pass_in_row / total_row * 100 if total_row > 0 else 0
                    sections.append(f"    {idx}: {', '.join(parts)} (total={total_row}, yield={pct:.1f}%)")
                break  # Only show first meaningful grouping

    # --- Correlation (if multiple numeric cols) ---
    if len(numeric_cols) >= 2 and len(df) >= 5:
        sections.append("\nCORRELATIONS (top pairs):")
        corr = df[numeric_cols].corr()
        pairs = []
        for i, c1 in enumerate(numeric_cols):
            for c2 in numeric_cols[i+1:]:
                r = corr.loc[c1, c2]
                if not np.isnan(r):
                    pairs.append((c1, c2, r))
        pairs.sort(key=lambda x: abs(x[2]), reverse=True)
        for c1, c2, r in pairs[:5]:
            strength = "strong" if abs(r) > 0.7 else "moderate" if abs(r) > 0.4 else "weak"
            sections.append(f"  {c1} vs {c2}: r={r:.2f} ({strength})")

    # --- Outlier Detection ---
    if numeric_cols and len(df) >= 10:
        outlier_notes = []
        for col in numeric_cols:
            q1 = df[col].quantile(0.25)
            q3 = df[col].quantile(0.75)
            iqr = q3 - q1
            if iqr > 0:
                lower = q1 - 1.5 * iqr
                upper = q3 + 1.5 * iqr
                outliers = df[(df[col] < lower) | (df[col] > upper)]
                if len(outliers) > 0:
                    outlier_notes.append(f"  {col}: {len(outliers)} outliers (range: {df[col].min():g} to {df[col].max():g}, IQR bounds: {lower:.2f} to {upper:.2f})")
        if outlier_notes:
            sections.append("\nOUTLIER DETECTION (IQR method):")
            sections.extend(outlier_notes)

    # --- Top/Bottom Ranking ---
    if numeric_cols and text_cols and len(df) >= 3:
        rank_col = numeric_cols[0]
        label_col = text_cols[0]
        sorted_df = df.sort_values(rank_col, ascending=False)
        n = min(5, len(df))
        sections.append(f"\nTOP {n} by {rank_col}:")
        for _, row in sorted_df.head(n).iterrows():
            sections.append(f"  {row[label_col]}: {row[rank_col]:g}")
        if len(df) > n:
            sections.append(f"\nBOTTOM {n} by {rank_col}:")
            for _, row in sorted_df.tail(n).iterrows():
                sections.append(f"  {row[label_col]}: {row[rank_col]:g}")

    return '\n'.join(sections)


# ============================================================
# MCP TOOL
# ============================================================

async def analyze_data(
    data: str,
    analysis_request: str = "Provide a comprehensive analysis of this data"
) -> str:
    """Analyze database query results and return a statistical text report. No charts — pure data analysis.

    Args:
        data: Pass the COMPLETE output from query_database directly. Do not extract or reformat — pass the entire JSON string as-is. The tool automatically extracts the data it needs.
        analysis_request: What to analyze, e.g. "pass rate by station", "failure breakdown", "summary statistics"

    Returns:
        Text report with statistics, distributions, pass/fail analysis, correlations, and rankings.
    """
    try:
        datasets = _parse_input_data(data)
        if not datasets:
            return "Error: No data to analyze"

        reports = []
        for ds_name, df in datasets:
            if df.empty:
                reports.append(f"Dataset '{ds_name}': Empty — skipped")
                continue

            report = _analyze_dataframe(df, analysis_request)
            reports.append(f"{'='*60}\nANALYSIS: {ds_name}\n{'='*60}\n{report}")

        return '\n\n'.join(reports)

    except Exception as e:
        import traceback
        return f"Error analyzing data: {str(e)}\n\nDetails:\n{traceback.format_exc()}"
