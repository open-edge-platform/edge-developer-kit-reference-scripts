# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
ODBC SuperBuilder - Multi-Database Query Application
Queries data from SQLite databases using ODBC (Auto-discovers all databases)
"""

import pyodbc
import pandas as pd
from typing import Dict, List, Any
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
            print(f"  Create databases first: python create_databases.py")
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
    
    def query_sales_summary(self):
        """Query sales data from sales database"""
        if 'sales' not in self.databases:
            print("⚠ Sales database not found")
            return None
        
        print("\n" + "="*60)
        print("QUERY 1: Sales Summary by Region")
        print("="*60)
        
        query = """
            SELECT 
                region,
                COUNT(*) as total_sales,
                SUM(quantity) as total_quantity,
                SUM(sale_amount) as total_revenue,
                ROUND(AVG(sale_amount), 2) as avg_sale_amount
            FROM sales
            GROUP BY region
            ORDER BY total_revenue DESC;
        """
        
        df = self.databases['sales'].execute_query(query)
        print("\nResults:")
        print(df.to_string(index=False))
        return df
    
    def query_inventory_status(self):
        """Query inventory data from inventory database"""
        if 'inventory' not in self.databases:
            print("⚠ Inventory database not found")
            return None
        
        print("\n" + "="*60)
        print("QUERY 2: Product Inventory by Category")
        print("="*60)
        
        query = """
            SELECT 
                category,
                COUNT(*) as product_count,
                SUM(stock_quantity) as total_stock,
                ROUND(AVG(unit_price), 2) as avg_price,
                warehouse_location
            FROM products
            GROUP BY category, warehouse_location
            ORDER BY category, warehouse_location;
        """
        
        df = self.databases['inventory'].execute_query(query)
        print("\nResults:")
        print(df.to_string(index=False))
        return df
    
    def query_customer_demographics(self):
        """Query customer data from customer database"""
        if 'customers' not in self.databases:
            print("⚠ Customers database not found")
            return None
        
        print("\n" + "="*60)
        print("QUERY 3: Customer Demographics by Tier")
        print("="*60)
        
        query = """
            SELECT 
                customer_tier,
                COUNT(*) as customer_count,
                COUNT(DISTINCT state) as states_covered,
                MIN(registration_date) as earliest_registration,
                MAX(registration_date) as latest_registration
            FROM customers
            GROUP BY customer_tier
            ORDER BY customer_count DESC;
        """
        
        df = self.databases['customers'].execute_query(query)
        print("\nResults:")
        print(df.to_string(index=False))
        return df
    
    def query_unified_cross_database(self):
        """Execute a TRUE cross-database query using SQLite ATTACH"""
        print("\n" + "="*60)
        print("QUERY 4: UNIFIED Cross-Database Query")
        print("="*60)
        print("Joining data from all databases in ONE SQL query!\n")
        
        # Use first database as primary connection
        primary_db_key = list(self.databases.keys())[0]
        primary_conn = self.databases[primary_db_key].connection
        cursor = primary_conn.cursor()
        
        try:
            # Attach all other databases
            attached_dbs = []
            for db_key, db_obj in self.databases.items():
                if db_key == primary_db_key:
                    continue
                
                db_prefix = f"{db_key}_db"
                db_path = db_obj.database_path
                
                # Detach if already attached
                try:
                    cursor.execute(f"DETACH DATABASE {db_prefix}")
                except:
                    pass
                
                # Attach database
                cursor.execute(f"ATTACH DATABASE '{db_path}' AS {db_prefix}")
                attached_dbs.append((db_key, db_prefix))
                print(f"  ✓ Attached {db_key} as {db_prefix}")
            
            # Build dynamic query based on available databases
            if 'sales' in self.databases and 'customers' in self.databases and 'inventory' in self.databases:
                unified_query = """
                    SELECT 
                        s.sale_id,
                        s.sale_date,
                        s.region,
                        c.first_name || ' ' || c.last_name AS customer_name,
                        c.email,
                        c.customer_tier,
                        c.city,
                        c.state,
                        p.product_name,
                        p.category,
                        s.quantity,
                        p.unit_price,
                        s.sale_amount,
                        p.stock_quantity
                    FROM sales s
                    INNER JOIN customer_db.customers c ON s.customer_id = c.customer_id
                    INNER JOIN inventory_db.products p ON s.product_id = p.product_id
                    ORDER BY s.sale_date DESC
                    LIMIT 10;
                """
                
                print("\nExecuting unified query across databases...")
                df = pd.read_sql(unified_query, primary_conn)
                
                print("\nResults - Complete Sales Report:")
                print(df.to_string(index=False))
                
                print(f"\n✓ Successfully queried data from {len(self.databases)} databases in a single query!")
                
                return df
            else:
                print("⚠ Required databases (sales, customers, inventory) not all present")
                return None
            
        except Exception as e:
            print(f"⚠ Error executing cross-database query: {e}")
            import traceback
            traceback.print_exc()
            return None
    
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
        print("Make sure databases are created: python create_databases.py")
        sys.exit(1)
    
    try:
        # List all connected databases
        mdq.list_databases()
        
        # Execute queries if databases exist
        mdq.query_sales_summary()
        mdq.query_inventory_status()
        mdq.query_customer_demographics()
        mdq.query_unified_cross_database()
        
        print("\n" + "="*60)
        print("All queries completed successfully!")
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