# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Startup Check and Initialization Script
Verifies all prerequisites before starting MCP servers
"""

import os
import sys
from pathlib import Path

# Add current directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def check_databases():
    """Check if any databases exist in the databases folder"""
    print("\n" + "="*60)
    print("1️⃣  CHECKING DATABASES")
    print("="*60)
    
    db_dir = os.path.join(os.path.dirname(__file__), 'databases')
    
    if not os.path.exists(db_dir):
        print("⚠ Databases folder not found!")
        print("   Creating databases folder...")
        os.makedirs(db_dir, exist_ok=True)
        print("✓ Databases folder created")
        print("\n📝 Place your .sqlite database files in the 'databases' folder")
        return False
    
    # Find all .sqlite files
    import glob
    sqlite_files = glob.glob(os.path.join(db_dir, '*.sqlite'))
    
    if not sqlite_files:
        print("⚠ No .sqlite files found in databases folder!")
        print("\n📝 Place your .sqlite database files in:")
        print(f"   {db_dir}")
        print("\n💡 Or create sample databases with: python create_databases.py")
        return False
    
    print(f"✓ Found {len(sqlite_files)} database(s):")
    for db_path in sqlite_files:
        db_name = os.path.basename(db_path)
        size = os.path.getsize(db_path)
        print(f"  📁 {db_name} ({size:,} bytes)")
    
    print("\n✅ Databases ready for discovery!")
    return True

def check_schema():
    """Discover and display database schemas for ALL databases"""
    print("\n" + "="*60)
    print("2️⃣  DISCOVERING SCHEMAS (All Databases)")
    print("="*60)
    
    try:
        from query_databases import MultiDatabaseQuery
        
        mdq = MultiDatabaseQuery()
        
        if not mdq.databases:
            print("❌ No databases discovered!")
            print("   Make sure .sqlite files are in the 'databases' folder")
            return False
        
        print(f"\n✓ Discovered {len(mdq.databases)} database(s)")
        
        # Connect and list tables
        if not mdq.connect_all():
            print("❌ Failed to connect to one or more databases!")
            return False
        
        mdq.list_databases()
        
        # Ask user to select primary database(s)
        print("\n" + "="*60)
        print("PRIMARY DATABASE SELECTION")
        print("="*60)
        print("Primary databases are queried directly (no prefix needed).")
        print("All other databases will be attached with prefixes.")
        print("\n💡 TIP: Select multiple primary databases for different use cases")
        print("   (e.g., 'production' for manufacturing, 'sales' for retail)")
        print("\nAvailable databases:")
        
        db_list = list(mdq.databases.keys())
        for idx, db_key in enumerate(db_list, 1):
            print(f"  {idx}. {db_key}")
        
        print("\nOptions:")
        print("  - Press Enter to use intelligent auto-selection (recommended)")
        print("  - Enter single database: 'sales' or '2'")
        print("  - Enter multiple databases: 'sales,production' or '1,7'")
        print("  - Mix names and numbers: 'sales,7,production'")
        
        primary_dbs = []
        
        while True:
            primary_choice = input("\nPrimary database(s) [auto]: ").strip()
            
            # Auto-selection
            if not primary_choice or primary_choice.lower() == 'auto':
                primary_dbs = None
                print("✓ Using intelligent auto-selection")
                break
            
            # Parse comma-separated input
            choices = [c.strip() for c in primary_choice.split(',')]
            selected = []
            invalid = []
            
            for choice in choices:
                # Check if it's a number
                if choice.isdigit():
                    idx = int(choice)
                    if 1 <= idx <= len(db_list):
                        selected.append(db_list[idx - 1])
                    else:
                        invalid.append(choice)
                # Check if it's a database name
                elif choice in mdq.databases:
                    selected.append(choice)
                else:
                    invalid.append(choice)
            
            if invalid:
                print(f"⚠ Invalid selection(s): {', '.join(invalid)}")
                print(f"   Available: {', '.join(db_list)}")
                print(f"   Valid numbers: 1-{len(db_list)}")
                continue
            
            if selected:
                # Remove duplicates while preserving order
                primary_dbs = list(dict.fromkeys(selected))
                if len(primary_dbs) == 1:
                    print(f"✓ Selected '{primary_dbs[0]}' as primary database")
                else:
                    print(f"✓ Selected {len(primary_dbs)} primary databases:")
                    for db in primary_dbs:
                        print(f"  - {db}")
                break
            else:
                print("⚠ No valid databases selected")
                continue
        
        # Perform schema discovery with selected primary database(s)
        print("\n" + "="*60)
        print("PERFORMING SCHEMA DISCOVERY")
        print("="*60)
        
        from nl_query import SchemaDiscovery
        
        # Pass list or single primary database
        if primary_dbs is None:
            # Auto-selection
            schema_info = SchemaDiscovery.discover_all_schemas(mdq.databases)
        elif len(primary_dbs) == 1:
            # Single primary database
            schema_info = SchemaDiscovery.discover_all_schemas(mdq.databases, primary_db=primary_dbs[0])
        else:
            # Multiple primary databases - use first one for initialization, save all
            schema_info = SchemaDiscovery.discover_all_schemas(mdq.databases, primary_db=primary_dbs[0])
            print(f"\n💡 Multiple primary databases selected.")
            print(f"   '{primary_dbs[0]}' is used as default, others saved for reference.")
        
        # Store the selection for later use
        config_file = os.path.join(os.path.dirname(__file__), '.primary_db_config')
        try:
            with open(config_file, 'w') as f:
                if primary_dbs is None:
                    # Auto-selected
                    selected_primary = SchemaDiscovery._primary_db_key
                    f.write(selected_primary)
                    print(f"\n💾 Primary database saved: {selected_primary}")
                elif len(primary_dbs) == 1:
                    # Single selection
                    f.write(primary_dbs[0])
                    print(f"\n💾 Primary database saved: {primary_dbs[0]}")
                else:
                    # Multiple selections - save as comma-separated
                    f.write(','.join(primary_dbs))
                    print(f"\n💾 Primary databases saved: {', '.join(primary_dbs)}")
                
                print(f"   (Stored in {config_file})")
        except Exception as e:
            print(f"⚠ Could not save primary database selection: {e}")
        
        mdq.close_all()
        
        print("\n✅ Schema discovery successful for all databases!")
        return True
        
    except Exception as e:
        print(f"❌ Error during schema discovery: {e}")
        import traceback
        traceback.print_exc()
        return False

def check_odbc_driver():
    """Check if SQLite ODBC driver is installed"""
    print("\n" + "="*60)
    print("3️⃣  CHECKING ODBC DRIVER")
    print("="*60)
    
    try:
        import pyodbc
        drivers = [x for x in pyodbc.drivers() if 'sqlite' in x.lower()]
        
        if drivers:
            print("✓ SQLite ODBC driver(s) found:")
            for driver in drivers:
                print(f"  - {driver}")
            print("\n✅ ODBC driver OK!")
            return True
        else:
            print("❌ No SQLite ODBC driver found!")
            print("\n📥 Download from: http://www.ch-werner.de/sqliteodbc/")
            print("   Install: sqliteodbc_w64.exe (for 64-bit Windows)")
            return False
            
    except ImportError:
        print("❌ pyodbc not installed!")
        print("   Run: pip install pyodbc")
        return False
    except Exception as e:
        print(f"❌ Error checking ODBC driver: {e}")
        return False

def check_llama_server():
    """Check if llama.cpp server is running"""
    print("\n" + "="*60)
    print("4️⃣  CHECKING LLAMA.CPP SERVER")
    print("="*60)
    
    try:
        import requests
        from urllib.parse import urlparse
        
        llama_url = os.getenv('LLAMA_CPP_URL', 'http://127.0.0.1:8080/v1')
        
        # Parse URL to validate components
        parsed = urlparse(llama_url)
        
        # Whitelist validation: allowed schemes
        ALLOWED_SCHEMES = ['http', 'https']
        if parsed.scheme not in ALLOWED_SCHEMES:
            print(f"❌ Invalid URL scheme: {parsed.scheme}")
            return False
        
        # Whitelist validation: allowed hosts (localhost only)
        ALLOWED_HOSTS = ['127.0.0.1', 'localhost', '::1']
        if parsed.hostname not in ALLOWED_HOSTS:
            print(f"❌ Invalid hostname: {parsed.hostname}")
            return False
        
        # Reject path traversal attempts
        if '..' in parsed.path or '\\' in parsed.path:
            print("❌ Path traversal attempt detected in URL")
            return False
        
        # Character-by-character copying to break taint chain
        # Sanitize scheme
        safe_scheme = ''.join(c for c in parsed.scheme if c.isalnum())
        
        # Sanitize hostname
        safe_hostname = ''.join(c for c in (parsed.hostname or '') if c.isalnum() or c in '.-')
        
        # Sanitize port (character-by-character to break taint)
        if parsed.port:
            port_str = str(parsed.port)
            # Only allow numeric characters
            safe_port_num = ''.join(c for c in port_str if c.isdigit())
            # Validate port is in valid range
            if safe_port_num and 1 <= int(safe_port_num) <= 65535:
                safe_port = f":{safe_port_num}"
            else:
                print("❌ Invalid port number")
                return False
        else:
            safe_port = ''
        
        # Sanitize path (alphanumeric + safe URL characters)
        safe_path = ''.join(c for c in parsed.path if c.isalnum() or c in '/_-.')
        
        # Sanitize endpoint
        endpoint = 'models'
        safe_endpoint = ''.join(c for c in endpoint if c.isalnum())
        
        # Reconstruct validated URL (breaks taint chain)
        validated_base = f"{safe_scheme}://{safe_hostname}{safe_port}{safe_path}"
        
        # Ensure path separator before endpoint
        if not validated_base.endswith('/'):
            validated_base += '/'
        
        validated_url = validated_base + safe_endpoint
        
        # Final validation: re-parse and verify the constructed URL
        final_parsed = urlparse(validated_url)
        
        # Verify final URL still has safe scheme
        if final_parsed.scheme not in ALLOWED_SCHEMES:
            print("❌ Final URL validation failed: invalid scheme")
            return False
        
        # Verify final URL still has safe hostname
        if final_parsed.hostname not in ALLOWED_HOSTS:
            print("❌ Final URL validation failed: invalid hostname")
            return False
        
        # Verify no path traversal in final URL
        if '..' in validated_url or '\\' in validated_url:
            print("❌ Final URL validation failed: unsafe characters")
            return False
        
        print(f"Testing connection to: {validated_url}")
        
        # Use validated URL immediately after final check
        response = requests.get(validated_url, timeout=5)
        
        if response.status_code == 200:
            print("✓ llama.cpp server is running!")
            models = response.json()
            if 'data' in models and models['data']:
                print(f"  Model loaded: {models['data'][0].get('id', 'Unknown')}")
            print("\n✅ llama.cpp server OK!")
            return True
        else:
            print(f"⚠ Server responded with status {response.status_code}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to llama.cpp server!")
        print("\n📝 Start llama.cpp server first:")
        print("   llama-server.exe -m path/to/model.gguf --port 8080")
        return False
    except ImportError:
        print("⚠ requests library not installed")
        print("   Run: pip install requests")
        return False
    except Exception as e:
        print(f"❌ Error checking llama.cpp server: {e}")
        return False

def check_python_dependencies():
    """Check if all Python dependencies are installed"""
    print("\n" + "="*60)
    print("5️⃣  CHECKING PYTHON DEPENDENCIES")
    print("="*60)
    
    required_packages = {
        'pyodbc': 'pyodbc',
        'pandas': 'pandas',
        'openai': 'openai',
        'requests': 'requests'
    }
    
    missing = []
    
    for package, import_name in required_packages.items():
        try:
            __import__(import_name)
            print(f"✓ {package} installed")
        except ImportError:
            print(f"❌ {package} NOT installed")
            missing.append(package)
    
    if missing:
        print(f"\n⚠ Missing {len(missing)} package(s)")
        print("   Run: pip install -r requirements.txt")
        return False
    
    print("\n✅ All dependencies installed!")
    return True

def check_mcp_servers():
    """Check if MCP server files exist"""
    print("\n" + "="*60)
    print("6️⃣  CHECKING MCP SERVER FILES")
    print("="*60)
    
    # Use current directory as base
    base_dir = Path(__file__).parent
    
    servers = {
        'mcp_odbcserver': base_dir / 'mcp_odbcserver' / 'server.py',
        'mcp_data_analysis_server': base_dir / 'mcp_data_analysis_server' / 'server.py'
    }
    
    all_exist = True
    
    for name, path in servers.items():
        if path.exists():
            print(f"✓ {name} found: {path}")
        else:
            print(f"❌ {name} NOT FOUND: {path}")
            all_exist = False
    
    if all_exist:
        print("\n✅ All MCP server files exist!")
    else:
        print("\n⚠ Some MCP server files are missing")
    
    return all_exist

def main():
    """Run all startup checks"""
    print("\n" + "="*70)
    print("🚀 ODBC SUPERBUILDER - STARTUP CHECK")
    print("="*70)
    
    checks = [
        ("Databases", check_databases),
        ("Python Dependencies", check_python_dependencies),
        ("ODBC Driver", check_odbc_driver),
        ("Database Schemas", check_schema),
        ("llama.cpp Server", check_llama_server),
        ("MCP Server Files", check_mcp_servers)
    ]
    
    results = {}
    
    for check_name, check_func in checks:
        try:
            results[check_name] = check_func()
        except Exception as e:
            print(f"\n❌ Unexpected error in {check_name}: {e}")
            results[check_name] = False
    
    # Summary
    print("\n" + "="*70)
    print("📊 STARTUP CHECK SUMMARY")
    print("="*70)
    
    for check_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} - {check_name}")
    
    all_passed = all(results.values())
    
    print("\n" + "="*70)
    
    if all_passed:
        print("✅ ALL CHECKS PASSED! Ready to start MCP servers.")
        print("\n📝 Next steps:")
        print("   1. Terminal 1: cd mcp_odbcserver && python server.py start --port 7906")
        print("   2. Terminal 2: cd mcp_data_analysis_server && python server.py start --port 7905")
        print("   3. Connect your MCP client to both servers")
        print("\n💡 The system will automatically discover and work with ALL databases in the 'databases' folder")
    else:
        print("⚠ SOME CHECKS FAILED! Fix the issues above before starting.")
        
        # Provide helpful next steps
        if not results.get("Databases"):
            print("\n🔧 Fix: Add .sqlite files to the 'databases' folder")
            print("      Or run: python create_databases.py (to create sample databases)")
        if not results.get("Python Dependencies"):
            print("🔧 Fix: pip install -r requirements.txt")
        if not results.get("ODBC Driver"):
            print("🔧 Fix: Download and install SQLite ODBC driver")
        if not results.get("llama.cpp Server"):
            print("🔧 Fix: Start llama.cpp server first")
    
    print("="*70 + "\n")
    
    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())