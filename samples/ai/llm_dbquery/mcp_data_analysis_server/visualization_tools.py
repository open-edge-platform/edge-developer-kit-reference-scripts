# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Data Visualization Tools
Creates charts and visualizations from database query results using matplotlib.
LLM determines the best chart configuration based on data and user request.
"""

import os
import re
import json
from datetime import datetime

# Use non-interactive backend for server
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import pandas as pd

# Charts output directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CHARTS_DIR = os.path.join(SCRIPT_DIR, "charts")
CHART_SERVER_PORT = int(os.getenv('MCP_CHART_SERVER_PORT', 7907))


def _ensure_charts_dir():
    """Ensure charts output directory exists"""
    os.makedirs(CHARTS_DIR, exist_ok=True)
    return CHARTS_DIR


def _parse_input_data(data):
    """Parse input data from MCP (JSON string or dict/list) into list of (name, DataFrame) tuples.
    Handles: proper JSON, double-encoded JSON, markdown-wrapped JSON, pipe/TSV/CSV tables, 
    and other formats edge LLMs commonly produce."""
    
    # If already parsed (dict or list), use directly
    if isinstance(data, (dict, list)):
        return _convert_parsed_to_datasets(data)
    
    if not isinstance(data, str):
        raise ValueError(f"Cannot parse data of type {type(data)}")
    
    text = data.strip()
    
    if not text:
        raise ValueError("Empty data string")
    
    # 1. Try direct JSON parse
    parsed = _try_json_parse(text)
    if parsed is not None:
        return _convert_parsed_to_datasets(parsed)
    
    # 2. Strip outer quotes (double-encoded JSON: '"[{...}]"' or "'{...}'")
    if (text.startswith('"') and text.endswith('"')) or (text.startswith("'") and text.endswith("'")):
        inner = text[1:-1]
        # Unescape common escape sequences
        inner = inner.replace('\\"', '"').replace('\\n', '\n').replace('\\\\', '\\\\')
        parsed = _try_json_parse(inner)
        if parsed is not None:
            return _convert_parsed_to_datasets(parsed)
    
    # 3. Extract JSON from markdown code blocks ```json ... ``` or ``` ... ```
    md_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    if md_match:
        parsed = _try_json_parse(md_match.group(1).strip())
        if parsed is not None:
            return _convert_parsed_to_datasets(parsed)
    
    # 4. Find JSON array or object anywhere in text
    for pattern in [r'(\[\s*\{[\s\S]*\}\s*\])', r'(\{[\s\S]*\})']:
        match = re.search(pattern, text)
        if match:
            parsed = _try_json_parse(match.group(1))
            if parsed is not None:
                return _convert_parsed_to_datasets(parsed)
    
    # 5. Try parsing pipe-delimited table (common LLM output)
    #    | Col1 | Col2 |\n| --- | --- |\n| val1 | val2 |
    if '|' in text:
        df = _try_parse_pipe_table(text)
        if df is not None:
            return [("dataset", df)]
    
    # 6. Try TSV/CSV
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
    
    raise ValueError(
        f"Could not parse data. Expected JSON array/object, pipe table, or CSV.\n"
        f"Received ({len(text)} chars): {text[:200]}..."
    )


def _try_json_parse(text: str):
    """Try to parse JSON, return parsed result or None"""
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None


def _try_parse_pipe_table(text: str):
    """Try to parse a pipe-delimited markdown table into a DataFrame"""
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    # Filter lines that look like table rows
    table_lines = [l for l in lines if '|' in l]
    if len(table_lines) < 2:
        return None
    
    def parse_row(line):
        cells = [c.strip() for c in line.split('|')]
        # Remove empty strings from leading/trailing pipes
        if cells and cells[0] == '':
            cells = cells[1:]
        if cells and cells[-1] == '':
            cells = cells[:-1]
        return cells
    
    headers = parse_row(table_lines[0])
    if not headers:
        return None
    
    # Skip separator row (| --- | --- |)
    data_start = 1
    if data_start < len(table_lines):
        maybe_sep = table_lines[data_start].replace('|', '').replace('-', '').replace(':', '').strip()
        if maybe_sep == '':
            data_start = 2
    
    rows = []
    for line in table_lines[data_start:]:
        row = parse_row(line)
        if len(row) == len(headers):
            rows.append(row)
    
    if not rows:
        return None
    
    df = pd.DataFrame(rows, columns=headers)
    # Try converting numeric columns
    for col in df.columns:
        try:
            df[col] = pd.to_numeric(df[col])
        except (ValueError, TypeError):
            pass
    return df


def _normalize_column_names(df):
    """Normalize aliased column names from SQL views to canonical names.
    
    Loads column_aliases from _meta.json if available for any discovered DB.
    Falls back to hardcoded FCT alias map if no meta files exist.
    """
    # Try to load aliases from _meta.json files
    aliases = _load_column_aliases_from_meta()

    # Fallback: hardcoded FCT alias map
    if not aliases:
        aliases = {
            # vOutputLogSMTT aliases → canonical names
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

    rename_map = {}
    for col in df.columns:
        if col in aliases:
            rename_map[col] = aliases[col]
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


def _convert_parsed_to_datasets(parsed):
    """Convert parsed JSON (dict or list) into list of (name, DataFrame) tuples.
    Automatically unwraps query_database response format: {"data": [...], "reasoning": {...}}"""
    
    # Unwrap query_database response wrapper: {"data": [...], "reasoning": {...}}
    if isinstance(parsed, dict) and "data" in parsed and isinstance(parsed["data"], list):
        print("  Auto-unwrapping query_database response format (extracting 'data' field)")
        parsed = parsed["data"]
    
    # Multiple datasets format with _metadata
    if isinstance(parsed, dict) and "_metadata" in parsed:
        # Could be {"result_1": [...], "result_2": [...], "_metadata": {...}, "reasoning": {...}}
        datasets = []
        for key in sorted(parsed.keys()):
            if key.startswith("result_"):
                df = _normalize_column_names(pd.DataFrame(parsed[key]))
                datasets.append((key, df))
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
        raise ValueError(f"Cannot convert parsed data of type {type(parsed)}")


def _extract_json_from_llm(text: str) -> dict:
    """Extract JSON from LLM response, handling markdown blocks and extra text"""
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass

    # Try markdown code block
    match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    if match:
        try:
            return json.loads(match.group(1))
        except Exception:
            pass

    # Try finding JSON object
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            pass

    return None


async def _get_chart_config_from_llm(df: pd.DataFrame, visualization_request: str, chart_type: str = "") -> dict:
    """Use LLM to determine chart configuration from data and user request"""
    import openai

    base_url = os.getenv("LLAMA_CPP_URL", "http://127.0.0.1:9091/v1")
    client = openai.OpenAI(base_url=base_url, api_key="")

    # Prepare column info
    col_info_lines = []
    for col in df.columns:
        dtype = str(df[col].dtype)
        nunique = df[col].nunique()
        sample_vals = df[col].dropna().head(3).tolist()
        col_info_lines.append(f"  - {col} (type: {dtype}, {nunique} unique, sample: {sample_vals})")

    columns_desc = "\n".join(col_info_lines)
    chart_hint = f"\nUser explicitly requested chart type: {chart_type}" if chart_type else "\nChoose the most appropriate chart type for the data and request."

    system_prompt = """You are a chart config generator. Given data columns and a request, return ONLY a valid JSON object. No explanations.

