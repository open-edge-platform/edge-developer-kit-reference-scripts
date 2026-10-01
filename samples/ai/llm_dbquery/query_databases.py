# Copyright (C) 2025 Intel Corporation
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
        # Extract key name (e.g., 'sales_db.sqlite' -> 'sales')
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
                    If None, uses default './databases' folder
        """
        self.databases = {}
        
        # Allow custom database directory or use default
        if db_dir is None:
            self.db_dir = os.path.join(os.path.dirname(__file__), 'databases')
        else:
            self.db_dir = db_dir
        
        self.auto_discover_databases()
    
    def auto_discover_databases(self):
        """Auto-discover all .sqlite files in the databases folder"""
        print("\n" + "="*60)
        print("🔍 AUTO-DISCOVERING DATABASES")
        print("="*60)
        print(f"Looking in: {self.db_dir}\n")
        
        # Ensure databases directory exists
        os.makedirs(self.db_dir, exist_ok=True)
        
        # Find all .sqlite files
        sqlite_files = glob.glob(os.path.join(self.db_dir, '*.sqlite'))
        
        if not sqlite_files:
            print("⚠ No .sqlite files found in databases directory!")
            print(f"  Create databases first:")
            print(f"    Manufacturing: python generate_db.py")
            print(f"    Retail:        python generate_retail_db.py")
            return
        
        print(f"Found {len(sqlite_files)} database(s):")
        
        # Create connection for each discovered database
        for db_path in sqlite_files:
            db_conn = DatabaseConnection(database_path=db_path)
            # Use the key_name as the dictionary key (e.g., 'sales', 'inventory', 'customers', 'orders')
            self.databases[db_conn.key_name] = db_conn
            print(f"  📁 {db_conn.key_name}: {os.path.basename(db_path)}")
        
        print("\n" + "="*60)
    
    def connect_all(self) -> bool:
        """Connect to all discovered databases"""
        if not self.databases:
            print("❌ No databases found to connect to!")
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
        """List all connected databases with their tables"""
        print("\n" + "="*60)
        print("📊 CONNECTED DATABASES SUMMARY")
        print("="*60)
        
        for db_key, db_obj in self.databases.items():
            if db_obj.connection:
                print(f"\n{db_key.upper()} Database ({db_obj.database_name}):")
                
                # Get table list
                try:
                    cursor = db_obj.connection.cursor()
                    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
                    tables = cursor.fetchall()
                    
                    if tables:
                        print(f"  Tables: {', '.join([t[0] for t in tables])}")
                        
                        # Get row counts
                        for table in tables:
                            cursor.execute(f"SELECT COUNT(*) FROM {table[0]}")
                            count = cursor.fetchone()[0]
                            print(f"    - {table[0]}: {count} rows")
                    else:
                        print("  No tables found")
                        
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
    print("ODBC SUPERBUILDER - Auto-Discovery Multi-Database Query")
    print("="*60)
    
    # Initialize multi-database query manager (auto-discovers all databases)
    mdq = MultiDatabaseQuery()
    
    # Connect to all databases
    if not mdq.connect_all():
        print("\n⚠ Failed to connect to one or more databases.")
        print("Generate databases first: python generate_db.py (manufacturing) or python generate_retail_db.py (retail)")
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
        # Close all connections
        mdq.close_all()


if __name__ == "__main__":
    main()