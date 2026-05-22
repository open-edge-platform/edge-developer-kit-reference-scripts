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

def create_sales_database():
    """Create and populate sales database"""
    db_path = os.path.join('databases', 'sales.sqlite')
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create sales table
    cursor.execute('''
        CREATE TABLE sales (
            sale_id INTEGER PRIMARY KEY,
            product_id INTEGER NOT NULL,
            customer_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            sale_amount DECIMAL(10, 2) NOT NULL,
            sale_date DATE NOT NULL,
            region VARCHAR(50) NOT NULL
        )
    ''')
    
    # Insert sample data
    regions = ['North', 'South', 'East', 'West']
    base_date = datetime(2024, 1, 1)
    
    for i in range(1, 51):  # 50 sales records
        sale_date = base_date + timedelta(days=secure_randint(0, 330))
        cursor.execute('''
            INSERT INTO sales (sale_id, product_id, customer_id, quantity, sale_amount, sale_date, region)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            i,
            secure_randint(101, 110),
            secure_randint(1001, 1020),
            secure_randint(1, 10),
            round(secure_uniform(50, 500), 2),
            sale_date.strftime('%Y-%m-%d'),
            secure_choice(regions)
        ))
    
    conn.commit()
    conn.close()
    print(f"✓ Created {db_path} with 50 sales records")

def create_inventory_database():
    """Create and populate inventory database"""
    db_path = os.path.join('databases', 'inventory.sqlite')
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create products table
    cursor.execute('''
        CREATE TABLE products (
            product_id INTEGER PRIMARY KEY,
            product_name VARCHAR(100) NOT NULL,
            category VARCHAR(50) NOT NULL,
            unit_price DECIMAL(10, 2) NOT NULL,
            stock_quantity INTEGER NOT NULL,
            warehouse_location VARCHAR(50),
            last_updated DATE
        )
    ''')
    
    # Insert sample products
    products = [
        (101, 'Laptop Pro 15 inch', 'Electronics', 1299.99, 45, 'Warehouse A', '2024-11-01'),
        (102, 'Wireless Mouse', 'Electronics', 29.99, 150, 'Warehouse A', '2024-11-15'),
        (103, 'USB-C Hub', 'Electronics', 49.99, 80, 'Warehouse A', '2024-10-20'),
        (104, 'Cotton T-Shirt', 'Clothing', 19.99, 200, 'Warehouse B', '2024-11-10'),
        (105, 'Denim Jeans', 'Clothing', 59.99, 120, 'Warehouse B', '2024-10-25'),
        (106, 'Garden Hose 50ft', 'Home & Garden', 34.99, 60, 'Warehouse C', '2024-11-05'),
        (107, 'LED Light Bulbs 4pk', 'Home & Garden', 24.99, 180, 'Warehouse C', '2024-11-12'),
        (108, 'Basketball', 'Sports', 39.99, 75, 'Warehouse D', '2024-10-30'),
        (109, 'Yoga Mat', 'Sports', 29.99, 95, 'Warehouse D', '2024-11-08'),
        (110, 'Water Bottle 32oz', 'Sports', 19.99, 140, 'Warehouse D', '2024-11-18')
    ]
    
    cursor.executemany('''
        INSERT INTO products (product_id, product_name, category, unit_price, stock_quantity, warehouse_location, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', products)
    
    conn.commit()
    conn.close()
    print(f"✓ Created {db_path} with 10 products")

def create_customer_database():
    """Create and populate customer database"""
    db_path = os.path.join('databases', 'customers.sqlite')
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create customers table
    cursor.execute('''
        CREATE TABLE customers (
            customer_id INTEGER PRIMARY KEY,
            first_name VARCHAR(50) NOT NULL,
            last_name VARCHAR(50) NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            phone VARCHAR(20),
            city VARCHAR(50),
            state VARCHAR(50),
            country VARCHAR(50),
            registration_date DATE,
            customer_tier VARCHAR(20)
        )
    ''')
    
    # Insert sample customers
    first_names = ['John', 'Jane', 'Michael', 'Emily', 'David', 'Sarah', 'James', 'Lisa', 'Robert', 'Jennifer',
                   'William', 'Mary', 'Richard', 'Patricia', 'Thomas', 'Linda', 'Charles', 'Barbara', 'Daniel', 'Susan']
    last_names = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
                  'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson', 'White']
    cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'Austin']
    states = ['NY', 'CA', 'IL', 'TX', 'AZ', 'PA', 'TX', 'CA', 'TX', 'TX']
    tiers = ['Gold', 'Silver', 'Bronze']
    
    for i in range(1001, 1021):  # 20 customers
        first_name = secure_choice(first_names)
        last_name = secure_choice(last_names)
        city = secure_choice(cities)
        state = states[cities.index(city)]
        reg_date = datetime(2023, 1, 1) + timedelta(days=secure_randint(0, 600))
        
        cursor.execute('''
            INSERT INTO customers (customer_id, first_name, last_name, email, phone, city, state, country, registration_date, customer_tier)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            i,
            first_name,
            last_name,
            f"{first_name.lower()}.{last_name.lower()}{i}@email.com",
            f"555-{secure_randint(1000, 9999)}",
            city,
            state,
            'USA',
            reg_date.strftime('%Y-%m-%d'),
            secure_choice(tiers)
        ))
    
    conn.commit()
    conn.close()
    print(f"✓ Created {db_path} with 20 customers")

def create_orders_database():
    """Create and populate orders database"""
    db_path = os.path.join('databases', 'orders.sqlite')
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create orders table
    cursor.execute('''
        CREATE TABLE orders (
            order_id INTEGER PRIMARY KEY,
            customer_id INTEGER NOT NULL,
            order_date DATE NOT NULL,
            total_amount DECIMAL(10, 2) NOT NULL,
            order_status VARCHAR(20) NOT NULL,
            shipping_address VARCHAR(200),
            payment_method VARCHAR(50),
            estimated_delivery DATE
        )
    ''')
    
    # Create order_items table (line items for each order)
    cursor.execute('''
        CREATE TABLE order_items (
            item_id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            item_price DECIMAL(10, 2) NOT NULL,
            discount_percent DECIMAL(5, 2) DEFAULT 0,
            FOREIGN KEY (order_id) REFERENCES orders(order_id)
        )
    ''')
    
    # Insert sample orders
    statuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled']
    payment_methods = ['Credit Card', 'PayPal', 'Debit Card', 'Bank Transfer']
    addresses = [
        '123 Main St, New York, NY 10001',
        '456 Oak Ave, Los Angeles, CA 90001',
        '789 Pine Rd, Chicago, IL 60601',
        '321 Elm St, Houston, TX 77001',
        '654 Maple Dr, Phoenix, AZ 85001'
    ]
    
    base_date = datetime(2024, 1, 1)
    
    order_id = 1
    for i in range(40):  # 40 orders
        order_date = base_date + timedelta(days=secure_randint(0, 330))
        delivery_days = secure_randint(3, 10)
        estimated_delivery = order_date + timedelta(days=delivery_days)
        
        # Create order
        total_amount = round(secure_uniform(50, 800), 2)
        cursor.execute('''
            INSERT INTO orders (order_id, customer_id, order_date, total_amount, order_status, shipping_address, payment_method, estimated_delivery)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            order_id,
            secure_randint(1001, 1020),
            order_date.strftime('%Y-%m-%d'),
            total_amount,
            secure_choice(statuses),
            secure_choice(addresses),
            secure_choice(payment_methods),
            estimated_delivery.strftime('%Y-%m-%d')
        ))
        
        # Add 1-4 items per order
        num_items = secure_randint(1, 4)
        remaining_amount = total_amount
        
        for item_num in range(num_items):
            product_id = secure_randint(101, 110)
            quantity = secure_randint(1, 5)
            
            # Calculate item price (distribute total among items)
            if item_num == num_items - 1:
                item_price = remaining_amount
            else:
                item_price = round(remaining_amount * secure_uniform(0.2, 0.5), 2)
                remaining_amount -= item_price
            
            discount = secure_choice([0, 5, 10, 15, 20])
            
            cursor.execute('''
                INSERT INTO order_items (order_id, product_id, quantity, item_price, discount_percent)
                VALUES (?, ?, ?, ?, ?)
            ''', (order_id, product_id, quantity, item_price, discount))
        
        order_id += 1
    
    conn.commit()
    conn.close()
    print(f"✓ Created {db_path} with 40 orders and order items")

