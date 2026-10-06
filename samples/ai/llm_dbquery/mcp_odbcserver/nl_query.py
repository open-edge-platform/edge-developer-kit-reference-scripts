# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Natural Language Query Interface
Converts natural language questions to SQL queries using LLMs
"""

import pyodbc
import pandas as pd
import os
import sys
import json
from typing import Optional, Dict

class SchemaDiscovery:
    """Discovers and caches database schemas"""
    
    # Class-level cache to store discovered schemas
    _schema_cache = {}
    _cache_initialized = False
    
    @staticmethod
    def discover_schema(cursor, database_name: str, prefix: str = '') -> Dict:
        """
        Discover schema for a database (tables AND views)
        
        Args:
            cursor: Database cursor
            database_name: Name of the database
            prefix: Prefix for attached database (empty for primary)
        
        Returns:
            Dictionary with schema information
        """
        print(f"  🔍 Discovering schema for '{database_name}'...")
        
        schema_info = {
            'database_name': database_name,
            'prefix': prefix,
            'tables': {},
            'views': {}
        }
        
        try:
            # Get list of tables
            if prefix:
                query = f"SELECT name FROM {prefix}.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            else:
                query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            
            cursor.execute(query)
            tables = [row[0] for row in cursor.fetchall()]
            
            print(f"    Found {len(tables)} tables: {', '.join(tables)}")
            
            # Get list of views
            if prefix:
                view_query = f"SELECT name FROM {prefix}.sqlite_master WHERE type='view'"
            else:
                view_query = "SELECT name FROM sqlite_master WHERE type='view'"
            
            cursor.execute(view_query)
            views = [row[0] for row in cursor.fetchall()]
            
            if views:
                print(f"    Found {len(views)} views: {', '.join(views)}")
            
            # Discover table schemas
            for table_name in tables:
                table_info = SchemaDiscovery._discover_table_or_view(cursor, table_name, prefix)
                schema_info['tables'][table_name] = table_info
                print(f"      ✓ {table_name}: {len(table_info['columns'])} columns")
            
            # Discover view schemas
            for view_name in views:
                view_info = SchemaDiscovery._discover_table_or_view(cursor, view_name, prefix)
                schema_info['views'][view_name] = view_info
                print(f"      ✓ {view_name} (view): {len(view_info['columns'])} columns")
            
        except Exception as e:
            print(f"    ⚠ Error discovering schema: {e}")
            import traceback
            traceback.print_exc()
        
        return schema_info
    
    @staticmethod
    def _discover_table_or_view(cursor, name: str, prefix: str = '') -> Dict:
        """Discover columns and sample values for a table or view"""
        full_name = f"{prefix}.{name}" if prefix else name
        
        # Get column info using PRAGMA
        if prefix:
            cursor.execute(f"PRAGMA {prefix}.table_info(\"{name}\")")
        else:
            cursor.execute(f"PRAGMA table_info(\"{name}\")")
        
        columns = []
        for col in cursor.fetchall():
            # Hide IsDelete from LLM - views already filter soft-deleted rows
            if col[1] == 'IsDelete':
                continue
            columns.append({
                'name': col[1],
                'type': col[2],
                'notnull': bool(col[3]),
                'default': col[4],
                'pk': bool(col[5])
            })
        
        # Check for unique constraints
        try:
            if prefix:
                cursor.execute(f"PRAGMA {prefix}.index_list(\"{name}\")")
            else:
                cursor.execute(f"PRAGMA index_list(\"{name}\")")
            
            unique_cols = set()
            for idx in cursor.fetchall():
                if idx[2]:  # is unique
                    if prefix:
                        cursor.execute(f"PRAGMA {prefix}.index_info(\"{idx[1]}\")")
                    else:
                        cursor.execute(f"PRAGMA index_info(\"{idx[1]}\")")
                    for col_info in cursor.fetchall():
                        if col_info[1] < len(columns):
                            unique_cols.add(columns[col_info[1]]['name'])
            
            for col in columns:
                if col['name'] in unique_cols:
                    col['unique'] = True
        except Exception:
            pass
        
        # Get sample distinct values for categorical columns
        sample_values = {}
        for col in columns:
            col_name = col['name']
            try:
                if 'TEXT' in col['type'].upper() or 'CHAR' in col['type'].upper() or col['type'] == '':
                    cursor.execute(f'SELECT DISTINCT "{col_name}" FROM {full_name} WHERE "{col_name}" IS NOT NULL LIMIT 10')
                    values = [row[0] for row in cursor.fetchall()]
                    if 0 < len(values) <= 20:
                        sample_values[col_name] = values
            except Exception:
                pass
        
        return {
            'columns': columns,
            'sample_values': sample_values
        }
    
    @classmethod
    def discover_all_schemas(cls, databases: Dict, force_refresh: bool = False, primary_db: str = None) -> Dict:
        """
        Discover schemas for all databases (cached after first call)
        
        Args:
            databases: Dictionary of DatabaseConnection objects
            force_refresh: Force re-discovery even if cached
            primary_db: Optional - specify which database should be primary (no prefix)
        
        Returns:
            Dictionary with all schema information
        """
        # Return cached schema if available and not forcing refresh
        if cls._cache_initialized and not force_refresh:
            print("\n✓ Using cached schema information")
            return cls._schema_cache
        
        print("\n" + "="*60)
        print("🔍 SCHEMA DISCOVERY (ONE-TIME INITIALIZATION)")
        print("="*60)
        
        if not databases:
            print("⚠ No databases provided for schema discovery!")
            return {}
        
        all_schemas = {}
        
        # Determine primary database with intelligent selection
        primary_db_key = None
        
        if primary_db:
            if primary_db in databases:
                primary_db_key = primary_db
                print(f"✓ Using user-specified '{primary_db}' as primary database")
            else:
                print(f"⚠ Specified primary database '{primary_db}' not found!")
                print(f"  Available databases: {', '.join(databases.keys())}")
                print("  Falling back to intelligent selection...")
        
        if not primary_db_key:
            # Priority list - central merged DB preferred, then individual contractors
            priority_names = ['central', 'sophic', 'ems1', 'ems2', 'ems3', 'production', 'sales', 'main', 'orders', 'transactions']
            
            for name in priority_names:
                if name in databases:
                    primary_db_key = name
                    print(f"✓ Auto-selected '{name}' as primary database (priority match)")
                    break
            
            if not primary_db_key:
                print("  Analyzing databases to select primary...")
                max_tables = 0
                for db_key, db_obj in databases.items():
                    try:
                        conn = db_obj.connection
                        cursor = conn.cursor()
                        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
                        table_count = cursor.fetchone()[0]
                        print(f"    {db_key}: {table_count} tables")
                        
                        if table_count > max_tables:
                            max_tables = table_count
                            primary_db_key = db_key
                    except Exception as e:
                        print(f"    {db_key}: error counting tables - {e}")
                
                if primary_db_key:
                    print(f"✓ Auto-selected '{primary_db_key}' as primary (most tables: {max_tables})")
            
            if not primary_db_key:
                primary_db_key = list(databases.keys())[0]
                print(f"⚠ Using fallback: '{primary_db_key}' as primary (first database)")
        
        primary_conn = databases[primary_db_key].connection
        cursor = primary_conn.cursor()
        
        print(f"\n📌 PRIMARY DATABASE: '{primary_db_key}' (no prefix required)")
        print("="*60)
        
        # List all currently attached databases
        print("\nChecking currently attached databases:")
        cursor.execute("SELECT name, file FROM pragma_database_list")
        for row in cursor.fetchall():
            print(f"  - {row[0]}: {row[1]}")
        print()
        
        # Discover primary database first (no prefix)
        primary_schema = cls.discover_schema(
            cursor, 
            primary_db_key,
            prefix=''
        )
        all_schemas[primary_db_key] = primary_schema
        
        # Discover all other databases dynamically
        for db_key, db_obj in databases.items():
            if db_key == primary_db_key:
                continue
            
            try:
                db_path = db_obj.database_path
                db_prefix = f"{db_key}_db"
                
                print(f"\nProcessing database: {db_key}")
                print(f"  Database path: {db_path}")
                print(f"  Prefix: {db_prefix}")
                
                try:
                    cursor.execute(f"DETACH DATABASE {db_prefix}")
                    print(f"  Detached existing {db_prefix}")
                except Exception:
                    pass
                
                print(f"  Attaching {db_key} as {db_prefix}...")
                cursor.execute(f"ATTACH DATABASE '{db_path}' AS {db_prefix}")
                
                cursor.execute(f"SELECT name FROM pragma_database_list WHERE name='{db_prefix}'")
                if cursor.fetchone():
                    print(f"  ✓ Successfully attached {db_prefix}")
                    
                    cursor.execute(f"SELECT name FROM {db_prefix}.sqlite_master WHERE type='table' LIMIT 1")
                    test_table = cursor.fetchone()
                    if test_table:
                        print(f"  ✓ Can query tables from {db_prefix}")
                    else:
                        print(f"  ⚠ WARNING: No tables found in {db_prefix}")
                else:
                    print(f"  ⚠ WARNING: Failed to verify attachment of {db_prefix}")
                    continue
                
                schema = cls.discover_schema(
                    cursor,
                    db_key,
                    prefix=db_prefix
                )
                all_schemas[db_key] = schema
                
            except Exception as e:
                print(f"  ⚠ Error discovering {db_key}: {e}")
                import traceback
                traceback.print_exc()
        
        # Final verification
        print("\n" + "-"*60)
        print("Final attached databases:")
        cursor.execute("SELECT name, file FROM pragma_database_list")
        for row in cursor.fetchall():
            is_primary = "← PRIMARY" if row[0] == "main" else ""
            print(f"  ✓ {row[0]}: {row[1]} {is_primary}")
        
        print("\n" + "="*60)
        print(f"✓ Schema discovery complete: {len(all_schemas)} databases")
        print("  Databases discovered:")
        for db_name, db_info in all_schemas.items():
            table_count = len(db_info.get('tables', {}))
            view_count = len(db_info.get('views', {}))
            prefix = db_info.get('prefix', '(PRIMARY - no prefix)')
            is_primary = "⭐" if db_name == primary_db_key else "  "
            print(f"  {is_primary} {db_name}: {table_count} tables, {view_count} views (prefix: {prefix})")
        print("="*60)
        
        cls._schema_cache = all_schemas
        cls._cache_initialized = True
        cls._primary_db_key = primary_db_key
        
        return all_schemas
    
class NaturalLanguageQuery:
    """Handles natural language to SQL conversion"""
    
    def __init__(self, schema_info: Optional[Dict] = None, primary_db_key: str = None):
        """
        Initialize NL query handler using llama.cpp server
        
        Args:
            schema_info: Dictionary containing discovered schema information
            primary_db_key: Key of the primary database (for meta loading)
        """
        self.client = None
        self.schema_info = schema_info or {}
        self.last_model_reasoning = None
        self.primary_db_key = primary_db_key
        self.meta = self._load_meta()
        self.setup_llm()
        
    def setup_llm(self):
        """Setup the llama.cpp client"""
        try:
            import openai
            base_url = os.getenv("LLAMA_CPP_URL", "http://127.0.0.1:9091/v1")
            self.client = openai.OpenAI(
                base_url=base_url,
                api_key=""
            )
            print(f"✓ Connected to llama.cpp server at {base_url}")
            print("  Make sure llama.cpp server is running!")
        except ImportError:
            print("⚠ openai package not installed. Run: pip install openai")

    def _load_meta(self) -> Dict:
        """Load _meta.json for the primary database if it exists."""
        if not self.primary_db_key:
            return {}
        # Resolve databases/ folder relative to this script's parent (project root)
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        db_dir = os.path.join(project_root, "databases")
        meta_path = os.path.join(db_dir, f"{self.primary_db_key}_meta.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                print(f"  ✓ Loaded metadata: {meta_path}")
                return meta
            except Exception as e:
                print(f"  ⚠ Could not load meta: {e}")
        return {}

    def _get_domain_context(self) -> str:
        """Return domain context — from meta.json if available, else FCT fallback."""
        if self.meta and self.meta.get("description"):
            return self._build_meta_domain_context()
        return self._get_fct_domain_context()

    def _build_meta_domain_context(self) -> str:
        """Build domain context dynamically from _meta.json."""
        meta = self.meta
        parts = []
        parts.append(f"DATABASE CONTEXT:\n{meta['description']}")

        # Table descriptions
        if meta.get("tables"):
            parts.append("\nTABLE GUIDE:")
            for tbl_name, tbl_info in meta["tables"].items():
                desc = tbl_info.get("description", "")
                parts.append(f"- {tbl_name}: {desc}")
                # Column notes for non-obvious columns
                col_descs = tbl_info.get("columns", {})
                for col_name, col_desc in col_descs.items():
                    if col_desc:  # skip empty descriptions
                        parts.append(f"    {col_name}: {col_desc}")

        # View descriptions
        if meta.get("views"):
            parts.append("\nVIEW GUIDE:")
            for vw_name, vw_info in meta["views"].items():
                # Handle both: string (old format) or dict (correct format)
                if isinstance(vw_info, str):
                    desc = vw_info
                else:
                    desc = vw_info.get("description", "") if isinstance(vw_info, dict) else str(vw_info)
                parts.append(f"- {vw_name}: {desc}")

        # JOIN rules
        if meta.get("joins"):
            parts.append("\nJOIN RULES:")
            for j in meta["joins"]:
                parts.append(f"- {j}")

        # Reserved words
        if meta.get("reserved_words"):
            words = ", ".join(f'"{w}"' for w in meta["reserved_words"])
            parts.append(f"\nRESERVED WORDS (always quote these): {words}")

        # General rules
        parts.append("\nGENERAL RULES:")
        parts.append("- ONLY use columns listed in the schema. Never invent column names.")
        parts.append("- Use table aliases in JOINs. Never SELECT * with JOINs.")
        parts.append("- NEVER use IsDelete in any query.")
        parts.append("- SQLite syntax: strftime(), ROUND(), CAST(col AS INTEGER).")
        parts.append("- PRIMARY db: no prefix. ATTACHED db: use prefix.table_name.")

        return "\n".join(parts)

    def _get_fct_domain_context(self) -> str:
        """Fallback FCT-specific domain context (original hardcoded version)."""
        return """
