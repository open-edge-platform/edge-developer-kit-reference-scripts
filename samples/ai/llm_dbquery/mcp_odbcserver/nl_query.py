# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Natural Language Query Interface
Converts natural language questions to SQL queries using LLMs
"""

import pyodbc
import pandas as pd
import os
import sys
from typing import Optional, Dict

class SchemaDiscovery:
    """Discovers and caches database schemas"""
    
    # Class-level cache to store discovered schemas
    _schema_cache = {}
    _cache_initialized = False
    
    @staticmethod
    def discover_schema(cursor, database_name: str, prefix: str = '') -> Dict:
        """
        Discover schema for a database
        
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
            'tables': {}
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
            
            # For each table, get column information
            for table_name in tables:
                full_table_name = f"{prefix}.{table_name}" if prefix else table_name
                
                # Get column info using PRAGMA
                if prefix:
                    cursor.execute(f"PRAGMA {prefix}.table_info({table_name})")
                else:
                    cursor.execute(f"PRAGMA table_info({table_name})")
                
                columns = []
                for col in cursor.fetchall():
                    columns.append({
                        'name': col[1],
                        'type': col[2],
                        'notnull': bool(col[3]),
                        'default': col[4],
                        'pk': bool(col[5])
                    })
                
                # Check for unique constraints
                if prefix:
                    cursor.execute(f"PRAGMA {prefix}.index_list({table_name})")
                else:
                    cursor.execute(f"PRAGMA index_list({table_name})")
                
                unique_cols = set()
                for idx in cursor.fetchall():
                    if idx[2]:  # is unique
                        if prefix:
                            cursor.execute(f"PRAGMA {prefix}.index_info({idx[1]})")
                        else:
                            cursor.execute(f"PRAGMA index_info({idx[1]})")
                        for col_info in cursor.fetchall():
                            unique_cols.add(columns[col_info[1]]['name'])
                
                for col in columns:
                    if col['name'] in unique_cols:
                        col['unique'] = True
                
                # Get sample distinct values for categorical columns
                sample_values = {}
                for col in columns:
                    col_name = col['name']
                    try:
                        # Only for text columns, get distinct values
                        if 'TEXT' in col['type'].upper() or 'CHAR' in col['type'].upper():
                            cursor.execute(f"SELECT DISTINCT {col_name} FROM {full_table_name} WHERE {col_name} IS NOT NULL LIMIT 10")
                            values = [row[0] for row in cursor.fetchall()]
                            if len(values) <= 20:  # Only store if reasonable cardinality
                                sample_values[col_name] = values
                    except:
                        pass
                
                schema_info['tables'][table_name] = {
                    'columns': columns,
                    'sample_values': sample_values
                }
                
                print(f"      ✓ {table_name}: {len(columns)} columns")
            
        except Exception as e:
            print(f"    ⚠ Error discovering schema: {e}")
            import traceback
            traceback.print_exc()
        
        return schema_info
    
    @classmethod
    def discover_all_schemas(cls, databases: Dict, force_refresh: bool = False, primary_db: str = None) -> Dict:
        """
        Discover schemas for all databases (cached after first call)
        
        Args:
            databases: Dictionary of DatabaseConnection objects
            force_refresh: Force re-discovery even if cached
            primary_db: Optional - specify which database should be primary (no prefix)
                    If None, uses intelligent selection: 'sales' > 'main' > first available
        
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
            # User explicitly specified primary database
            if primary_db in databases:
                primary_db_key = primary_db
                print(f"✓ Using user-specified '{primary_db}' as primary database")
            else:
                print(f"⚠ Specified primary database '{primary_db}' not found!")
                print(f"  Available databases: {', '.join(databases.keys())}")
                print("  Falling back to intelligent selection...")
        
        if not primary_db_key:
            # Intelligent selection priority:
            # 1. 'production' - manufacturing primary database
            # 2. 'sales' - retail/e-commerce primary database
            # 3. 'main' - common default name
            # 4. 'orders' - another common transactional database
            # 5. First database with most tables
            # 6. First database alphabetically
            
            priority_names = ['production', 'sales', 'main', 'orders', 'transactions']
            
            # Try priority names first
            for name in priority_names:
                if name in databases:
                    primary_db_key = name
                    print(f"✓ Auto-selected '{name}' as primary database (priority match)")
                    break
            
            # If no priority match, select database with most tables (heuristic: likely the main one)
            if not primary_db_key:
                print("  Analyzing databases to select primary...")
                max_tables = 0
                for db_key, db_obj in databases.items():
                    try:
                        # Quick table count
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
            
            # Final fallback: first database
            if not primary_db_key:
                primary_db_key = list(databases.keys())[0]
                print(f"⚠ Using fallback: '{primary_db_key}' as primary (first database)")
        
        primary_conn = databases[primary_db_key].connection
        cursor = primary_conn.cursor()
        
        print(f"\n📌 PRIMARY DATABASE: '{primary_db_key}' (no prefix required)")
        print("="*60)
        
        # First, list all currently attached databases
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
                continue  # Skip primary, already done
            
            try:
                db_path = db_obj.database_path
                db_prefix = f"{db_key}_db"  # Generate prefix: customers -> customers_db
                
                print(f"\nProcessing database: {db_key}")
                print(f"  Database path: {db_path}")
                print(f"  Prefix: {db_prefix}")
                
                # Detach if already attached (cleanup)
                try:
                    cursor.execute(f"DETACH DATABASE {db_prefix}")
                    print(f"  Detached existing {db_prefix}")
                except Exception:
                    pass  # Not attached, that's fine
                
                # Attach database
                print(f"  Attaching {db_key} as {db_prefix}...")
                cursor.execute(f"ATTACH DATABASE '{db_path}' AS {db_prefix}")
                
                # Verify attachment
                cursor.execute(f"SELECT name FROM pragma_database_list WHERE name='{db_prefix}'")
                if cursor.fetchone():
                    print(f"  ✓ Successfully attached {db_prefix}")
                    
                    # Verify we can query it
                    cursor.execute(f"SELECT name FROM {db_prefix}.sqlite_master WHERE type='table' LIMIT 1")
                    test_table = cursor.fetchone()
                    if test_table:
                        print(f"  ✓ Can query tables from {db_prefix}")
                    else:
                        print(f"  ⚠ WARNING: No tables found in {db_prefix}")
                else:
                    print(f"  ⚠ WARNING: Failed to verify attachment of {db_prefix}")
                    continue
                
                # Discover schema
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
        
        # Final verification - list all attached databases
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
            prefix = db_info.get('prefix', '(PRIMARY - no prefix)')
            is_primary = "⭐" if db_name == primary_db_key else "  "
            print(f"  {is_primary} {db_name}: {table_count} tables (prefix: {prefix})")
        print("="*60)
        
        # Cache the results with primary db info
        cls._schema_cache = all_schemas
        cls._cache_initialized = True
        cls._primary_db_key = primary_db_key  # Store for later use
        
        return all_schemas
    
class NaturalLanguageQuery:
    """Handles natural language to SQL conversion"""
    
    def __init__(self, schema_info: Optional[Dict] = None):
        """
        Initialize NL query handler using llama.cpp server
        
        Args:
            schema_info: Dictionary containing discovered schema information
        """
        self.client = None
        self.schema_info = schema_info or {}
        self.setup_llm()
        
    def setup_llm(self):
        """Setup the llama.cpp client"""
        try:
            import openai
            # Connect to local llama.cpp server using OpenAI client
            base_url = os.getenv("LLAMA_CPP_URL", "http://127.0.0.1:8080/v1")
            self.client = openai.OpenAI(
                base_url=base_url,
                api_key=""  # llama.cpp doesn't need an API key
            )
            print(f"✓ Connected to llama.cpp server at {base_url}")
            print("  Make sure llama.cpp server is running!")
        except ImportError:
            print("⚠ openai package not installed. Run: pip install openai")
    def _generate_analysis_instructions(self) -> str:
        """Generate dynamic analysis instructions based on discovered schema"""
        if not self.schema_info:
            return ""
        
        instructions = ["""
    IMPORTANT - DATA RETRIEVAL FOR ANALYSIS:
    Since this data will be analyzed by an AI system, retrieve COMPREHENSIVE data:

    1. Include ALL relevant columns (don't be minimal)
    2. Include contextual information (names, not just IDs)
    3. Include aggregations AND details (totals, averages, counts, min/max)
    4. Use JOINs to enrich data
    5. Add calculated fields that provide context
"""]
        
        # Dynamically generate JOIN examples based on discovered schema
        instructions.append("\nAVAILABLE TABLES AND JOINS:")
        
        for db_name, db_info in self.schema_info.items():
            prefix = db_info.get('prefix', '')
            
            for table_name, table_info in db_info.get('tables', {}).items():
                full_table_name = f"{prefix}.{table_name}" if prefix else table_name
                columns = table_info.get('columns', [])
                
                # List key columns
                pk_cols = [col['name'] for col in columns if col.get('pk')]
                fk_candidates = [col['name'] for col in columns if '_id' in col['name'].lower()]
                
                instructions.append(f"\n{full_table_name}:")
                if pk_cols:
                    instructions.append(f"  Primary Key: {', '.join(pk_cols)}")
                if fk_candidates:
                    instructions.append(f"  Foreign Keys: {', '.join(fk_candidates)}")
                
                # Show sample columns for context
                sample_cols = [col['name'] for col in columns[:5]]
                if len(columns) > 5:
                    sample_cols.append(f"... +{len(columns)-5} more")
                instructions.append(f"  Columns: {', '.join(sample_cols)}")
        
        # Generate example query based on actual schema
        instructions.append("\n\nEXAMPLE - Comprehensive query with JOINs:")
        
        # Find primary table (usually first without prefix)
        primary_table = None
        primary_db = None
        for db_name, db_info in self.schema_info.items():
            if not db_info.get('prefix'):
                primary_db = db_info
                if db_info.get('tables'):
                    primary_table = list(db_info['tables'].keys())[0]
                break
        
        if primary_table and primary_db:
            # Build example SELECT with actual columns
            primary_cols = primary_db['tables'][primary_table].get('columns', [])
            example_cols = [f"t1.{col['name']}" for col in primary_cols[:5]]
            
            instructions.append(f"""
SELECT 
    {', '.join(example_cols)},
    -- Add aggregations
    COUNT(*) as total_count,
    AVG(numeric_column) as average_value,
    SUM(amount_column) as total_amount,
    MIN(date_column) as first_date,
    MAX(date_column) as last_date
FROM {primary_table} t1""")
            
            # Add JOIN examples for related tables
            for db_name, db_info in self.schema_info.items():
                prefix = db_info.get('prefix', '')
                if prefix:  # Only show attached databases
                    for table_name in list(db_info.get('tables', {}).keys())[:2]:  # Show first 2 tables
                        full_name = f"{prefix}.{table_name}"
                        instructions.append(f"LEFT JOIN {full_name} ON join_condition")
            
            instructions.append("GROUP BY grouping_columns\nORDER BY total_amount DESC;")
        
        instructions.append("\nThis provides rich data for meaningful analysis!")
        
        return "\n".join(instructions)
    def _generate_example_queries(self) -> str:
        """Generate dynamic example queries based on discovered schema"""
        if not self.schema_info:
            return self._get_static_examples()
        
        examples = ["EXAMPLE QUERIES (GOOD):"]
        
        # Find primary table
        primary_table = None
        primary_db = None
        attached_tables = []
        
        for db_name, db_info in self.schema_info.items():
            prefix = db_info.get('prefix', '')
            if not prefix:
                primary_db = db_info
                if db_info.get('tables'):
                    primary_table = list(db_info['tables'].keys())[0]
            else:
                for table_name in db_info.get('tables', {}).keys():
                    attached_tables.append((f"{prefix}.{table_name}", prefix, table_name))
        
        if primary_table and primary_db:
            # Example 1: Simple query
            examples.append(f"""
- Simple (no join): 
  SELECT * FROM {primary_table} WHERE condition = 'value'
""")
            
            # Example 2: With first attached table
            if len(attached_tables) > 0:
                attached_full, attached_prefix, attached_name = attached_tables[0]
                
                # Get columns from both tables
                primary_cols = [col['name'] for col in primary_db['tables'][primary_table]['columns'][:4]]
                attached_cols = []
                if attached_name in self.schema_info.get(attached_prefix.replace('_db', ''), {}).get('tables', {}):
                    attached_cols = [col['name'] for col in 
                                   list(self.schema_info.values())[1]['tables'][attached_name]['columns'][:3]]
                
                examples.append(f"""
- With {attached_name} join (ALWAYS specify columns):
  SELECT t1.{', t1.'.join(primary_cols)},
         t2.{', t2.'.join(attached_cols) if attached_cols else 'column1, column2'}
  FROM {primary_table} t1 
  LEFT JOIN {attached_full} t2 ON t1.join_key = t2.join_key
""")
            
            # Example 3: Multiple joins
            if len(attached_tables) >= 2:
                attached1 = attached_tables[0][0]
                attached2 = attached_tables[1][0]
                examples.append(f"""
- With multiple joins:
  SELECT t1.col1, t1.col2,
         t2.col1, t2.col2,
         t3.col1, t3.col2
  FROM {primary_table} t1
  LEFT JOIN {attached1} t2 ON t1.key1 = t2.key1
  LEFT JOIN {attached2} t3 ON t1.key2 = t3.key2
""")
        
        examples.append("""
WRONG (DON'T DO THIS):
- SELECT table1.*, table2.* FROM table1 JOIN table2 ... (ambiguous columns)
- SELECT * FROM table1 JOIN table2 ... (ambiguous when joining)
""")
        
        return "\n".join(examples)
    
    def _get_static_examples(self) -> str:
        """Fallback static examples if schema not available"""
        return """
EXAMPLE QUERIES (GOOD):
- Simple: SELECT * FROM table1 WHERE condition = 'value'
- With JOIN: SELECT t1.col1, t1.col2, t2.col1 FROM table1 t1 LEFT JOIN table2 t2 ON t1.id = t2.id

WRONG: SELECT * FROM table1 JOIN table2 (ambiguous)
"""
    def get_schema_description(self) -> str:
        """Get database schema description for the LLM from discovered schema"""
        if not self.schema_info:
            return self._get_hardcoded_schema()
        
        schema_parts = ["DATABASE SCHEMA:\n"]
        schema_parts.append("You have access to SQLite databases that can be queried together.\n")
        schema_parts.append("⚠ CRITICAL: ONLY use columns that exist in the tables below. DO NOT invent column names!\n")
        
        for db_name, db_info in self.schema_info.items():
            prefix = db_info.get('prefix', '')
            is_primary = not prefix
            
            schema_parts.append(f"\n{'='*60}")
            schema_parts.append(f"{'PRIMARY' if is_primary else 'ATTACHED'} DATABASE: {db_name}")
            if prefix:
                schema_parts.append(f"Prefix: {prefix} (use as {prefix}.table_name)")
            else:
                schema_parts.append(f"Primary database (use table_name directly, NO prefix)")
            schema_parts.append(f"{'='*60}")
            
            for table_name, table_info in db_info.get('tables', {}).items():
                full_table_name = f"{prefix}.{table_name}" if prefix else table_name
                
                schema_parts.append(f"\n📋 Table: {full_table_name}")
                schema_parts.append("-" * 60)
                
                # Show columns in a clear format
                columns = table_info.get('columns', [])
                schema_parts.append(f"Columns ({len(columns)} total):")
                
                pk_cols = []
                fk_cols = []
                
                for col in columns:
                    col_name = col['name']
                    col_type = col['type']
                    
                    # Build column description
                    attrs = []
                    if col.get('pk'):
                        attrs.append("PRIMARY KEY")
                        pk_cols.append(col_name)
                    if col.get('notnull'):
                        attrs.append("NOT NULL")
                    if col.get('unique'):
                        attrs.append("UNIQUE")
                    
                    # Detect foreign keys
                    if '_id' in col_name.lower() and not col.get('pk'):
                        attrs.append("LIKELY FK")
                        fk_cols.append(col_name)
                    
                    attr_str = f" [{', '.join(attrs)}]" if attrs else ""
                    schema_parts.append(f"  • {col_name} ({col_type}){attr_str}")
                
                # Show summary of key columns
                if pk_cols:
                    schema_parts.append(f"\n  🔑 Primary Key(s): {', '.join(pk_cols)}")
                if fk_cols:
                    schema_parts.append(f"  🔗 Foreign Key(s): {', '.join(fk_cols)}")
                
                # Add sample values for context
                if table_info.get('sample_values'):
                    schema_parts.append(f"\n  📊 Sample Values:")
                    for col_name, values in table_info['sample_values'].items():
                        if values and len(values) <= 10:
                            values_str = ', '.join(map(str, values[:5]))
                            if len(values) > 5:
                                values_str += f" (+{len(values)-5} more)"
                            schema_parts.append(f"     {col_name}: {values_str}")
                
                schema_parts.append("")  # Blank line between tables
        
        # Add critical rules at the end
        schema_parts.append("\n" + "="*60)
        schema_parts.append("⚠ CRITICAL RULES - READ CAREFULLY!")
        schema_parts.append("="*60)
        schema_parts.append("")
        schema_parts.append("1. COLUMN VALIDATION:")
        schema_parts.append("   - ONLY use columns listed above for each table")
        schema_parts.append("   - DO NOT assume a column exists without checking")
        schema_parts.append("   - Example: machines table has 'utilization_rate', NOT 'duration_hours'")
        schema_parts.append("   - Example: maintenance_logs has 'duration_hours', NOT 'utilization_rate'")
        schema_parts.append("")
        schema_parts.append("2. TABLE ALIASES:")
        schema_parts.append("   - When using aliases (e.g., ma, ml, pr), remember which table each alias refers to")
        schema_parts.append("   - Use ma.column_from_machines_table NOT ma.column_from_other_table")
        schema_parts.append("")
        schema_parts.append("3. JOIN VALIDATION:")
        schema_parts.append("   - Verify join columns exist in BOTH tables")
        schema_parts.append("   - Check foreign key columns match (e.g., machine_id in both tables)")
        schema_parts.append("   - If uncertain, keep query simple (single table)")
        schema_parts.append("")
        schema_parts.append("4. PREFIXES:")
        schema_parts.append("   - PRIMARY database tables: NO prefix (just table_name)")
        schema_parts.append("   - ATTACHED database tables: USE prefix (prefix.table_name)")
        schema_parts.append("   - Example: production_runs (primary, no prefix)")
        schema_parts.append("   - Example: equipment_db.machines (attached, use prefix)")
        schema_parts.append("")
        schema_parts.append("5. SQLITE SYNTAX:")
        schema_parts.append("   - Use strftime() for date operations")
        schema_parts.append("   - Use ROUND() for decimals")
        schema_parts.append("   - Use COALESCE() for NULL handling")
        schema_parts.append("   - Use explicit column names with table aliases (t1.col1, t2.col2)")
        schema_parts.append("")
        schema_parts.append("6. BEFORE WRITING SQL:")
        schema_parts.append("   a) Identify which tables you need")
        schema_parts.append("   b) List columns from EACH table that you'll use")
        schema_parts.append("   c) Verify EVERY column exists in the schema above")
        schema_parts.append("   d) Check join keys exist in both tables")
        schema_parts.append("   e) Write the query with correct table aliases")
        
        return "\n".join(schema_parts)
    
    def _get_hardcoded_schema(self) -> str:
        """Fallback hardcoded schema if discovery fails"""
        return """
            DATABASE SCHEMA:
            // ...existing hardcoded schema...
            """
    
    def convert_to_sql(self, natural_query: str, target_database: str = "sales", for_analysis: bool = False) -> Optional[str]:
        """
        Convert natural language to SQL
        
        Args:
            natural_query: Natural language question
            target_database: Which database to query (sales, inventory, customers, or 'all')
            for_analysis: If True, retrieve comprehensive data for analysis
        
        Returns:
            SQL query string or None if conversion fails
        """
        if not self.client:
            print("⚠ LLM client not initialized")
            return None
        
        schema = self.get_schema_description()
        
        # Generate dynamic instructions based on schema
        analysis_instructions = ""
        if for_analysis:
            analysis_instructions = self._generate_analysis_instructions()
        
        # Generate dynamic examples
        example_queries = self._generate_example_queries()
        
        # Dynamically build table rules from schema
        table_rules = []
        table_rules.append("Table usage rules:")
        for db_name, db_info in self.schema_info.items():
            prefix = db_info.get('prefix', '')
            for table_name in db_info.get('tables', {}).keys():
                if prefix:
                    table_rules.append(f"- For {table_name}: use \"{prefix}.{table_name}\"")
                else:
                    table_rules.append(f"- For {table_name}: use \"{table_name}\" (NO prefix, NO database name)")
        
            system_prompt = f"""You are a SQL expert. Convert natural language questions to SQLite queries for ODBC connections.

{schema}

⚠ BEFORE WRITING SQL - VERIFICATION CHECKLIST:
1. List the tables you need
2. For EACH table, list the columns you'll use
3. Verify EVERY column exists in the schema above
4. For JOINs, verify join columns exist in BOTH tables
5. Check that you're using the correct alias for each column

EXAMPLE VERIFICATION:
Question: "Show production output and downtime by line"
Tables needed:
  - production_runs (alias: pr) - has: line_id, actual_quantity
  - equipment_db.machines (alias: m) - has: machine_id, line_id, utilization_rate
  - equipment_db.maintenance_logs (alias: ml) - has: machine_id, duration_hours
Columns to use:
  - pr.line_id ✓ exists
  - pr.actual_quantity ✓ exists  
  - m.line_id ✓ exists
  - ml.duration_hours ✓ exists (NOT m.duration_hours ✗)
  - m.utilization_rate ✓ exists (NOT ml.utilization_rate ✗)

CRITICAL RULES:
1. Return SQL query or queries, no explanations or markdown
2. Multiple queries allowed, separate with semicolons
3. Use SQLite syntax (not PostgreSQL or MySQL)
{chr(10).join(table_rules)}
4. DO NOT write ATTACH DATABASE statements (already handled)
5. DO NOT include .sqlite in table names
6. Use proper JOINs when needed
7. Use ROUND() for decimal precision
8. For dates, use strftime() function
9. NEVER use SELECT * when joining - Always specify columns with table aliases
10. VERIFY every column name before using it

REASONING CONSTRAINT:
- Keep reasoning brief (max 500 tokens)
- Focus on: table selection, COLUMN VERIFICATION, join logic
- List columns you'll use and verify they exist
- Skip verbose explanations
- Prioritize completing valid SQL with correct column names

{analysis_instructions}

{example_queries}

Target database: {target_database}
"""
        
        user_prompt = f"Convert this question to SQL: {natural_query}"
        
        try:
            # Non-streaming version to capture reasoning
            response = self.client.chat.completions.create(
                model="local-model",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0,
            
                
            )
            
            # Get the SQL content
            full_response = response.choices[0].message.content.strip()
            
            # Check for reasoning_content field (DeepSeek/reasoning models)
            if hasattr(response.choices[0].message, 'reasoning_content') and response.choices[0].message.reasoning_content:
                reasoning_content = response.choices[0].message.reasoning_content.strip()
                
                # Display reasoning
                print("\n🧠 MODEL REASONING:")
                print("=" * 60)
                print("💭 Thinking process (DeepSeek reasoning format):")
                print("-" * 60)
                print(reasoning_content)
                print("-" * 60)
                print("✓ Thinking complete")
                print("=" * 60)
                
                # Store reasoning for later use
                self.last_model_reasoning = reasoning_content
                print(f"\n📝 Model's reasoning stored ({len(reasoning_content)} characters)")
                
                # Check if reasoning was truncated (incomplete thought)
                if len(reasoning_content) > 6000:
                    print("⚠ WARNING: Reasoning very long - response may be truncated")
            else:
                print("\n💭 No reasoning content found in model response")
            
            sql_query = full_response
            
            # Validate that we got a SQL query
            if not sql_query or len(sql_query) < 10:
                print("❌ No SQL query returned by model!")
                print(f"   Response: {full_response[:200]}")
                if hasattr(response.choices[0].message, 'reasoning_content'):
                    print("   Model may have only returned reasoning without SQL")
                    print("   Try: Simplify the query or increase max_tokens")
                return None
            
            # Clean up the SQL (remove markdown code blocks if present)
            sql_query = sql_query.replace("```sql", "").replace("```", "").strip()
            
            # Final validation
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
        
        # Prepare data summary for LLM
        data_summary = self._prepare_data_summary(df)
        
        system_prompt = """You are a data analyst expert. Analyze the provided data and provide actionable insights.

Provide:
- Key findings and trends
- Statistical observations
- Patterns or anomalies
- Business recommendations

Be concise, clear, and data-driven."""
        
        user_prompt = f"""Data to analyze:

{data_summary}

Question: {analysis_question}

Your analysis:"""
        
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
        
        # Basic info
        summary_parts.append(f"Dataset: {df.shape[0]} rows × {df.shape[1]} columns")
        summary_parts.append(f"Columns: {', '.join(df.columns)}")
        
        # Sample data
        if len(df) > max_rows:
            summary_parts.append(f"\nFirst {max_rows} rows:")
            summary_parts.append(df.head(max_rows).to_string(index=False))
            summary_parts.append(f"\n... {len(df) - max_rows} more rows")
        else:
            summary_parts.append("\nAll data:")
            summary_parts.append(df.to_string(index=False))
        
        # Numeric statistics
        numeric_cols = df.select_dtypes(include=['number']).columns
        if len(numeric_cols) > 0:
            summary_parts.append("\nNumeric Statistics:")
            summary_parts.append(df[numeric_cols].describe().to_string())
        
        # Categorical distributions (for small cardinality)
        categorical_cols = df.select_dtypes(include=['object']).columns
        for col in categorical_cols:
            if df[col].nunique() <= 15:  # Only show if reasonable number of unique values
                summary_parts.append(f"\n{col} distribution:")
                summary_parts.append(df[col].value_counts().to_string())
        
        return "\n".join(summary_parts)


class NaturalLanguageQueryInterface:
    """Interactive natural language query interface"""
    
    def __init__(self, databases: Dict, primary_db: str = None):
        """Initialize NL query interface"""
        self.databases = databases
        self.db_dir = os.path.join(os.path.dirname(__file__), 'databases')
        
        # Add attributes to store reasoning
        self.last_sql = None
        self.last_analysis = None
        self.last_question = None
        self.last_model_reasoning = None  # ADD THIS: Store model's thinking process
        
        # Discover schema ONCE during initialization
        schema_info = SchemaDiscovery.discover_all_schemas(databases, primary_db=primary_db)
        self.primary_db_key = SchemaDiscovery._primary_db_key
        self.nl_query = NaturalLanguageQuery(schema_info)
    
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
        
        # Convert to SQL with analysis flag
        print("\n🤔 Converting to SQL...")
        sql_query = self.nl_query.convert_to_sql(
            natural_question, 
            target_database="all",
            for_analysis=analyze
        )
        
        if not sql_query:
            print("❌ Failed to convert query")
            return None
        
        print(f"\n📝 Generated SQL:")
        print("-" * 60)
        print(sql_query)
        print("-" * 60)
        
        if not execute:
            return None
        
        # Execute query
        print("\n⚙ Executing query...")
        
        try:
            # Split multiple queries if they exist
            queries = [q.strip() for q in sql_query.split(';') if q.strip()]
            results = []
            
            # Use primary database connection
            print(f"Using '{self.primary_db_key}' connection (primary database)")
            primary_conn = self.databases[self.primary_db_key].connection
            cursor = primary_conn.cursor()
            
            # Ensure other databases are attached
            self._ensure_databases_attached(cursor)
            
            for idx, query in enumerate(queries, 1):
                try:
                    print(f"\nExecuting query {idx}/{len(queries)}...")
                    
                    # Execute with ODBC cursor
                    cursor.execute(query)
                    
                    # Fetch results
                    rows = cursor.fetchall()
                    
                    if rows:
                        # Get column names from cursor description
                        columns = [description[0] for description in cursor.description]
                        
                        # Convert pyodbc.Row objects to tuples
                        data = [tuple(row) for row in rows]
                        
                        # Create DataFrame
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
            
            # Return results based on count
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
                else:
                    analysis = self.nl_query.analyze_results(result, natural_question)
                    print("\n" + "="*60)
                    print("ANALYSIS")
                    print("="*60)
                    print(analysis)
            
            return result
            
        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _ensure_databases_attached(self, cursor):
        """Ensure all databases are attached dynamically"""
        try:
            # Get list of currently attached databases
            cursor.execute("SELECT name FROM pragma_database_list")
            attached = {row[0] for row in cursor.fetchall()}
            
            # Attach all databases except the primary one
            for db_key, db_obj in self.databases.items():
                if db_key == self.primary_db_key:
                    continue  # Skip primary database
                
                db_prefix = f"{db_key}_db"
                db_path = db_obj.database_path
                
                # Attach only if not already attached
                if db_prefix not in attached:
                    print(f"  Attaching {db_key} as {db_prefix}...")
                    cursor.execute(f"ATTACH DATABASE '{db_path}' AS {db_prefix}")
                    
        except Exception as e:
            print(f"⚠ Error ensuring databases attached: {e}")
            # Try to reattach all
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
    
    # ...existing interactive_mode code...
    
    def interactive_mode(self):
        """Start interactive query mode"""
        print("\n" + "="*60)
        print("🎯 Natural Language Query Interface")
        print("="*60)
        print("\nAsk questions about your data in plain English!")
        print("Type 'exit' or 'quit' to stop")
        print("Add '+analyze' or '+a' to get AI insights\n")
        print("Example questions:")
        print("  - Show me total sales by region +analyze")
        print("  - What are the top 5 customers by revenue? +a")
        print("  - Which products are low in stock?")
        print("  - Show sales with customer names and product details +analyze")
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
    """Demo natural language queries"""
    from query_databases import MultiDatabaseQuery
    
    print("\n" + "="*60)
    print("🤖 Natural Language Query Demo")
    print("="*60)
    
    # Setup databases
    mdq = MultiDatabaseQuery()
    if not mdq.connect_all():
        print("❌ Failed to connect to databases")
        sys.exit(1)
    
    # Show available databases
    print("\n📂 Available databases:")
    for idx, db_key in enumerate(mdq.databases.keys(), 1):
        print(f"  {idx}. {db_key}")
    
    # Ask user to select primary database (optional)
    print("\n" + "="*60)
    print("Primary Database Selection")
    print("="*60)
    print("The primary database is queried directly (no prefix needed).")
    print("All other databases will be attached with prefixes.")
    print("\nOptions:")
    print("  - Press Enter to use intelligent auto-selection")
    print("  - Enter database name (e.g., 'sales', 'orders', 'customer')")
    
    primary_choice = input("\nPrimary database [auto]: ").strip().lower()
    
    primary_db = None
    if primary_choice and primary_choice != 'auto':
        if primary_choice in mdq.databases:
            primary_db = primary_choice
        else:
            print(f"⚠ '{primary_choice}' not found, using auto-selection")
    
    # Create NL interface (schema discovery happens automatically in __init__)
    print("\nInitializing NL Query Interface...")
    nl_interface = NaturalLanguageQueryInterface(mdq.databases, primary_db=primary_db)
    
    # Demo queries
    demo_questions = [
        "Show me total sales by region",
        "What are the top 3 customers by total spending?",
        "List all Electronics products with their stock levels",
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