def create_shipping_database():
    """Create and populate shipping/logistics database (NEW)"""
    db_path = os.path.join('databases', 'shipping.sqlite')
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create shipments table
    cursor.execute('''
        CREATE TABLE shipments (
            shipment_id INTEGER PRIMARY KEY,
            order_id INTEGER NOT NULL,
            carrier VARCHAR(50) NOT NULL,
            tracking_number VARCHAR(100) UNIQUE NOT NULL,
            ship_date DATE NOT NULL,
            delivery_date DATE,
            current_status VARCHAR(50) NOT NULL,
            origin_city VARCHAR(100),
            destination_city VARCHAR(100),
            weight_kg DECIMAL(10, 2),
            shipping_cost DECIMAL(10, 2)
        )
    ''')
    
    # Create shipment_tracking table (tracking history)
    cursor.execute('''
        CREATE TABLE shipment_tracking (
            tracking_id INTEGER PRIMARY KEY AUTOINCREMENT,
            shipment_id INTEGER NOT NULL,
            update_timestamp DATETIME NOT NULL,
            location VARCHAR(100),
            status VARCHAR(50) NOT NULL,
            notes TEXT,
            FOREIGN KEY (shipment_id) REFERENCES shipments(shipment_id)
        )
    ''')
    
    # Insert sample shipments
    carriers = ['FedEx', 'UPS', 'USPS', 'DHL']
    statuses = ['In Transit', 'Out for Delivery', 'Delivered', 'Delayed', 'Returned']
    cities = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'San Antonio', 'San Diego']
    
    base_date = datetime(2024, 1, 1)
    
    for i in range(1, 41):  # 40 shipments (matches orders)
        ship_date = base_date + timedelta(days=secure_randint(0, 330))
        delivery_days = secure_randint(2, 10)
        delivery_date = ship_date + timedelta(days=delivery_days) if secure_random() > 0.3 else None
        
        cursor.execute('''
            INSERT INTO shipments (shipment_id, order_id, carrier, tracking_number, ship_date, delivery_date, 
                                   current_status, origin_city, destination_city, weight_kg, shipping_cost)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            i,
            i,
            secure_choice(carriers),
            f"{secure_choice(['1Z', '9400', 'FX', 'DH'])}{secure_randint(100000000, 999999999)}",
            ship_date.strftime('%Y-%m-%d'),
            delivery_date.strftime('%Y-%m-%d') if delivery_date else None,
            secure_choice(statuses),
            secure_choice(cities),
            secure_choice(cities),
            round(secure_uniform(0.5, 25.0), 2),
            round(secure_uniform(5.99, 49.99), 2)
        ))
        
        # Add 2-5 tracking updates per shipment
        num_updates = secure_randint(2, 5)
        tracking_statuses = ['Picked Up', 'In Transit', 'At Sorting Facility', 'Out for Delivery', 'Delivered']
        
        for j in range(num_updates):
            update_time = ship_date + timedelta(days=j, hours=secure_randint(0, 23))
            status = tracking_statuses[min(j, len(tracking_statuses)-1)]
            
            cursor.execute('''
                INSERT INTO shipment_tracking (shipment_id, update_timestamp, location, status, notes)
                VALUES (?, ?, ?, ?, ?)
            ''', (
                i,
                update_time.strftime('%Y-%m-%d %H:%M:%S'),
                secure_choice(cities),
                status,
                f"Package {status.lower()}" if secure_random() > 0.5 else None
            ))
    
    conn.commit()
    conn.close()
    print(f"✓ Created {db_path} with 40 shipments and tracking history")

def create_reviews_database():
    """Create and populate product reviews database (NEW)"""
    db_path = os.path.join('databases', 'reviews.sqlite')
    
    # Remove existing database
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create reviews table
    cursor.execute('''
        CREATE TABLE reviews (
            review_id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            customer_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            review_title VARCHAR(200),
            review_text TEXT,
            review_date DATE NOT NULL,
            verified_purchase BOOLEAN DEFAULT 0,
            helpful_count INTEGER DEFAULT 0
        )
    ''')
    
    # Create review_responses table (seller/support responses)
    cursor.execute('''
        CREATE TABLE review_responses (
            response_id INTEGER PRIMARY KEY AUTOINCREMENT,
            review_id INTEGER NOT NULL,
            responder_name VARCHAR(100),
            response_text TEXT NOT NULL,
            response_date DATE NOT NULL,
            FOREIGN KEY (review_id) REFERENCES reviews(review_id)
        )
    ''')
    
    # Sample review templates
    positive_reviews = [
        ("Excellent product!", "Very satisfied with this purchase. Exceeded expectations."),
        ("Highly recommend", "Great quality and fast shipping. Will buy again."),
        ("Perfect!", "Exactly what I needed. Works perfectly."),
        ("Love it!", "Amazing product. Best purchase I've made."),
        ("Five stars!", "Outstanding quality and value for money.")
    ]
    
    neutral_reviews = [
        ("Good product", "Does the job but nothing special."),
        ("As expected", "Product works as described. Average quality."),
        ("Decent", "It's okay. Could be better but acceptable."),
        ("Fair", "Meets basic needs but room for improvement.")
    ]
    
    negative_reviews = [
        ("Disappointed", "Not as described. Quality below expectations."),
        ("Not great", "Had some issues with this product."),
        ("Could be better", "Several problems encountered during use."),
        ("Not satisfied", "Expected better quality for the price.")
    ]
    
    base_date = datetime(2024, 1, 1)
    
    # Generate 60 reviews
    for i in range(60):
        rating = secure_choices([1, 2, 3, 4, 5], weights=[5, 10, 15, 30, 40])[0]
        
        if rating >= 4:
            title, text = secure_choice(positive_reviews)
        elif rating == 3:
            title, text = secure_choice(neutral_reviews)
        else:
            title, text = secure_choice(negative_reviews)
        
        review_date = base_date + timedelta(days=secure_randint(0, 330))
        
        cursor.execute('''
            INSERT INTO reviews (product_id, customer_id, rating, review_title, review_text, 
                                review_date, verified_purchase, helpful_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            secure_randint(101, 110),
            secure_randint(1001, 1020),
            rating,
            title,
            text,
            review_date.strftime('%Y-%m-%d'),
            secure_choice([0, 1]),
            secure_randint(0, 50)
        ))
        
        # 30% chance of having a response (especially for negative reviews)
        if rating <= 3 and secure_random() < 0.5:
            response_date = review_date + timedelta(days=secure_randint(1, 5))
            cursor.execute('''
                INSERT INTO review_responses (review_id, responder_name, response_text, response_date)
                VALUES (?, ?, ?, ?)
            ''', (
                i + 1,
                "Customer Support",
                "Thank you for your feedback. We apologize for any inconvenience and will work to improve.",
                response_date.strftime('%Y-%m-%d')
            ))
    
    conn.commit()
    conn.close()
    print(f"✓ Created {db_path} with 60 reviews and responses")

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
        
        # Define whitelist of valid table names for this application
        VALID_TABLES = {
            'sales', 'products', 'customers', 'orders', 'order_items',
            'shipments', 'shipment_tracking', 'reviews', 'review_responses'
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
            # Define safe query templates for each whitelisted table
            SAFE_QUERIES = {
                'sales': 'SELECT COUNT(*) FROM "sales"',
                'products': 'SELECT COUNT(*) FROM "products"',
                'customers': 'SELECT COUNT(*) FROM "customers"',
                'orders': 'SELECT COUNT(*) FROM "orders"',
                'order_items': 'SELECT COUNT(*) FROM "order_items"',
                'shipments': 'SELECT COUNT(*) FROM "shipments"',
                'shipment_tracking': 'SELECT COUNT(*) FROM "shipment_tracking"',
                'reviews': 'SELECT COUNT(*) FROM "reviews"',
                'review_responses': 'SELECT COUNT(*) FROM "review_responses"'
            }
            
            if table_name in SAFE_QUERIES:
                row_count_result = cursor.execute(SAFE_QUERIES[table_name]).fetchone()
                row_count = row_count_result[0]
            else:
                row_count = 0
            
            f.write(f"TOTAL ROWS: {row_count}\n\n")
            
            # Get all data using safe query mapping
            SAFE_SELECT_QUERIES = {
                'sales': 'SELECT * FROM "sales"',
                'products': 'SELECT * FROM "products"',
                'customers': 'SELECT * FROM "customers"',
                'orders': 'SELECT * FROM "orders"',
                'order_items': 'SELECT * FROM "order_items"',
                'shipments': 'SELECT * FROM "shipments"',
                'shipment_tracking': 'SELECT * FROM "shipment_tracking"',
                'reviews': 'SELECT * FROM "reviews"',
                'review_responses': 'SELECT * FROM "review_responses"'
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
    """Export all databases to text files"""
    print("\n" + "="*60)
    print("📄 EXPORTING DATABASES TO TEXT FILES")
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
    """Create all databases"""
    print("="*60)
    print("Creating SQLite Databases...")
    print("="*60)
    
    # Create databases directory
    os.makedirs('databases', exist_ok=True)
    
    # Create all databases
    create_sales_database()
    create_inventory_database()
    create_customer_database()
    create_orders_database()
    create_shipping_database()
    create_reviews_database()
    
    print("\n" + "="*60)
    print("✅ All databases created successfully!")
    print("="*60)
    print("\nDatabases created:")
    print("  📁 sales.sqlite     - Sales transactions")
    print("  📁 inventory.sqlite - Product catalog")
    print("  📁 customers.sqlite - Customer information")
    print("  📁 orders.sqlite    - Order management")
    print("  📁 shipping.sqlite  - Shipping & logistics")
    print("  📁 reviews.sqlite   - Product reviews & ratings")
    
    # Export all databases to text files
    export_all_databases()
    
    print("\n✨ Now testing with 6 databases for maximum flexibility!")
    print("\nReady to query with natural language!")
    print("Run: python startup_check.py")

if __name__ == "__main__":
    main()