FCT DATABASE CONTEXT:
PCB functional test results for semiconductor testing machines. Multiple EMS (Electronics Manufacturing Services) contractors submit test data.
Each test session (OutputLog) tests one PCB through multiple steps (OutputDetailLog). OutputGUID links sessions to steps. OverallResult: 'Pass'/'Fail'. Step Status: 'Pass'/'Fail'/'Skip'.

TABLE GUIDE:
- vOutputLog: Pre-joined view of OutputLog+OutputDetailLog+UUTInfo. USE THIS for most queries needing station info.
- vOutputLogSMTT: Same as vOutputLog but with aliased column names ("Station_Name", "Overall Result", etc.).
- OutputLog: Session-level data (1 row per PCB). Has UserID, UUTInfoID, SerialNumber, OverallResult, Duration, Date, ErrorCode, ErrorDescription. Does NOT have StationID/StationName/CavityID directly - those come from UUTInfo via JOIN.
- OutputDetailLog: Per-step results (TestStep, Response, Status). Links via OutputGUID.
- UUTInfo: Station/machine info (StationID, StationName, CavityID). JOIN: CAST(OutputLog.UUTInfoID AS INTEGER) = UUTInfo.ID.
- "User": Operators. Always quote as "User". JOIN via OutputLog.UserID = "User".ID.
- RecipeContent: Per-step recipe definitions. Has RecipeGUID, ProcessStepID, RecipeName. JOIN: OutputLog.RecipeContentGUID = RecipeContent.RecipeGUID.
- ProcessStep: Test step definitions (ID, TestStepID, TestName, Type). Links to RecipeContent.ProcessStepID.
- vProcessStep: Pre-joined RecipeContent+ProcessStep view.
- ErrorLog: Error history (CavityID, ErrorCode, ErrorDescription, DateTime). EventLog: System events.

