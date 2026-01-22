# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sqlite3
import os
from datetime import datetime, timedelta
import secrets

def secure_randint(a, b):
    """Generate random integer in range [a, b] using secrets"""
    return secrets.randbelow(b - a + 1) + a

def secure_uniform(a, b):
    """Generate random float in range [a, b) using secrets"""
    return a + (b - a) * (secrets.randbelow(10000000) / 10000000)

def secure_choice(seq):
    """Choose random element from sequence using secrets"""
    return seq[secrets.randbelow(len(seq))]

def secure_choices(population, weights=None, k=1):
    """Choose k elements with weights using secrets"""
    if weights is None:
        return [secure_choice(population) for _ in range(k)]
    
    # Weighted choice implementation
    total = sum(weights)
    cumulative = []
    cumsum = 0
    for w in weights:
        cumsum += w
        cumulative.append(cumsum)
    
    result = []
    for _ in range(k):
        r = secure_uniform(0, total)
        for i, cum_weight in enumerate(cumulative):
            if r <= cum_weight:
                result.append(population[i])
                break
    return result

def secure_random():
    """Generate random float in [0.0, 1.0) using secrets"""
    return secrets.randbelow(10000000) / 10000000

def create_production_database():
    """Create and populate production database"""
    db_path = os.path.join('databases', 'production.sqlite')
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create production_runs table
    cursor.execute('''
        CREATE TABLE production_runs (
            run_id INTEGER PRIMARY KEY,
            product_id INTEGER NOT NULL,
            line_id INTEGER NOT NULL,
            shift_id INTEGER NOT NULL,
            start_time DATETIME NOT NULL,
            end_time DATETIME,
            planned_quantity INTEGER NOT NULL,
            actual_quantity INTEGER NOT NULL,
            defect_quantity INTEGER DEFAULT 0,
            status VARCHAR(20) NOT NULL,
            operator_id INTEGER NOT NULL
        )
    ''')
    
    # Insert sample production data
    statuses = ['Completed', 'In Progress', 'Paused', 'Completed', 'Completed']
    base_date = datetime(2024, 1, 1)
    
    for i in range(1, 101):  # 100 production runs
        start_time = base_date + timedelta(days=secure_randint(0, 330), hours=secure_randint(0, 23))
        duration_hours = secure_randint(2, 12)
        end_time = start_time + timedelta(hours=duration_hours)
        planned_qty = secure_randint(100, 1000)
        efficiency = secure_uniform(0.85, 1.0)
        actual_qty = int(planned_qty * efficiency)
        defect_qty = int(actual_qty * secure_uniform(0.01, 0.05))
        
        cursor.execute('''
            INSERT INTO production_runs (run_id, product_id, line_id, shift_id, start_time, end_time, 
                                        planned_quantity, actual_quantity, defect_quantity, status, operator_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            i,
            secure_randint(2001, 2010),
            secure_randint(1, 5),
            secure_randint(1, 3),
            start_time.strftime('%Y-%m-%d %H:%M:%S'),
            end_time.strftime('%Y-%m-%d %H:%M:%S'),
            planned_qty,
            actual_qty,
            defect_qty,
            secure_choice(statuses),
            secure_randint(5001, 5025)
        ))
    
    conn.commit()
    conn.close()
    print(f"✓ Created {db_path} with 100 production runs")

def create_equipment_database():
    """Create and populate equipment database"""
    db_path = os.path.join('databases', 'equipment.sqlite')
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create machines table
    cursor.execute('''
        CREATE TABLE machines (
            machine_id INTEGER PRIMARY KEY,
            machine_name VARCHAR(100) NOT NULL,
            machine_type VARCHAR(50) NOT NULL,
            line_id INTEGER NOT NULL,
            manufacturer VARCHAR(100),
            installation_date DATE,
            last_maintenance DATE,
            next_maintenance DATE,
            status VARCHAR(20) NOT NULL,
            utilization_rate DECIMAL(5, 2)
        )
    ''')
    
    # Create maintenance_logs table
    cursor.execute('''
        CREATE TABLE maintenance_logs (
            log_id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_id INTEGER NOT NULL,
            maintenance_date DATE NOT NULL,
            maintenance_type VARCHAR(50) NOT NULL,
            technician_id INTEGER NOT NULL,
            duration_hours DECIMAL(5, 2) NOT NULL,
            cost DECIMAL(10, 2),
            notes TEXT,
            FOREIGN KEY (machine_id) REFERENCES machines(machine_id)
        )
    ''')
    
    # Insert sample machines
    machines = [
        (101, 'CNC Mill A1', 'CNC Milling', 1, 'Haas Automation', '2022-03-15', '2024-10-20', '2025-01-20', 'Operational', 87.5),
        (102, 'CNC Mill A2', 'CNC Milling', 1, 'Haas Automation', '2022-03-20', '2024-10-22', '2025-01-22', 'Operational', 92.3),
        (103, 'Lathe B1', 'CNC Lathe', 2, 'DMG MORI', '2021-08-10', '2024-11-01', '2025-02-01', 'Operational', 78.4),
        (104, 'Lathe B2', 'CNC Lathe', 2, 'DMG MORI', '2021-08-15', '2024-11-03', '2025-02-03', 'Maintenance', 0.0),
        (105, 'Press C1', 'Hydraulic Press', 3, 'Schuler Group', '2020-05-20', '2024-09-15', '2024-12-15', 'Operational', 95.2),
        (106, 'Press C2', 'Hydraulic Press', 3, 'Schuler Group', '2020-05-25', '2024-09-18', '2024-12-18', 'Operational', 89.7),
        (107, 'Welder D1', 'Robotic Welder', 4, 'FANUC', '2023-01-10', '2024-11-10', '2025-02-10', 'Operational', 82.1),
        (108, 'Welder D2', 'Robotic Welder', 4, 'FANUC', '2023-01-15', '2024-11-12', '2025-02-12', 'Operational', 85.6),
        (109, 'Assembly E1', 'Assembly Robot', 5, 'ABB Robotics', '2022-11-05', '2024-10-05', '2025-01-05', 'Operational', 91.3),
        (110, 'Assembly E2', 'Assembly Robot', 5, 'ABB Robotics', '2022-11-10', '2024-10-08', '2025-01-08', 'Operational', 88.9)
    ]
    
    cursor.executemany('''
        INSERT INTO machines (machine_id, machine_name, machine_type, line_id, manufacturer, 
                            installation_date, last_maintenance, next_maintenance, status, utilization_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', machines)
    
    # Insert maintenance logs
    maintenance_types = ['Preventive', 'Corrective', 'Inspection', 'Calibration', 'Emergency']
    base_date = datetime(2024, 1, 1)
    
    for i in range(50):  # 50 maintenance records
        maint_date = base_date + timedelta(days=secure_randint(0, 330))
        
        cursor.execute('''
            INSERT INTO maintenance_logs (machine_id, maintenance_date, maintenance_type, technician_id, 
                                         duration_hours, cost, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            secure_randint(101, 110),
            maint_date.strftime('%Y-%m-%d'),
            secure_choice(maintenance_types),
            secure_randint(6001, 6010),
            round(secure_uniform(1.0, 8.0), 2),
            round(secure_uniform(200, 3000), 2),
            'Routine maintenance completed' if secure_random() > 0.5 else 'Parts replaced'
        ))
    
    conn.commit()
    conn.close()
    print(f"✓ Created {db_path} with 10 machines and 50 maintenance logs")

def create_materials_database():
    """Create and populate raw materials database"""
    db_path = os.path.join('databases', 'materials.sqlite')
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create raw_materials table
    cursor.execute('''
        CREATE TABLE raw_materials (
            material_id INTEGER PRIMARY KEY,
            material_name VARCHAR(100) NOT NULL,
            material_type VARCHAR(50) NOT NULL,
            unit_of_measure VARCHAR(20) NOT NULL,
            current_stock DECIMAL(10, 2) NOT NULL,
            reorder_level DECIMAL(10, 2) NOT NULL,
            unit_cost DECIMAL(10, 2) NOT NULL,
            supplier_id INTEGER NOT NULL,
            warehouse_location VARCHAR(50),
            last_updated DATE
        )
    ''')
    
    # Create material_transactions table
    cursor.execute('''
        CREATE TABLE material_transactions (
            transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
            material_id INTEGER NOT NULL,
            transaction_type VARCHAR(20) NOT NULL,
            quantity DECIMAL(10, 2) NOT NULL,
            transaction_date DATETIME NOT NULL,
            reference_number VARCHAR(50),
            notes TEXT,
            FOREIGN KEY (material_id) REFERENCES raw_materials(material_id)
        )
    ''')
    
    # Insert sample materials
    materials = [
        (3001, 'Steel Sheet 1mm', 'Metal', 'kg', 5000.00, 1000.00, 2.50, 7001, 'Warehouse A-1', '2024-11-20'),
        (3002, 'Steel Sheet 2mm', 'Metal', 'kg', 3500.00, 800.00, 3.20, 7001, 'Warehouse A-1', '2024-11-18'),
        (3003, 'Aluminum Rod 20mm', 'Metal', 'kg', 2200.00, 500.00, 4.80, 7002, 'Warehouse A-2', '2024-11-22'),
        (3004, 'Aluminum Plate', 'Metal', 'kg', 1800.00, 400.00, 5.50, 7002, 'Warehouse A-2', '2024-11-19'),
        (3005, 'Copper Wire 5mm', 'Metal', 'kg', 800.00, 200.00, 12.50, 7003, 'Warehouse A-3', '2024-11-21'),
        (3006, 'Plastic Pellets HDPE', 'Plastic', 'kg', 4000.00, 1000.00, 1.80, 7004, 'Warehouse B-1', '2024-11-20'),
        (3007, 'Plastic Pellets PP', 'Plastic', 'kg', 3200.00, 800.00, 1.95, 7004, 'Warehouse B-1', '2024-11-17'),
        (3008, 'Rubber Compound', 'Rubber', 'kg', 1500.00, 300.00, 8.50, 7005, 'Warehouse B-2', '2024-11-23'),
        (3009, 'Hydraulic Oil', 'Fluid', 'liters', 500.00, 100.00, 15.00, 7006, 'Warehouse C-1', '2024-11-15'),
        (3010, 'Cutting Fluid', 'Fluid', 'liters', 350.00, 80.00, 18.50, 7006, 'Warehouse C-1', '2024-11-16')
    ]
    
    cursor.executemany('''
        INSERT INTO raw_materials (material_id, material_name, material_type, unit_of_measure, 
                                  current_stock, reorder_level, unit_cost, supplier_id, warehouse_location, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', materials)
    
    # Insert material transactions
    transaction_types = ['Receipt', 'Issue', 'Adjustment', 'Return']
    base_date = datetime(2024, 1, 1)
    
    for i in range(80):  # 80 transactions
        trans_date = base_date + timedelta(days=secure_randint(0, 330), hours=secure_randint(0, 23))
        trans_type = secure_choice(transaction_types)
        quantity = secure_uniform(50, 500) if trans_type == 'Receipt' else secure_uniform(10, 200)
        
        cursor.execute('''
            INSERT INTO material_transactions (material_id, transaction_type, quantity, transaction_date, 
                                              reference_number, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            secure_randint(3001, 3010),
            trans_type,
            round(quantity, 2),
            trans_date.strftime('%Y-%m-%d %H:%M:%S'),
            f"TRX-{trans_date.year}-{i+1:04d}",
            f"{trans_type} transaction" if secure_random() > 0.5 else None
        ))
    
    conn.commit()
    conn.close()
    print(f"✓ Created {db_path} with 10 materials and 80 transactions")

def create_quality_database():
    """Create and populate quality control database"""
    db_path = os.path.join('databases', 'quality.sqlite')
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create inspections table
    cursor.execute('''
        CREATE TABLE inspections (
            inspection_id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            inspection_date DATETIME NOT NULL,
            inspector_id INTEGER NOT NULL,
            sample_size INTEGER NOT NULL,
            passed_count INTEGER NOT NULL,
            failed_count INTEGER NOT NULL,
            inspection_type VARCHAR(50) NOT NULL,
            result VARCHAR(20) NOT NULL
        )
    ''')
    
    # Create defects table
    cursor.execute('''
        CREATE TABLE defects (
            defect_id INTEGER PRIMARY KEY AUTOINCREMENT,
            inspection_id INTEGER NOT NULL,
            defect_type VARCHAR(50) NOT NULL,
            defect_count INTEGER NOT NULL,
            severity VARCHAR(20) NOT NULL,
            description TEXT,
            corrective_action TEXT,
            FOREIGN KEY (inspection_id) REFERENCES inspections(inspection_id)
        )
    ''')
    
    # Insert inspections
    inspection_types = ['First Article', 'In-Process', 'Final', 'Receiving']
    results = ['Pass', 'Pass', 'Pass', 'Pass', 'Fail']  # 80% pass rate
    base_date = datetime(2024, 1, 1)
    
    for i in range(150):  # 150 inspections
        inspection_date = base_date + timedelta(days=secure_randint(0, 330), hours=secure_randint(0, 23))
        sample_size = secure_randint(10, 50)
        pass_rate = secure_uniform(0.85, 1.0)
        passed = int(sample_size * pass_rate)
        failed = sample_size - passed
        result = 'Pass' if failed <= int(sample_size * 0.05) else 'Fail'
        
        cursor.execute('''
            INSERT INTO inspections (run_id, product_id, inspection_date, inspector_id, sample_size, 
                                    passed_count, failed_count, inspection_type, result)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            secure_randint(1, 100),
            secure_randint(2001, 2010),
            inspection_date.strftime('%Y-%m-%d %H:%M:%S'),
            secure_randint(6501, 6510),
            sample_size,
            passed,
            failed,
            secure_choice(inspection_types),
            result
        ))
        
        # Add defects if inspection failed
        if failed > 0:
            defect_types = ['Dimensional', 'Surface Finish', 'Material', 'Assembly', 'Cosmetic']
            severities = ['Critical', 'Major', 'Minor']
            
            num_defect_types = secure_randint(1, min(3, failed))
            for _ in range(num_defect_types):
                defect_count = secure_randint(1, failed)
                cursor.execute('''
                    INSERT INTO defects (inspection_id, defect_type, defect_count, severity, description, corrective_action)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (
                    i + 1,
                    secure_choice(defect_types),
                    defect_count,
                    secure_choice(severities),
                    'Quality issue detected during inspection',
                    'Process adjustment required' if secure_random() > 0.5 else 'Re-work initiated'
                ))
    
    conn.commit()
    conn.close()
    print(f"✓ Created {db_path} with 150 inspections and defect records")

def create_workforce_database():
    """Create and populate workforce database"""
    db_path = os.path.join('databases', 'workforce.sqlite')
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create employees table
    cursor.execute('''
        CREATE TABLE employees (
            employee_id INTEGER PRIMARY KEY,
            first_name VARCHAR(50) NOT NULL,
            last_name VARCHAR(50) NOT NULL,
            job_title VARCHAR(100) NOT NULL,
            department VARCHAR(50) NOT NULL,
            hire_date DATE NOT NULL,
            hourly_rate DECIMAL(10, 2) NOT NULL,
            shift_preference VARCHAR(20),
            certification_level VARCHAR(20),
            status VARCHAR(20) NOT NULL
        )
    ''')
    
    # Create shift_assignments table
    cursor.execute('''
        CREATE TABLE shift_assignments (
            assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            shift_date DATE NOT NULL,
            shift_id INTEGER NOT NULL,
            hours_worked DECIMAL(5, 2) NOT NULL,
            productivity_score DECIMAL(5, 2),
            attendance_status VARCHAR(20) NOT NULL,
            FOREIGN KEY (employee_id) REFERENCES employees(employee_id)
        )
    ''')
    
    # Insert sample employees
    first_names = ['John', 'Maria', 'James', 'Lisa', 'Michael', 'Sarah', 'David', 'Emily', 'Robert', 'Jennifer',
                   'William', 'Linda', 'Richard', 'Patricia', 'Thomas', 'Nancy', 'Charles', 'Karen', 'Daniel', 'Betty',
                   'Matthew', 'Helen', 'Anthony', 'Dorothy', 'Mark']
    last_names = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
                  'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson', 'White',
                  'Harris', 'Clark', 'Lewis', 'Walker', 'Hall']
    
    job_titles = ['Machine Operator', 'Production Supervisor', 'Quality Inspector', 'Maintenance Technician', 'Assembly Worker']
    departments = ['Production', 'Quality', 'Maintenance', 'Assembly']
    certifications = ['Level 1', 'Level 2', 'Level 3', 'Master']
    
    for i in range(5001, 5026):  # 25 employees
        hire_date = datetime(2020, 1, 1) + timedelta(days=secure_randint(0, 1400))
        
        cursor.execute('''
            INSERT INTO employees (employee_id, first_name, last_name, job_title, department, hire_date, 
                                  hourly_rate, shift_preference, certification_level, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            i,
            secure_choice(first_names),
            secure_choice(last_names),
            secure_choice(job_titles),
            secure_choice(departments),
            hire_date.strftime('%Y-%m-%d'),
            round(secure_uniform(18.50, 35.00), 2),
            secure_choice(['Day', 'Evening', 'Night']),
            secure_choice(certifications),
            'Active'
        ))
    
    # Insert shift assignments
    base_date = datetime(2024, 1, 1)
    attendance_statuses = ['Present', 'Present', 'Present', 'Present', 'Late', 'Absent']
    
    for i in range(500):  # 500 shift assignments
        shift_date = base_date + timedelta(days=secure_randint(0, 330))
        hours = secure_uniform(7.5, 9.0) if secure_random() > 0.1 else secure_uniform(4.0, 7.5)
        
        cursor.execute('''
            INSERT INTO shift_assignments (employee_id, shift_date, shift_id, hours_worked, 
                                          productivity_score, attendance_status)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            secure_randint(5001, 5025),
            shift_date.strftime('%Y-%m-%d'),
            secure_randint(1, 3),
            round(hours, 2),
            round(secure_uniform(75, 100), 2),
            secure_choice(attendance_statuses)
        ))
    
    conn.commit()
    conn.close()
    print(f"✓ Created {db_path} with 25 employees and 500 shift assignments")

def create_suppliers_database():
    """Create and populate suppliers database"""
    db_path = os.path.join('databases', 'suppliers.sqlite')
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create suppliers table
    cursor.execute('''
        CREATE TABLE suppliers (
            supplier_id INTEGER PRIMARY KEY,
            supplier_name VARCHAR(100) NOT NULL,
            contact_person VARCHAR(100),
            email VARCHAR(100),
            phone VARCHAR(20),
            address VARCHAR(200),
            city VARCHAR(50),
            country VARCHAR(50),
            rating DECIMAL(3, 2),
            payment_terms VARCHAR(50),
            status VARCHAR(20) NOT NULL
        )
    ''')
    
    # Create purchase_orders table
    cursor.execute('''
        CREATE TABLE purchase_orders (
            po_id INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier_id INTEGER NOT NULL,
            material_id INTEGER NOT NULL,
            order_date DATE NOT NULL,
            expected_delivery DATE NOT NULL,
            actual_delivery DATE,
            quantity DECIMAL(10, 2) NOT NULL,
            unit_price DECIMAL(10, 2) NOT NULL,
            total_amount DECIMAL(10, 2) NOT NULL,
            status VARCHAR(20) NOT NULL,
            FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
        )
    ''')
    
    # Insert suppliers
    suppliers = [
        (7001, 'SteelWorks Inc', 'Tom Anderson', 'tom@steelworks.com', '555-1001', '123 Industrial Blvd', 'Pittsburgh', 'USA', 4.5, 'Net 30', 'Active'),
        (7002, 'Aluminum Solutions', 'Lisa Chen', 'lisa@alusolutions.com', '555-1002', '456 Metal Ave', 'Detroit', 'USA', 4.7, 'Net 30', 'Active'),
        (7003, 'Copper & Wire Co', 'Mike Johnson', 'mike@copperco.com', '555-1003', '789 Wire St', 'Cleveland', 'USA', 4.2, 'Net 45', 'Active'),
        (7004, 'Plastics Plus', 'Sarah Williams', 'sarah@plasticsplus.com', '555-1004', '321 Polymer Rd', 'Houston', 'USA', 4.6, 'Net 30', 'Active'),
        (7005, 'Rubber Supplies Ltd', 'David Brown', 'david@rubbersupply.com', '555-1005', '654 Elastomer Way', 'Akron', 'USA', 4.3, 'Net 30', 'Active'),
        (7006, 'Industrial Fluids', 'Emily Davis', 'emily@industryfluids.com', '555-1006', '987 Chemical Dr', 'Newark', 'USA', 4.4, 'Net 45', 'Active')
    ]
    
    cursor.executemany('''
        INSERT INTO suppliers (supplier_id, supplier_name, contact_person, email, phone, address, 
                              city, country, rating, payment_terms, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', suppliers)
    
    # Insert purchase orders
    statuses = ['Ordered', 'In Transit', 'Delivered', 'Delivered', 'Delivered']
    base_date = datetime(2024, 1, 1)
    
    for i in range(60):  # 60 purchase orders
        order_date = base_date + timedelta(days=secure_randint(0, 330))
        expected_delivery = order_date + timedelta(days=secure_randint(7, 21))
        
        # 70% chance of being delivered
        actual_delivery = None
        status = secure_choice(statuses)
        if status == 'Delivered':
            delivery_variance = secure_randint(-3, 5)
            actual_delivery = expected_delivery + timedelta(days=delivery_variance)
        
        quantity = secure_uniform(100, 2000)
        unit_price = secure_uniform(1.5, 20.0)
        total = round(quantity * unit_price, 2)
        
        cursor.execute('''
            INSERT INTO purchase_orders (supplier_id, material_id, order_date, expected_delivery, actual_delivery,
                                        quantity, unit_price, total_amount, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            secure_randint(7001, 7006),
            secure_randint(3001, 3010),
            order_date.strftime('%Y-%m-%d'),
            expected_delivery.strftime('%Y-%m-%d'),
            actual_delivery.strftime('%Y-%m-%d') if actual_delivery else None,
            round(quantity, 2),
            round(unit_price, 2),
            total,
            status
        ))
    
    conn.commit()
    conn.close()
    print(f"✓ Created {db_path} with 6 suppliers and 60 purchase orders")

def export_database_to_txt(db_path, output_file):
    """Export all tables from a database to a text file"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get database name
    db_name = os.path.basename(db_path).replace('.sqlite', '')
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write("="*80 + "\n")
        f.write(f"DATABASE: {db_name.upper()}\n")
        f.write(f"File: {db_path}\n")
        f.write(f"Exported: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write("="*80 + "\n\n")
        
        # Get all tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = cursor.fetchall()
        
        # Define whitelist of valid table names for manufacturing application
        VALID_TABLES = {
            'production_runs', 'machines', 'maintenance_logs', 'raw_materials', 'material_transactions',
            'inspections', 'defects', 'employees', 'shift_assignments', 'suppliers', 'purchase_orders'
        }
        
        for (table_name,) in tables:
            # Strict validation: whitelist check + alphanumeric validation
            if table_name not in VALID_TABLES:
                print(f"⚠ Skipping non-whitelisted table: {table_name}")
                continue
            
            if not table_name.replace('_', '').isalnum():
                print(f"⚠ Skipping invalid table name: {table_name}")
                continue
            
            f.write("\n" + "─"*80 + "\n")
            f.write(f"TABLE: {table_name}\n")
            f.write("─"*80 + "\n\n")
            
            # Get column info using parameterized query
            columns = cursor.execute(
                "SELECT * FROM pragma_table_info(?)", 
                (table_name,)
            ).fetchall()
            
            col_names = [col[1] for col in columns]
            col_types = [col[2] for col in columns]
            
            # Write schema
            f.write("SCHEMA:\n")
            for col_name, col_type in zip(col_names, col_types):
                f.write(f"  - {col_name}: {col_type}\n")
            f.write("\n")
            
            # Get row count using query mapping (Coverity-safe approach)
            SAFE_QUERIES = {
                'production_runs': 'SELECT COUNT(*) FROM "production_runs"',
                'machines': 'SELECT COUNT(*) FROM "machines"',
                'maintenance_logs': 'SELECT COUNT(*) FROM "maintenance_logs"',
                'raw_materials': 'SELECT COUNT(*) FROM "raw_materials"',
                'material_transactions': 'SELECT COUNT(*) FROM "material_transactions"',
                'inspections': 'SELECT COUNT(*) FROM "inspections"',
                'defects': 'SELECT COUNT(*) FROM "defects"',
                'employees': 'SELECT COUNT(*) FROM "employees"',
                'shift_assignments': 'SELECT COUNT(*) FROM "shift_assignments"',
                'suppliers': 'SELECT COUNT(*) FROM "suppliers"',
                'purchase_orders': 'SELECT COUNT(*) FROM "purchase_orders"'
            }
            
            if table_name in SAFE_QUERIES:
                row_count_result = cursor.execute(SAFE_QUERIES[table_name]).fetchone()
                row_count = row_count_result[0]
            else:
                row_count = 0
            
            f.write(f"TOTAL ROWS: {row_count}\n\n")
            
            # Get all data using safe query mapping
            SAFE_SELECT_QUERIES = {
                'production_runs': 'SELECT * FROM "production_runs"',
                'machines': 'SELECT * FROM "machines"',
                'maintenance_logs': 'SELECT * FROM "maintenance_logs"',
                'raw_materials': 'SELECT * FROM "raw_materials"',
                'material_transactions': 'SELECT * FROM "material_transactions"',
                'inspections': 'SELECT * FROM "inspections"',
                'defects': 'SELECT * FROM "defects"',
                'employees': 'SELECT * FROM "employees"',
                'shift_assignments': 'SELECT * FROM "shift_assignments"',
                'suppliers': 'SELECT * FROM "suppliers"',
                'purchase_orders': 'SELECT * FROM "purchase_orders"'
            }
            
            if table_name in SAFE_SELECT_QUERIES:
                rows = cursor.execute(SAFE_SELECT_QUERIES[table_name]).fetchall()
            else:
                rows = []
            
            if rows:
                # Calculate column widths
                col_widths = [len(name) for name in col_names]
                for row in rows:
                    for i, val in enumerate(row):
                        col_widths[i] = max(col_widths[i], len(str(val)) if val is not None else 4)
                
                # Write header
                f.write("DATA:\n")
                header = " | ".join(name.ljust(col_widths[i]) for i, name in enumerate(col_names))
                f.write(header + "\n")
                f.write("-" * len(header) + "\n")
                
                # Write rows
                for row in rows:
                    row_str = " | ".join(
                        str(val).ljust(col_widths[i]) if val is not None else "NULL".ljust(col_widths[i])
                        for i, val in enumerate(row)
                    )
                    f.write(row_str + "\n")
            else:
                f.write("(No data)\n")
            
            f.write("\n")
    
    conn.close()

def export_all_databases():
    """Export all manufacturing databases to text files"""
    print("\n" + "="*60)
    print("📄 EXPORTING MANUFACTURING DATABASES TO TEXT FILES")
    print("="*60)
    
    # Create export directory
    export_dir = 'database_exports'
    os.makedirs(export_dir, exist_ok=True)
    
    # Get all .sqlite files
    import glob
    db_files = glob.glob(os.path.join('databases', '*.sqlite'))
    
    if not db_files:
        print("⚠ No databases found to export!")
        return
    
    for db_path in sorted(db_files):
        db_name = os.path.basename(db_path).replace('.sqlite', '')
        output_file = os.path.join(export_dir, f"{db_name}_data.txt")
        
        try:
            export_database_to_txt(db_path, output_file)
            print(f"✓ Exported {db_name}.sqlite → {output_file}")
        except Exception as e:
            print(f"❌ Failed to export {db_name}.sqlite: {e}")
    
    print(f"\n✅ All databases exported to '{export_dir}/' folder!")
    print(f"📂 You can now verify the data in these text files")

def main():
    """Create all manufacturing databases"""
    print("="*60)
    print("Creating Manufacturing SQLite Databases...")
    print("="*60)
    
    # Create databases directory
    os.makedirs('databases', exist_ok=True)
    
    # Create all databases
    create_production_database()
    create_equipment_database()
    create_materials_database()
    create_quality_database()
    create_workforce_database()
    create_suppliers_database()
    
    print("\n" + "="*60)
    print("✅ All manufacturing databases created successfully!")
    print("="*60)
    print("\nDatabases created:")
    print("  📁 production.sqlite  - Production runs and output")
    print("  📁 equipment.sqlite   - Machines and maintenance")
    print("  📁 materials.sqlite   - Raw materials and inventory")
    print("  📁 quality.sqlite     - Quality inspections and defects")
    print("  📁 workforce.sqlite   - Employees and shifts")
    print("  📁 suppliers.sqlite   - Suppliers and purchase orders")
    
    # Export all databases to text files
    export_all_databases()
    
    print("\n✨ Manufacturing database system ready!")
    print("\nExample queries you can try:")
    print("  - Show production efficiency by line")
    print("  - Which machines need maintenance soon?")
    print("  - Show materials below reorder level")
    print("  - What are the most common defects?")
    print("  - Show employee productivity by shift")
    print("  - Which suppliers have the best on-time delivery?")
    print("\nReady to query with natural language!")
    print("Run: python startup_check.py")

if __name__ == "__main__":
    main()
