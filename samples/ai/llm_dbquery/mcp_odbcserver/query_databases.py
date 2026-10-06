# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
ODBC SuperBuilder - Multi-Database Query Application
Queries data from SQLite databases using ODBC (Auto-discovers all databases)
"""

import pyodbc
import pandas as pd
from typing import Dict
import sys
import os
import glob


class DatabaseConnection:
    """Handles ODBC connection to SQLite databases"""
    
    def __init__(self, database_path: str):
        self.database_path = database_path
        self.database_name = os.path.splitext(os.path.basename(database_path))[0]
        # Extract key name (e.g., 'sophic_db.sqlite' -> 'sophic')
        self.key_name = self.database_name.replace('_db', '')
        self.connection = None
    
    def connect(self):
        """Establish ODBC connection to SQLite"""
        try:
            # Try different SQLite ODBC driver names
            driver_names = [
                "SQLite3 ODBC Driver",
                "SQLite ODBC Driver",
                "SQLite3",
                "SQLite"
            ]
            
            connection_string = None
            for driver in driver_names:
                try:
                    test_string = f"DRIVER={{{driver}}};Database={self.database_path};"
                    self.connection = pyodbc.connect(test_string)
                    connection_string = test_string
                    break
                except pyodbc.Error:
                    continue
            
            if not self.connection:
                raise pyodbc.Error("No SQLite ODBC driver found")
            
            print(f"✓ Connected to {self.database_name} (key: {self.key_name})")
            return True
        except pyodbc.Error as e:
            print(f"✗ Error connecting to {self.database_name}: {e}")
            print(f"  Make sure SQLite ODBC driver is installed")
            print(f"  Download from: http://www.ch-werner.de/sqliteodbc/")
            return False
    
    def execute_query(self, query: str) -> pd.DataFrame:
        """Execute a query and return results as DataFrame"""
        try:
            df = pd.read_sql(query, self.connection)
            return df
        except Exception as e:
            print(f"Error executing query on {self.database_name}: {e}")
            return pd.DataFrame()
    
    def close(self):
        """Close the database connection"""
        if self.connection:
            self.connection.close()
            print(f"✓ Closed connection to {self.database_name}")


class MultiDatabaseQuery:
    """Manages queries across multiple databases (AUTO-DISCOVERS ALL)"""
    
    def __init__(self, db_dir: str = None):
        """
        Initialize multi-database query manager
        
        Args:
            db_dir: Optional custom database directory path
                    If None, uses default './databases' folder in project root
        """
        self.databases = {}
        
        if db_dir is None:
            script_dir = os.path.dirname(__file__)  # mcp_odbcserver folder
            project_root = os.path.dirname(script_dir)  # project root
            self.db_dir = os.path.join(project_root, 'databases')
        else:
            self.db_dir = db_dir
        
        self.auto_discover_databases()
    
    def auto_discover_databases(self):
        """Auto-discover all .sqlite files in the databases folder"""
        print("\n" + "="*60)
        print("🔍 AUTO-DISCOVERING DATABASES")
        print("="*60)
        print(f"Looking in: {self.db_dir}\n")
        
        os.makedirs(self.db_dir, exist_ok=True)
        
        sqlite_files = glob.glob(os.path.join(self.db_dir, '*.sqlite'))
        
        if not sqlite_files:
            print("⚠ No .sqlite files found in databases directory!")
            print(f"  Run generate_db.py first to create the Sophic FCT database")
            return
        
        print(f"Found {len(sqlite_files)} database(s):")
        
        for db_path in sqlite_files:
            db_conn = DatabaseConnection(database_path=db_path)
            self.databases[db_conn.key_name] = db_conn
            print(f"  📁 {db_conn.key_name}: {os.path.basename(db_path)}")
        
        print("\n" + "="*60)

        # Check metadata status after discovery
        self._check_meta_status()
    
    def _check_meta_status(self):
        """Non-blocking check: warn if _meta.json is missing or stale for any DB."""
        try:
            # Import from project root
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            sys.path.insert(0, project_root)
            from schema_bootstrap import check_all_meta_status
            sys.path.pop(0)

            status_map = check_all_meta_status(self.db_dir)
            has_issues = False
            for db_key, status in status_map.items():
                if status == "missing":
                    print(f"  \u26a0 {db_key}: No _meta.json found")
                    has_issues = True
                elif status == "stale":
                    print(f"  \U0001f504 {db_key}: Schema changed, meta is stale")
                    has_issues = True

            if has_issues:
                print(f"  \U0001f4a1 Run: python schema_bootstrap.py  (to generate/update metadata)")
            else:
                for db_key in status_map:
                    print(f"  \u2713 {db_key}: meta OK")
        except Exception as e:
            # Non-fatal: meta checking is optional
            print(f"  \u26a0 Could not check meta status: {e}")

    def connect_all(self) -> bool:
        """Connect to all discovered databases"""
        if not self.databases:
            print("❌ No databases found to connect to!")
            print("   Run generate_db.py first to create the database")
            return False
        
        print("\n" + "="*60)
        print("Connecting to all databases...")
        print("="*60)
        
        success = True
        for name, db in self.databases.items():
            if not db.connect():
                success = False
        
        if success:
            print("\n✓ All databases connected successfully!")
        
        return success
    
    def list_databases(self):
        """List all connected databases with their tables and views"""
        print("\n" + "="*60)
        print("📊 CONNECTED DATABASES SUMMARY")
        print("="*60)
        
        for db_key, db_obj in self.databases.items():
            if db_obj.connection:
                print(f"\n{db_key.upper()} Database ({db_obj.database_name}):")
                
                try:
                    cursor = db_obj.connection.cursor()
                    
                    # Tables
                    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
                    tables = cursor.fetchall()
                    
                    if tables:
                        print(f"  Tables ({len(tables)}):")
                        for table in tables:
                            cursor.execute(f'SELECT COUNT(*) FROM "{table[0]}"')
                            count = cursor.fetchone()[0]
                            print(f"    📋 {table[0]}: {count} rows")
                    
                    # Views
                    cursor.execute("SELECT name FROM sqlite_master WHERE type='view'")
                    views = cursor.fetchall()
                    
                    if views:
                        print(f"  Views ({len(views)}):")
                        for view in views:
                            try:
                                cursor.execute(f'SELECT COUNT(*) FROM "{view[0]}"')
                                count = cursor.fetchone()[0]
                                print(f"    👁 {view[0]}: {count} rows")
                            except Exception:
                                print(f"    👁 {view[0]}: (unable to count)")
                        
                except Exception as e:
                    print(f"  Error querying tables: {e}")
        
        print("\n" + "="*60)
    
    def close_all(self):
        """Close all database connections"""
        print("\n" + "="*60)
        print("Closing all connections...")
        print("="*60)
        
        for name, db in self.databases.items():
            db.close()


def main():
    """Main execution function"""
    print("\n" + "="*60)
    print("ODBC SUPERBUILDER - Sophic FCT Database Query")
    print("="*60)
    
    mdq = MultiDatabaseQuery()
    
    if not mdq.connect_all():
        print("\n⚠ Failed to connect to databases.")
        print("  Run generate_db.py first to create the database")
        sys.exit(1)
    
    try:
        # List all connected databases
        mdq.list_databases()
        
        print("\n" + "="*60)
        print("Database discovery completed successfully!")
        print("="*60)
        
    except Exception as e:
        print(f"\n⚠ Error during query execution: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        mdq.close_all()


if __name__ == "__main__":
    main()