CONTRACTOR NOTES (central DB only):
- The central merged database has ContractorID and ContractorName columns in OutputLog, ErrorLog, EventLog.
- Use ContractorName for grouping/filtering by EMS contractor (e.g., 'Acme EMS', 'Delta Manufacturing', 'Vertex Tech').
- Per-contractor databases (ems1, ems2, ems3) do NOT have these columns.

COLUMN NOTES:
- Date: VARCHAR 'YYYY-MM-DD'. Duration: VARCHAR (CAST to INTEGER for seconds). "Limit": reserved, always quote.
- Response: VARCHAR (numbers, text, or version strings).
- StationName / StationID are in UUTInfo and views, NOT directly in OutputLog. To get station info from OutputLog, JOIN with UUTInfo.
- NEVER use IsDelete in any query.
"""
    
    def _generate_analysis_instructions(self) -> str:
        """Generate dynamic analysis instructions based on discovered schema"""
        if not self.schema_info:
            return ""
        
        instructions = ["""
RETRIEVE COMPREHENSIVE DATA: Include all relevant columns, names (not just IDs), aggregations (counts, averages, min/max), and JOINs for context.
"""]
        
        instructions.append("\nAVAILABLE TABLES AND VIEWS:")
        
        for db_name, db_info in self.schema_info.items():
            prefix = db_info.get('prefix', '')
            
            # Tables
            for table_name, table_info in db_info.get('tables', {}).items():
                full_table_name = f"{prefix}.{table_name}" if prefix else table_name
                columns = table_info.get('columns', [])
                
                pk_cols = [col['name'] for col in columns if col.get('pk')]
                fk_candidates = [col['name'] for col in columns if '_id' in col['name'].lower() or col['name'].lower().endswith('id')]
                
                instructions.append(f"\n📋 {full_table_name} (TABLE):")
                if pk_cols:
                    instructions.append(f"  Primary Key: {', '.join(pk_cols)}")
                if fk_candidates:
                    instructions.append(f"  Foreign Keys: {', '.join(fk_candidates)}")
                
                sample_cols = [col['name'] for col in columns[:6]]
                if len(columns) > 6:
                    sample_cols.append(f"... +{len(columns)-6} more")
                instructions.append(f"  Columns: {', '.join(sample_cols)}")
            
            # Views
            for view_name, view_info in db_info.get('views', {}).items():
                full_view_name = f"{prefix}.{view_name}" if prefix else view_name
                columns = view_info.get('columns', [])
                
                sample_cols = [col['name'] for col in columns[:6]]
                if len(columns) > 6:
                    sample_cols.append(f"... +{len(columns)-6} more")
                instructions.append(f"\n👁 {full_view_name} (VIEW):")
                instructions.append(f"  Columns: {', '.join(sample_cols)}")
        
        instructions.append("\nThis provides rich data for meaningful analysis!")
        
        return "\n".join(instructions)
    
    def _generate_example_queries(self) -> str:
        """Generate example queries — from meta if available, else schema detection."""
        # Tier 1: use meta example_queries if available
        if self.meta and self.meta.get("example_queries"):
            return self._build_meta_examples()

        if not self.schema_info:
            return self._get_static_examples()

        # Tier 2: detect FCT schema by table names
        has_sophic = False
        for db_name, db_info in self.schema_info.items():
            table_names = list(db_info.get('tables', {}).keys()) + list(db_info.get('views', {}).keys())
            if 'OutputLog' in table_names or 'vOutputLog' in table_names:
                has_sophic = True
                break

        if has_sophic:
            return self._get_sophic_examples()

        return self._get_static_examples()

    def _build_meta_examples(self) -> str:
        """Build example queries section from _meta.json."""
        examples = self.meta.get("example_queries", [])
        if not examples:
            return self._get_static_examples()

        parts = ["\nEXAMPLES:\n"]
        for eq in examples:
            q = eq.get("question", "")
            sql = eq.get("sql", "")
            parts.append(f'Q: "{q}"  SQL: {sql}')

        # Append general JOIN rules from meta
        parts.append("\nRULES:")
        parts.append("- In ANY JOIN always assign aliases and qualify ALL columns.")
        if self.meta.get("reserved_words"):
            words = " and ".join(f'"{w}"' for w in self.meta["reserved_words"])
            parts.append(f"- Always quote {words}.")
        if self.meta.get("joins"):
            for j in self.meta["joins"]:
                parts.append(f"- JOIN: {j}")

        return "\n".join(parts)
    
    def _get_sophic_examples(self) -> str:
        """Compact example queries for edge LLM"""
        return """