Chart types: bar, grouped_bar, stacked_bar, pareto, line, boxplot, pie, histogram
Rules: x_column and y_columns must be actual column names. Use green (#2ecc71) for Pass, red (#e74c3c) for Fail. For pareto: one numeric y_column."""

    user_prompt = f"""Data ({len(df)} rows): {columns_desc}
{chart_hint}
Request: {visualization_request}

Return ONLY this JSON:
{{"chart_type":"bar","title":"Title","x_column":"col","y_columns":["col1"],"group_by":null,"stacked":false,"show_values":true,"show_percentages":false,"percentage_column":null,"total_column":null,"annotation_columns":[],"x_label":"X","y_label":"Y","figsize":[14,7],"color_map":{{}},"legend_labels":{{}},"sort_descending":false}}"""

    try:
        response = client.chat.completions.create(
            model="local-model",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0
        )

        result = response.choices[0].message.content.strip()
        config = _extract_json_from_llm(result)

        if config and 'chart_type' in config and 'x_column' in config and 'y_columns' in config:
            # Validate columns exist in data
            all_cols = set(df.columns)
            if config['x_column'] not in all_cols:
                print(f"  LLM x_column '{config['x_column']}' not in data, using fallback")
                return _fallback_chart_config(df, visualization_request, chart_type)
            valid_y = [c for c in config['y_columns'] if c in all_cols]
            if not valid_y:
                print(f"  LLM y_columns not in data, using fallback")
                return _fallback_chart_config(df, visualization_request, chart_type)
            config['y_columns'] = valid_y
            return config

        print(f"  LLM returned invalid config, using fallback")
        return _fallback_chart_config(df, visualization_request, chart_type)

    except Exception as e:
        print(f"  LLM config failed: {e}, using fallback")
        return _fallback_chart_config(df, visualization_request, chart_type)


def _fallback_chart_config(df: pd.DataFrame, visualization_request: str, chart_type: str = "") -> dict:
    """Heuristic fallback when LLM chart config extraction fails"""
    numeric_cols = df.select_dtypes(include=['number']).columns.tolist()
    text_cols = df.select_dtypes(include=['object']).columns.tolist()

    req_lower = visualization_request.lower()
    if not chart_type:
        if 'pareto' in req_lower:
            chart_type = 'pareto'
        elif 'box' in req_lower or 'whisker' in req_lower:
            chart_type = 'boxplot'
        elif 'pie' in req_lower or 'donut' in req_lower:
            chart_type = 'pie'
        elif 'line' in req_lower or 'trend' in req_lower:
            chart_type = 'line'
        elif 'histogram' in req_lower or 'distribution' in req_lower:
            chart_type = 'histogram'
        elif 'stack' in req_lower:
            chart_type = 'stacked_bar'
        else:
            chart_type = 'bar'

    x_col = text_cols[0] if text_cols else df.columns[0]
    y_cols = numeric_cols[:3] if numeric_cols else [df.columns[1]] if len(df.columns) > 1 else [df.columns[0]]

    return {
        "chart_type": chart_type,
        "title": "Data Visualization",
        "x_column": x_col,
        "y_columns": y_cols,
        "group_by": None,
        "stacked": False,
        "show_values": True,
        "show_percentages": False,
        "percentage_column": None,
        "total_column": None,
        "annotation_columns": [],
        "x_label": x_col,
        "y_label": "Value",
        "figsize": [14, 7],
        "color_map": {},
        "legend_labels": {},
        "sort_descending": False
    }


# ============================================================
# CHART RENDERING FUNCTIONS
# ============================================================

DEFAULT_COLORS = ['#3498db', '#2ecc71', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#95a5a6']


def _apply_chart_style(ax, config):
    """Apply consistent styling to chart axes"""
    ax.set_xlabel(config.get('x_label', ''), fontsize=12, fontweight='bold')
    ax.set_ylabel(config.get('y_label', ''), fontsize=12, fontweight='bold')
    ax.set_title(config.get('title', 'Chart'), fontsize=14, fontweight='bold', pad=15)
    ax.grid(axis='y', alpha=0.3, linestyle='--')
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)


def _render_bar_chart(df: pd.DataFrame, config: dict, output_path: str) -> str:
    """Render bar chart (simple, grouped, or stacked)"""
    fig, ax = plt.subplots(figsize=tuple(config.get('figsize', [14, 7])))

    x_col = config['x_column']
    y_cols = config['y_columns']
    stacked = config.get('stacked', False)
    color_map = config.get('color_map', {})
    legend_labels = config.get('legend_labels', {})

    x_labels = df[x_col].astype(str).tolist()
    x = np.arange(len(x_labels))

    if stacked:
        bottom = np.zeros(len(df))
        for idx, y_col in enumerate(y_cols):
            color = color_map.get(y_col, DEFAULT_COLORS[idx % len(DEFAULT_COLORS)])
            label = legend_labels.get(y_col, y_col)
            values = pd.to_numeric(df[y_col], errors='coerce').fillna(0).values
            bars = ax.bar(x, values, bottom=bottom, label=label, color=color,
                         edgecolor='white', linewidth=0.5)

            if config.get('show_values', False):
                for i, (bar_obj, val) in enumerate(zip(bars, values)):
                    if val > 0:
                        ax.text(bar_obj.get_x() + bar_obj.get_width() / 2,
                               bottom[i] + val / 2,
                               f'{val:g}', ha='center', va='center',
                               fontsize=8, fontweight='bold', color='white')
            bottom += values
    else:
        width = 0.8 / max(len(y_cols), 1)
        for idx, y_col in enumerate(y_cols):
            offset = (idx - len(y_cols) / 2 + 0.5) * width
            color = color_map.get(y_col, DEFAULT_COLORS[idx % len(DEFAULT_COLORS)])
            label = legend_labels.get(y_col, y_col)
            values = pd.to_numeric(df[y_col], errors='coerce').fillna(0).values
            bars = ax.bar(x + offset, values, width, label=label, color=color,
                         edgecolor='white', linewidth=0.5)

            if config.get('show_values', False):
                for bar_obj, val in zip(bars, values):
                    ax.text(bar_obj.get_x() + bar_obj.get_width() / 2,
                           bar_obj.get_height(),
                           f'{val:g}', ha='center', va='bottom', fontsize=8)

    # Percentage annotations
    if config.get('show_percentages') and config.get('percentage_column'):
        pct_col = config['percentage_column']
        if pct_col in df.columns:
            for i, (_, row) in enumerate(df.iterrows()):
                try:
                    pct_val = float(row[pct_col])
                    y_vals = pd.to_numeric(row[y_cols], errors='coerce').fillna(0)
                    if stacked:
                        max_y = float(y_vals.sum())
                    else:
                        max_y = float(y_vals.max())
                    ax.text(i, max_y * 1.05, f'{pct_val:.1f}%',
                           ha='center', va='bottom',
                           fontsize=9, fontweight='bold', color='navy')
                except Exception:
                    pass

    # Total annotations
    if config.get('total_column') and config['total_column'] in df.columns:
        total_col = config['total_column']
        for i, (_, row) in enumerate(df.iterrows()):
            try:
                total_val = row[total_col]
                y_vals = pd.to_numeric(row[y_cols], errors='coerce').fillna(0)
                if stacked:
                    y_pos = float(y_vals.sum())
                else:
                    y_pos = float(y_vals.max())
                ax.text(i, y_pos * 1.12, f'n={total_val}',
                       ha='center', va='bottom',
                       fontsize=8, color='gray', style='italic')
            except Exception:
                pass

    # Additional annotation columns
    for ann_col in config.get('annotation_columns', []):
        if ann_col in df.columns and ann_col != config.get('percentage_column') and ann_col != config.get('total_column'):
            for i, (_, row) in enumerate(df.iterrows()):
                try:
                    ax.annotate(f'{ann_col}: {row[ann_col]}',
                               xy=(i, 0), xytext=(i, -0.05),
                               textcoords='axes fraction',
                               ha='center', fontsize=7, color='dimgray')
                except Exception:
                    pass

    ax.set_xticks(x)
    ax.set_xticklabels(x_labels, rotation=45, ha='right')
    ax.legend(loc='upper right', framealpha=0.9)
    _apply_chart_style(ax, config)

    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    return output_path


def _render_pareto_chart(df: pd.DataFrame, config: dict, output_path: str) -> str:
    """Render pareto chart with bars sorted descending and cumulative percentage line"""
    fig, ax1 = plt.subplots(figsize=tuple(config.get('figsize', [14, 7])))

    x_col = config['x_column']
    y_col = config['y_columns'][0]  # Pareto uses single value column

    # Sort descending
    df_sorted = df.sort_values(y_col, ascending=False).reset_index(drop=True)
    values = pd.to_numeric(df_sorted[y_col], errors='coerce').fillna(0).values
    x_labels = df_sorted[x_col].astype(str).tolist()
    x = np.arange(len(x_labels))

    # Bars with gradient colors
    colors = plt.cm.Blues(np.linspace(0.4, 0.8, len(x_labels)))
    bars = ax1.bar(x, values, color=colors, edgecolor='white', linewidth=0.5)

    if config.get('show_values', True):
        for bar_obj, val in zip(bars, values):
            ax1.text(bar_obj.get_x() + bar_obj.get_width() / 2,
                    bar_obj.get_height(),
                    f'{val:g}', ha='center', va='bottom',
                    fontsize=8, fontweight='bold')

    ax1.set_xlabel(config.get('x_label', ''), fontsize=12, fontweight='bold')
    ax1.set_ylabel(config.get('y_label', 'Count'), fontsize=12, fontweight='bold', color='steelblue')
    ax1.set_title(config.get('title', 'Pareto Chart'), fontsize=14, fontweight='bold', pad=15)

    # Cumulative line on secondary axis
    ax2 = ax1.twinx()
    total = values.sum()
    if total > 0:
        cumulative_pct = np.cumsum(values) / total * 100
        ax2.plot(x, cumulative_pct, 'r-o', markersize=5, linewidth=2, label='Cumulative %')
        ax2.set_ylabel('Cumulative %', fontsize=12, fontweight='bold', color='red')
        ax2.set_ylim(0, 110)

        # 80% reference line
        ax2.axhline(y=80, color='gray', linestyle='--', alpha=0.5, linewidth=1)
        ax2.text(len(x_labels) - 1, 82, '80%', ha='right', va='bottom', fontsize=9, color='gray')

        # Annotate cumulative percentages
        for i, pct in enumerate(cumulative_pct):
            ax2.annotate(f'{pct:.0f}%', (i, pct),
                        textcoords="offset points", xytext=(0, 10),
                        ha='center', fontsize=8, color='red')

    ax1.set_xticks(x)
    ax1.set_xticklabels(x_labels, rotation=45, ha='right')
    ax1.grid(axis='y', alpha=0.3, linestyle='--')
    ax1.spines['top'].set_visible(False)

    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    return output_path


def _render_line_chart(df: pd.DataFrame, config: dict, output_path: str) -> str:
    """Render line chart for trend analysis"""
    fig, ax = plt.subplots(figsize=tuple(config.get('figsize', [14, 7])))

    x_col = config['x_column']
    y_cols = config['y_columns']
    color_map = config.get('color_map', {})
    legend_labels = config.get('legend_labels', {})

    x_vals = range(len(df))
    x_labels = df[x_col].astype(str).tolist()

    for idx, y_col in enumerate(y_cols):
        color = color_map.get(y_col, DEFAULT_COLORS[idx % len(DEFAULT_COLORS)])
        label = legend_labels.get(y_col, y_col)
        values = pd.to_numeric(df[y_col], errors='coerce').fillna(0).values
        ax.plot(x_vals, values, '-o', color=color, label=label,
               markersize=5, linewidth=2)

        if config.get('show_values', False):
            for i, val in enumerate(values):
                ax.annotate(f'{val:g}', (i, val),
                           textcoords="offset points", xytext=(0, 8),
                           ha='center', fontsize=8)

    ax.set_xticks(list(x_vals))
    ax.set_xticklabels(x_labels, rotation=45, ha='right')
    ax.legend(loc='best', framealpha=0.9)
    _apply_chart_style(ax, config)

    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    return output_path


def _render_boxplot_chart(df: pd.DataFrame, config: dict, output_path: str) -> str:
    """Render box plot or bar chart with error bars for avg/min/max data"""
    fig, ax = plt.subplots(figsize=tuple(config.get('figsize', [14, 7])))

    x_col = config['x_column']
    y_cols = config['y_columns']

    # Detect if data has summary statistics (avg/min/max columns)
    has_summary = any(
        any(kw in col.lower() for kw in ['avg', 'min', 'max', 'mean', 'average'])
        for col in y_cols
    )

    if has_summary and len(y_cols) >= 2:
        # Bar chart with error bars for avg/min/max style data
        x_labels = df[x_col].astype(str).tolist()
        x = np.arange(len(x_labels))

        # Find avg, min, max columns
        avg_col = next(
            (c for c in y_cols if any(kw in c.lower() for kw in ['avg', 'mean', 'average'])),
            y_cols[0]
        )
        min_col = next((c for c in y_cols if 'min' in c.lower()), None)
        max_col = next((c for c in y_cols if 'max' in c.lower()), None)

        avg_vals = pd.to_numeric(df[avg_col], errors='coerce').fillna(0).values

        if min_col and max_col:
            min_vals = pd.to_numeric(df[min_col], errors='coerce').fillna(0).values
            max_vals = pd.to_numeric(df[max_col], errors='coerce').fillna(0).values
            yerr_low = np.maximum(avg_vals - min_vals, 0)
            yerr_high = np.maximum(max_vals - avg_vals, 0)
            yerr = [yerr_low, yerr_high]
        else:
            yerr = None

        bars = ax.bar(x, avg_vals, color='#3498db', edgecolor='white', linewidth=0.5,
                     yerr=yerr, capsize=6,
                     error_kw={'elinewidth': 2, 'capthick': 2, 'color': '#e74c3c'})

        # Annotate bars with avg/min/max values
        for i, bar_obj in enumerate(bars):
            label_parts = [f'Avg: {avg_vals[i]:.1f}']
            if min_col:
                label_parts.append(f'Min: {pd.to_numeric(df[min_col], errors="coerce").fillna(0).values[i]:.1f}')
            if max_col:
                label_parts.append(f'Max: {pd.to_numeric(df[max_col], errors="coerce").fillna(0).values[i]:.1f}')
            y_offset = bar_obj.get_height()
            if yerr is not None:
                y_offset = max_vals[i]
            ax.text(bar_obj.get_x() + bar_obj.get_width() / 2,
                   y_offset * 1.02,
                   '\n'.join(label_parts),
                   ha='center', va='bottom', fontsize=8)

        ax.set_xticks(x)
        ax.set_xticklabels(x_labels, rotation=45, ha='right')
    else:
        # Standard box plot for raw data distributions
        data_to_plot = []
        labels = []
        for y_col in y_cols:
            vals = pd.to_numeric(df[y_col], errors='coerce').dropna().values
            if len(vals) > 0:
                data_to_plot.append(vals)
                labels.append(y_col)

        if data_to_plot:
            bp = ax.boxplot(data_to_plot, labels=labels, patch_artist=True)
            for i, patch in enumerate(bp['boxes']):
                patch.set_facecolor(DEFAULT_COLORS[i % len(DEFAULT_COLORS)])
                patch.set_alpha(0.7)

    _apply_chart_style(ax, config)

    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    return output_path


def _render_pie_chart(df: pd.DataFrame, config: dict, output_path: str) -> str:
    """Render pie chart for distribution/proportion data"""
    fig, ax = plt.subplots(figsize=tuple(config.get('figsize', [10, 8])))

    x_col = config['x_column']
    y_col = config['y_columns'][0]
    color_map = config.get('color_map', {})

    labels = df[x_col].astype(str).tolist()
    values = pd.to_numeric(df[y_col], errors='coerce').fillna(0).values

    colors = [
        color_map.get(label, DEFAULT_COLORS[i % len(DEFAULT_COLORS)])
        for i, label in enumerate(labels)
    ]

    wedges, texts, autotexts = ax.pie(
        values, labels=labels, colors=colors, autopct='%1.1f%%',
        startangle=90, pctdistance=0.85, textprops={'fontsize': 10}
    )

    for autotext in autotexts:
        autotext.set_fontweight('bold')

    ax.set_title(config.get('title', 'Pie Chart'), fontsize=14, fontweight='bold', pad=20)

    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    return output_path


def _render_histogram_chart(df: pd.DataFrame, config: dict, output_path: str) -> str:
    """Render histogram for distribution analysis"""
    fig, ax = plt.subplots(figsize=tuple(config.get('figsize', [14, 7])))

    y_cols = config['y_columns']

    for idx, y_col in enumerate(y_cols):
        values = pd.to_numeric(df[y_col], errors='coerce').dropna().values
        if len(values) > 0:
            color = config.get('color_map', {}).get(y_col, DEFAULT_COLORS[idx % len(DEFAULT_COLORS)])
            label = config.get('legend_labels', {}).get(y_col, y_col)
            ax.hist(values, bins='auto', color=color, alpha=0.7, label=label, edgecolor='white')

    ax.legend(loc='upper right')
    _apply_chart_style(ax, config)

    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    return output_path


def _render_chart(df: pd.DataFrame, config: dict, output_path: str) -> str:
    """Dispatch to the correct chart renderer based on config chart_type"""
    chart_type = config.get('chart_type', 'bar').lower()

    renderers = {
        'bar': _render_bar_chart,
        'grouped_bar': _render_bar_chart,
        'stacked_bar': lambda d, c, o: _render_bar_chart(d, {**c, 'stacked': True}, o),
        'pareto': _render_pareto_chart,
        'line': _render_line_chart,
        'boxplot': _render_boxplot_chart,
        'pie': _render_pie_chart,
        'histogram': _render_histogram_chart,
    }

    renderer = renderers.get(chart_type, _render_bar_chart)
    return renderer(df, config, output_path)


# ============================================================
# MAIN TOOL FUNCTION (registered as MCP tool in server.py)
# ============================================================

async def visualize_data(
    data: str,
    visualization_request: str = "Create an appropriate chart for this data",
    chart_type: str = ""
) -> str:
    """Create charts from database query results.

    Args:
        data: Pass the COMPLETE output from query_database directly. Do not extract or reformat — pass the entire JSON string as-is. The tool will automatically extract the data it needs.
        visualization_request: What chart to create, e.g. "bar chart of pass vs fail by station"
        chart_type: Optional: bar, grouped_bar, stacked_bar, pareto, line, boxplot, pie, histogram

    Returns:
        Report with chart file path and HTTP URL.
    """
    try:
        # Parse input data
        datasets = _parse_input_data(data)
        if not datasets:
            return "Error: No data to visualize"

        _ensure_charts_dir()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        reports = []
        chart_paths = []

        for ds_idx, (ds_name, df) in enumerate(datasets):
            if df.empty:
                reports.append(f"Dataset '{ds_name}': Empty - skipped")
                continue

            # Get chart configuration from LLM
            print(f"  Getting chart config for dataset '{ds_name}' ({len(df)} rows)...")
            config = await _get_chart_config_from_llm(df, visualization_request, chart_type)

            # Override chart_type if explicitly specified by user
            if chart_type:
                config['chart_type'] = chart_type.lower().replace(' ', '_')

            # Generate output path
            chart_filename = f"chart_{timestamp}_{ds_idx + 1}_{config['chart_type']}.png"
            output_path = os.path.join(CHARTS_DIR, chart_filename)

            # Render chart
            try:
                print(f"  Rendering {config['chart_type']} chart: {config.get('title', 'N/A')}...")
                rendered_path = _render_chart(df, config, output_path)
                chart_paths.append(rendered_path)

                # Build chart URL for HTTP access
                chart_url = f"http://127.0.0.1:{CHART_SERVER_PORT}/{chart_filename}"

                report = f"""{'='*60}
VISUALIZATION - Dataset: {ds_name}
{'='*60}

Chart Type: {config.get('chart_type', 'N/A')}
Title: {config.get('title', 'N/A')}
File: {rendered_path}
Chart URL: {chart_url}

Configuration:
  X-Axis: {config.get('x_column', 'N/A')} ({config.get('x_label', '')})
  Y-Axis: {', '.join(config.get('y_columns', []))} ({config.get('y_label', '')})
  Group By: {config.get('group_by', 'None')}
  Stacked: {config.get('stacked', False)}
  Show Values: {config.get('show_values', False)}
  Show Percentages: {config.get('show_percentages', False)}

Data Summary:
  Rows: {len(df)}
  Columns: {', '.join(df.columns.tolist())}

Data Preview:
{df.head(10).to_string(index=False)}

{'='*60}
"""
                reports.append(report)

            except Exception as render_err:
                import traceback
                reports.append(
                    f"Error rendering chart for '{ds_name}': {str(render_err)}\n"
                    f"{traceback.format_exc()}"
                )

        # Combine all reports
        nl = chr(10)
        final_report = f"""
{'='*60}
DATA VISUALIZATION SUMMARY
{'='*60}

Total Datasets: {len(datasets)}
Charts Generated: {len(chart_paths)}
Output Directory: {CHARTS_DIR}
Visualization Request: {visualization_request}
Chart Type: {chart_type if chart_type else 'Auto-selected by LLM'}

Chart Files:
{nl.join(f'  - {p}' for p in chart_paths)}

Chart URLs:
{nl.join(f'  - http://127.0.0.1:{CHART_SERVER_PORT}/{os.path.basename(p)}' for p in chart_paths)}

{''.join(reports)}
"""
        return final_report

    except Exception as e:
        import traceback
        return f"Error creating visualization: {str(e)}\n\nDetails:\n{traceback.format_exc()}"