EXAMPLES:

Q: "Overall pass rate?"  SQL: SELECT OverallResult, COUNT(*) as Count FROM OutputLog GROUP BY OverallResult;
Q: "Failed sessions?"  SQL: SELECT ol.ID, ol.Date, uut.StationName, ol.SerialNumber, ol.ErrorCode, ol.ErrorDescription FROM OutputLog ol JOIN UUTInfo uut ON CAST(ol.UUTInfoID AS INTEGER) = uut.ID WHERE ol.OverallResult = 'Fail' ORDER BY ol.Date DESC;
Q: "Pass rate by station?"  SQL: SELECT uut.StationName, ol.OverallResult, COUNT(DISTINCT ol.ID) as SessionCount FROM OutputLog ol JOIN UUTInfo uut ON CAST(ol.UUTInfoID AS INTEGER) = uut.ID GROUP BY uut.StationName, ol.OverallResult;
Q: "Which step fails most?"  SQL: SELECT TestStep, COUNT(*) as FailCount FROM vOutputLog WHERE Status = 'Fail' GROUP BY TestStep ORDER BY FailCount DESC;
Q: "Tests per operator?"  SQL: SELECT u.Name, COUNT(DISTINCT ol.ID) as TestCount FROM OutputLog ol JOIN "User" u ON ol.UserID = u.ID GROUP BY u.Name ORDER BY TestCount DESC;
Q: "Daily test volume?"  SQL: SELECT ol.Date, COUNT(DISTINCT ol.ID) as Sessions, SUM(CASE WHEN ol.OverallResult='Pass' THEN 1 ELSE 0 END) as Passed, SUM(CASE WHEN ol.OverallResult='Fail' THEN 1 ELSE 0 END) as Failed FROM OutputLog ol GROUP BY ol.Date ORDER BY ol.Date;
Q: "Average, min and max test cycle time per machine/product?"  SQL: SELECT uut.StationName, ROUND(AVG(CAST(ol.Duration AS REAL)), 1) as AvgCycleTime, MIN(CAST(ol.Duration AS INTEGER)) as MinCycleTime, MAX(CAST(ol.Duration AS INTEGER)) as MaxCycleTime FROM OutputLog ol JOIN UUTInfo uut ON CAST(ol.UUTInfoID AS INTEGER) = uut.ID GROUP BY uut.StationName;
Q: "Pareto chart of total quantity tested daily by EMS contractor for similar machines?"  SQL: SELECT ol.Date, ol.ContractorName, uut.StationName, COUNT(*) as TotalTested FROM OutputLog ol JOIN UUTInfo uut ON CAST(ol.UUTInfoID AS INTEGER) = uut.ID GROUP BY ol.Date, ol.ContractorName, uut.StationName ORDER BY TotalTested DESC;
Q: "Daily yield bar chart per machine with percentage, total pass and fail?"  SQL: SELECT ol.Date, uut.StationName, COUNT(*) as Total, SUM(CASE WHEN ol.OverallResult='Pass' THEN 1 ELSE 0 END) as Passed, SUM(CASE WHEN ol.OverallResult='Fail' THEN 1 ELSE 0 END) as Failed, ROUND(SUM(CASE WHEN ol.OverallResult='Pass' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as YieldPct FROM OutputLog ol JOIN UUTInfo uut ON CAST(ol.UUTInfoID AS INTEGER) = uut.ID GROUP BY ol.Date, uut.StationName ORDER BY ol.Date, uut.StationName;

RULES:
- In ANY JOIN always assign aliases and qualify ALL columns.
- Always quote "User" and "Limit".
- OutputLog does NOT have StationID/StationName/CavityID. JOIN with UUTInfo: CAST(ol.UUTInfoID AS INTEGER) = uut.ID.
- ContractorName/ContractorID are only in the central DB's OutputLog. Use for contractor comparisons.
- Duration is VARCHAR. Use CAST(ol.Duration AS INTEGER) or CAST(ol.Duration AS REAL) for math.
"""
    
    def _get_static_examples(self) -> str:
        """Fallback static examples if schema not available"""
        return """
EXAMPLE QUERIES (GOOD):
- Simple: SELECT * FROM table1 WHERE condition = 'value'
- With JOIN: SELECT t1.col1, t1.col2, t2.col1 FROM table1 t1 LEFT JOIN table2 t2 ON t1.id = t2.id

WRONG: SELECT * FROM table1 JOIN table2 (ambiguous)
"""
    
    def get_schema_description(self) -> str:
        """Get compact database schema description for edge LLM"""
        if not self.schema_info:
            return self._get_hardcoded_schema()
        
        schema_parts = ["SCHEMA (only use columns listed below):\n"]
        
        for db_name, db_info in self.schema_info.items():
            prefix = db_info.get('prefix', '')
            
            if prefix:
                schema_parts.append(f"\nATTACHED DB: {db_name} (prefix: {prefix})")
            else:
                schema_parts.append(f"\nPRIMARY DB: {db_name} (no prefix)")
            
            # Describe tables - compact format
            for table_name, table_info in db_info.get('tables', {}).items():
                display_name = f'"{table_name}"' if table_name.upper() in ['USER', 'ORDER', 'GROUP', 'LIMIT'] else table_name
                if prefix:
                    display_name = f"{prefix}.{display_name}"
                
                columns = table_info.get('columns', [])
                col_strs = []
                for col in columns:
                    col_name = col['name']
                    display_col = f'"{col_name}"' if col_name.upper() in ['LIMIT', 'ORDER', 'GROUP', 'USER'] else col_name
                    attrs = []
                    if col.get('pk'):
                        attrs.append("PK")
                    if col.get('unique'):
                        attrs.append("UNIQUE")
                    if any(fk_hint in col_name.lower() for fk_hint in ['_id', 'userid', 'uutinfoid', 'guid']) and not col.get('pk'):
                        attrs.append("FK")
                    attr_str = f"[{','.join(attrs)}]" if attrs else ""
                    col_strs.append(f"{display_col}({col['type']}){attr_str}")
                
                schema_parts.append(f"\nTable {display_name}: {', '.join(col_strs)}")
            
            # Describe views - just column names
            for view_name, view_info in db_info.get('views', {}).items():
                full_view_name = f"{prefix}.{view_name}" if prefix else view_name
                columns = view_info.get('columns', [])
                col_names = [col['name'] for col in columns]
                schema_parts.append(f"\nView {full_view_name}: {', '.join(col_names)}")
        
        # Add rules — from meta if available, else hardcoded FCT rules
        schema_parts.append("\nRULES:")
        schema_parts.append("- ONLY use columns listed above. Never invent column names.")
        schema_parts.append("- Use table aliases in JOINs. Never SELECT * with JOINs.")
        schema_parts.append("- PRIMARY db: no prefix. ATTACHED db: use prefix.table_name.")
        schema_parts.append("- SQLite syntax: strftime(), ROUND(), CAST(col AS INTEGER).")
        schema_parts.append("- NEVER use IsDelete in any query.")

        if self.meta and self.meta.get("reserved_words"):
            words = ", ".join(f'"{w}"' for w in self.meta["reserved_words"])
            schema_parts.append(f"- Quote reserved words: {words}.")
        else:
            schema_parts.append('- Quote reserved words: "User" (table), "Limit" (column).')

        if self.meta and self.meta.get("joins"):
            schema_parts.append("- JOINs: " + ", ".join(self.meta["joins"]))
        else:
            # Fallback: FCT-specific JOINs
            schema_parts.append("- JOINs: OutputLog.OutputGUID=OutputDetailLog.OutputGUID, OutputLog.UserID=\"User\".ID, CAST(OutputLog.UUTInfoID AS INTEGER)=UUTInfo.ID, OutputLog.RecipeContentGUID=RecipeContent.RecipeGUID, RecipeContent.ProcessStepID=ProcessStep.ID")
            schema_parts.append("- OutputLog does NOT have StationID/StationName/CavityID columns. Get station info by JOINing with UUTInfo.")
            schema_parts.append("- Duration is VARCHAR. CAST to INTEGER/REAL for calculations.")
            schema_parts.append("- Prefer vOutputLog (pre-joined view) for test result queries.")

        return "\n".join(schema_parts)
    
    def _get_hardcoded_schema(self) -> str:
        """Fallback hardcoded schema if discovery fails"""
        return """
            DATABASE SCHEMA:
            No schema discovered. Please check database connections.
            """
    
    def convert_to_sql(self, natural_query: str, target_database: str = "sophic", for_analysis: bool = False) -> Optional[str]:
        """
        Convert natural language to SQL
        
        Args:
            natural_query: Natural language question
            target_database: Which database to query
            for_analysis: If True, retrieve comprehensive data for analysis
        
        Returns:
            SQL query string or None if conversion fails
        """
        if not self.client:
            print("⚠ LLM client not initialized")
            return None
        
        schema = self.get_schema_description()
        domain_context = self._get_domain_context()
        
        analysis_instructions = ""
        if for_analysis:
            analysis_instructions = self._generate_analysis_instructions()
        
        example_queries = self._generate_example_queries()
        
        # Build table rules from schema
        table_rules = []
        table_rules.append("Table and View usage rules:")
        for db_name, db_info in self.schema_info.items():
            prefix = db_info.get('prefix', '')
            for table_name in db_info.get('tables', {}).keys():
                display_name = f'"{table_name}"' if table_name.upper() in ['USER', 'ORDER', 'GROUP'] else table_name
                if prefix:
                    table_rules.append(f"- For {table_name}: use \"{prefix}.{display_name}\"")
                else:
                    table_rules.append(f"- For {table_name}: use \"{display_name}\" (NO prefix)")
            for view_name in db_info.get('views', {}).keys():
                if prefix:
                    table_rules.append(f"- For {view_name} (view): use \"{prefix}.{view_name}\"")
                else:
                    table_rules.append(f"- For {view_name} (view): use \"{view_name}\" (NO prefix)")

        # Build system prompt — schema-agnostic preamble
        db_type_hint = ""
        if self.meta and self.meta.get("description"):
            db_type_hint = f" for a database: {self.meta['description']}"
        elif any('OutputLog' in list(db_info.get('tables', {}).keys()) for db_info in self.schema_info.values()):
            db_type_hint = " for an FCT (factory circuit test) database"

        system_prompt = f"""You are a SQL expert. Convert questions to SQLite queries{db_type_hint}.

{domain_context}

{schema}

{chr(10).join(table_rules)}

OUTPUT: Return ONLY the SQL query. No explanations, no markdown. Multiple queries separated by semicolons.
Dates: string comparison (Date BETWEEN '2026-01-01' AND '2026-01-31').
CRITICAL: In any JOIN, ALWAYS assign table aliases and prefix ALL column references with the alias. Unqualified column references cause 'ambiguous column' errors.
{analysis_instructions}

{example_queries}
"""
        
        user_prompt = f"Convert this question to SQL: {natural_query}"
        
        try:
            response = self.client.chat.completions.create(
                model="local-model",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0,
            )
            
            full_response = response.choices[0].message.content.strip()
            
            # Check for reasoning_content (DeepSeek/reasoning models)
            if hasattr(response.choices[0].message, 'reasoning_content') and response.choices[0].message.reasoning_content:
                reasoning_content = response.choices[0].message.reasoning_content.strip()
                
                print("\n🧠 MODEL REASONING:")
                print("=" * 60)
                print("💭 Thinking process:")
                print("-" * 60)
                print(reasoning_content)
                print("-" * 60)
                print("✓ Thinking complete")
                print("=" * 60)
                
                self.last_model_reasoning = reasoning_content
                print(f"\n📝 Model's reasoning stored ({len(reasoning_content)} characters)")
                
                if len(reasoning_content) > 6000:
                    print("⚠ WARNING: Reasoning very long - response may be truncated")
            else:
                print("\n💭 No reasoning content found in model response")
            
            sql_query = full_response
            
            if not sql_query or len(sql_query) < 10:
                print("❌ No SQL query returned by model!")
                print(f"   Response: {full_response[:200]}")
                return None
            
            # Clean up markdown code blocks
            sql_query = sql_query.replace("```sql", "").replace("```", "").strip()
            
            # Validate SQL keywords present
            if not any(keyword in sql_query.upper() for keyword in ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WITH']):
                print("❌ Invalid SQL query - no SQL keywords found!")
                print(f"   Response: {sql_query[:200]}")
                return None
            
            return sql_query
            
        except Exception as e:
            print(f"⚠ Error converting to SQL: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def analyze_results(self, df: pd.DataFrame, analysis_question: str = "What are the key insights and patterns in this data?") -> str:
        """
        Use LLM to analyze query results and provide insights
        
        Args:
            df: DataFrame with query results
            analysis_question: What to analyze
        
        Returns:
            Analysis text from LLM
        """
        if not self.client:
            return "⚠ LLM client not initialized"
        
        if df is None or df.empty:
            return "⚠ No data to analyze"
        
        data_summary = self._prepare_data_summary(df)
        
        # Use meta description for analysis context if available
        if self.meta and self.meta.get("description"):
            analyst_context = f"You are a data analyst. Analyze the data concisely: key findings, patterns, and recommendations. Database context: {self.meta['description']}"
        else:
            analyst_context = "You are a factory test data analyst. Analyze the PCB test data concisely: key findings, failure patterns, and recommendations."
        system_prompt = analyst_context
        
        user_prompt = f"""Data:
{data_summary}

Question: {analysis_question}"""
        
        try:
            response = self.client.chat.completions.create(
                model="local-model",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.3,
                max_tokens=1000
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            return f"⚠ Error analyzing data: {e}"
    
    def _prepare_data_summary(self, df: pd.DataFrame, max_rows: int = 20) -> str:
        """Prepare data summary for LLM analysis"""
        summary_parts = []
        
        summary_parts.append(f"Dataset: {df.shape[0]} rows × {df.shape[1]} columns")
        summary_parts.append(f"Columns: {', '.join(df.columns)}")
        
        if len(df) > max_rows:
            summary_parts.append(f"\nFirst {max_rows} rows:")
            summary_parts.append(df.head(max_rows).to_string(index=False))
            summary_parts.append(f"\n... {len(df) - max_rows} more rows")
        else:
            summary_parts.append("\nAll data:")
            summary_parts.append(df.to_string(index=False))
        
        numeric_cols = df.select_dtypes(include=['number']).columns
        if len(numeric_cols) > 0:
            summary_parts.append("\nNumeric Statistics:")
            summary_parts.append(df[numeric_cols].describe().to_string())
        
        categorical_cols = df.select_dtypes(include=['object']).columns
        for col in categorical_cols:
            if df[col].nunique() <= 15:
                summary_parts.append(f"\n{col} distribution:")
                summary_parts.append(df[col].value_counts().to_string())
        
        return "\n".join(summary_parts)


class NaturalLanguageQueryInterface:
    """Interactive natural language query interface"""
    
    def __init__(self, databases: Dict, primary_db: str = None):
        """Initialize NL query interface"""
        self.databases = databases
        self.db_dir = os.path.join(os.path.dirname(__file__), 'databases')
        
        self.last_sql = None
        self.last_analysis = None
        self.last_question = None
        self.last_model_reasoning = None
        
        # Discover schema ONCE during initialization
        schema_info = SchemaDiscovery.discover_all_schemas(databases, primary_db=primary_db)
        self.primary_db_key = SchemaDiscovery._primary_db_key
        self.nl_query = NaturalLanguageQuery(schema_info, primary_db_key=self.primary_db_key)
    
    def query(self, natural_question: str, execute: bool = True, analyze: bool = False) -> Optional[pd.DataFrame]:
        """
        Process a natural language query
        
        Args:
            natural_question: Question in natural language
            execute: Whether to execute the query (or just return SQL)
            analyze: Whether to run LLM analysis on results
        
        Returns:
            DataFrame with results, list of DataFrames, or None
        """
        print("\n" + "="*60)
        print(f"Natural Language Query: {natural_question}")
        if analyze:
            print("📊 Analysis mode: Retrieving comprehensive data")
        print("="*60)
        
        self.last_question = natural_question
        
        # Convert to SQL
        print("\n🤔 Converting to SQL...")
        sql_query = self.nl_query.convert_to_sql(
            natural_question, 
            target_database=self.primary_db_key,
            for_analysis=analyze
        )
        
        if not sql_query:
            print("❌ Failed to convert query")
            return None
        
        self.last_sql = sql_query
        
        print(f"\n📝 Generated SQL:")
        print("-" * 60)
        print(sql_query)
        print("-" * 60)
        
        if not execute:
            return None
        
        # Execute query
        print("\n⚙ Executing query...")
        
        try:
            queries = [q.strip() for q in sql_query.split(';') if q.strip()]
            results = []
            
            print(f"Using '{self.primary_db_key}' connection (primary database)")
            primary_conn = self.databases[self.primary_db_key].connection
            cursor = primary_conn.cursor()
            
            self._ensure_databases_attached(cursor)
            
            for idx, query in enumerate(queries, 1):
                try:
                    print(f"\nExecuting query {idx}/{len(queries)}...")
                    
                    cursor.execute(query)
                    rows = cursor.fetchall()
                    
                    if rows:
                        columns = [description[0] for description in cursor.description]
                        data = [tuple(row) for row in rows]
                        df = pd.DataFrame(data, columns=columns)
                        results.append(df)
                        print(f"✓ Query {idx} returned {len(df)} rows")
                    else:
                        print(f"⚠ Query {idx} returned no results")
                        
                except Exception as e:
                    print(f"❌ Error executing query {idx}: {e}")
                    import traceback
                    traceback.print_exc()
                    continue
            
            if len(results) == 0:
                print("\n❌ No results from any query")
                return None
            elif len(results) == 1:
                print(f"\n✓ Returning single DataFrame with {len(results[0])} rows")
                result = results[0]
            else:
                print(f"\n✓ Returning list of {len(results)} DataFrames")
                result = results
            
            # Display results
            if isinstance(result, list):
                print(f"\n📊 Total results: {len(result)} tables\n")
                for idx, df in enumerate(result, 1):
                    print(f"\nResult {idx}:")
                    print("-" * 60)
                    print(df.to_string(index=False))
                    print("-" * 60)
            else:
                print("\nResults:")
                print("-" * 60)
                print(result.to_string(index=False))
                print("-" * 60)
            
            # Analysis
            if analyze:
                print("\n📊 Running analysis...")
                if isinstance(result, list):
                    analysis_text = f"Multiple query results returned ({len(result)} datasets)\n\n"
                    for idx, df in enumerate(result, 1):
                        analysis_text += f"Dataset {idx}: {len(df)} rows, {len(df.columns)} columns\n"
                    print("\n" + "="*60)
                    print("ANALYSIS")
                    print("="*60)
                    print(analysis_text)
                    self.last_analysis = analysis_text
                else:
                    analysis = self.nl_query.analyze_results(result, natural_question)
                    print("\n" + "="*60)
                    print("ANALYSIS")
                    print("="*60)
                    print(analysis)
                    self.last_analysis = analysis
            
            return result
            
        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _ensure_databases_attached(self, cursor):
        """Ensure all databases are attached dynamically"""
        try:
            cursor.execute("SELECT name FROM pragma_database_list")
            attached = {row[0] for row in cursor.fetchall()}
            
            for db_key, db_obj in self.databases.items():
                if db_key == self.primary_db_key:
                    continue
                
                db_prefix = f"{db_key}_db"
                db_path = db_obj.database_path
                
                if db_prefix not in attached:
                    print(f"  Attaching {db_key} as {db_prefix}...")
                    cursor.execute(f"ATTACH DATABASE '{db_path}' AS {db_prefix}")
                    
        except Exception as e:
            print(f"⚠ Error ensuring databases attached: {e}")
            for db_key, db_obj in self.databases.items():
                if db_key == self.primary_db_key:
                    continue
                
                db_prefix = f"{db_key}_db"
                db_path = db_obj.database_path
                
                try:
                    cursor.execute(f"DETACH DATABASE {db_prefix}")
                except:
                    pass
                
                try:
                    cursor.execute(f"ATTACH DATABASE '{db_path}' AS {db_prefix}")
                except Exception as e2:
                    print(f"⚠ Could not attach {db_key}: {e2}")
    
    def interactive_mode(self):
        """Start interactive query mode"""
        print("\n" + "="*60)
        print("🎯 Natural Language Query Interface - Sophic FCT Database")
        print("="*60)
        print("\nAsk questions about your PCB test data in plain English!")
        print("Type 'exit' or 'quit' to stop")
        print("Add '+analyze' or '+a' to get AI insights\n")
        print("Example questions:")
        print("  - What is the overall pass rate?")
        print("  - Show all failed test sessions with error details")
        print("  - Which test step fails the most? +analyze")
        print("  - Show pass rate by station +a")
        print("  - How many tests did each operator run?")
        print("  - When was the last maintenance for each station?")
        print("  - Show daily test volume for January 2026")
        print("="*60)
        
        while True:
            try:
                question = input("\n💬 Your question: ").strip()
                
                if question.lower() in ['exit', 'quit', 'q']:
                    print("\n👋 Goodbye!")
                    break
                
                if not question:
                    continue
                
                # Check for analysis flag
                analyze = False
                if "+analyze" in question.lower() or "+a" in question.lower():
                    analyze = True
                    question = question.replace("+analyze", "").replace("+a", "").replace("+Analyze", "").replace("+A", "").strip()
                
                self.query(question, analyze=analyze)
                
            except KeyboardInterrupt:
                print("\n\n👋 Goodbye!")
                break
            except Exception as e:
                print(f"❌ Error: {e}")


def main():
    """Demo natural language queries for Sophic FCT database"""
    from query_databases import MultiDatabaseQuery
    
    print("\n" + "="*60)
    print("🤖 Natural Language Query - Sophic FCT Database")
    print("="*60)
    
    # Setup databases
    mdq = MultiDatabaseQuery()
    if not mdq.connect_all():
        print("❌ Failed to connect to databases")
        print("   Run generate_db.py first to create the database")
        sys.exit(1)
    
    # Show available databases
    print("\n📂 Available databases:")
    for idx, db_key in enumerate(mdq.databases.keys(), 1):
        print(f"  {idx}. {db_key}")
    
    # Primary database selection
    print("\n" + "="*60)
    print("Primary Database Selection")
    print("="*60)
    print("The primary database is queried directly (no prefix needed).")
    print("\nOptions:")
    print("  - Press Enter to auto-select (will pick 'sophic' if available)")
    print(f"  - Enter database name: {', '.join(mdq.databases.keys())}")
    
    primary_choice = input("\nPrimary database [auto]: ").strip().lower()
    
    primary_db = None
    if primary_choice and primary_choice != 'auto':
        if primary_choice in mdq.databases:
            primary_db = primary_choice
        else:
            print(f"⚠ '{primary_choice}' not found, using auto-selection")
    
    # Create NL interface
    print("\nInitializing NL Query Interface...")
    nl_interface = NaturalLanguageQueryInterface(mdq.databases, primary_db=primary_db)
    
    # Demo queries for Sophic FCT
    demo_questions = [
        "What is the overall pass rate?",
        "Show pass rate by station",
        "Which test step fails the most?",
    ]
    
    print("\n" + "="*60)
    print("Running Demo Queries...")
    print("="*60)
    
    for question in demo_questions:
        nl_interface.query(question)
        input("\nPress Enter to continue...")
    
    # Interactive mode
    print("\n" + "="*60)
    start_interactive = input("Start interactive mode? (y/n) [y]: ").strip().lower()
    
    if start_interactive != 'n':
        nl_interface.interactive_mode()
    
    # Cleanup
    mdq.close_all()

if __name__ == "__main__":
    main()