# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sqlite3
import uuid
from datetime import datetime, timedelta
import os
from fixture_values import DeterministicFixtureValues

# --- Configuration ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_DIR = os.path.join(BASE_DIR, "databases", "db_retail")

# =========== DATA VOLUME CONTROL ===========
DATE_START = datetime(2026, 3, 1)
DATE_END   = datetime(2026, 3, 13)   # Current date (Mar 13, 2026) -- queries like "last 7 days" will work
AVG_TRANSACTIONS_PER_STORE_PER_DAY = 4   # Very small for PoC
RANDOM_SEED = 99
# ============================================

fixture_values = DeterministicFixtureValues(RANDOM_SEED)

DB_FILENAME = "retail_db.sqlite"

# ---------------------------------------------------------------------------
# Lookup Data Definitions
# ---------------------------------------------------------------------------

CATEGORIES = [
    (1, "Electronics",  "Phones, laptops, accessories, smart devices"),
    (2, "Clothing",     "Apparel, footwear, fashion accessories"),
    (3, "Grocery",      "Food, beverages, household consumables"),
    (4, "Household",    "Home furnishings, kitchenware, cleaning supplies"),
    (5, "Sports",       "Sporting goods, fitness equipment, outdoor gear"),
    (6, "Toys",         "Children's toys, games, educational products"),
]

PRODUCTS = [
    # (id, cat_id, sku,        name,                         brand,         unit_price, cost_price)
    (1,  1, "SKU-E001", "Galaxy Phone X12",                "Samsung",       899.00, 540.00),
    (2,  1, "SKU-E002", "UltraBook Pro 14",                "Dell",         1199.00, 780.00),
    (3,  1, "SKU-E003", "Wireless Earbuds Pro",            "Sony",           89.00,  42.00),
    (4,  1, "SKU-E004", "Smart Watch Series 5",            "Apple",         329.00, 195.00),
    (5,  1, "SKU-E005", "USB-C Charging Hub",              "Anker",          29.90,  12.00),
    (6,  2, "SKU-C001", "Men's Casual Polo",               "H&M",            24.90,   8.00),
    (7,  2, "SKU-C002", "Women's Running Shoes",           "Nike",           89.00,  38.00),
    (8,  2, "SKU-C003", "Slim Fit Jeans",                  "Uniqlo",         49.90,  18.00),
    (9,  2, "SKU-C004", "Leather Wallet",                  "Fossil",         45.00,  15.00),
    (10, 2, "SKU-C005", "Winter Jacket",                   "Columbia",      139.00,  58.00),
    (11, 3, "SKU-G001", "Organic Coffee Beans 500g",       "Nescafe",        18.90,   7.50),
    (12, 3, "SKU-G002", "Mineral Water 12-Pack",           "Evian",          12.90,   4.80),
    (13, 3, "SKU-G003", "Premium Cereal Box",              "Kellogg's",      11.50,   4.00),
    (14, 3, "SKU-G004", "Olive Oil 1L",                    "Bertolli",       22.00,   9.00),
    (15, 3, "SKU-G005", "Protein Snack Bar 6-Pack",        "Kind",           15.90,   6.00),
    (16, 4, "SKU-H001", "Stainless Steel Frying Pan",      "Tefal",          49.90,  20.00),
    (17, 4, "SKU-H002", "Memory Foam Pillow",              "Tempur",         69.00,  28.00),
    (18, 4, "SKU-H003", "LED Desk Lamp",                   "Philips",        35.00,  14.00),
    (19, 4, "SKU-H004", "Air Purifier Compact",            "Dyson",         249.00, 140.00),
    (20, 4, "SKU-H005", "Microfiber Duvet Set",            "IKEA",           79.00,  30.00),
    (21, 5, "SKU-S001", "Yoga Mat Pro",                    "Lululemon",      68.00,  25.00),
    (22, 5, "SKU-S002", "Resistance Band Set",             "TheraBand",      22.90,   8.00),
    (23, 5, "SKU-S003", "Running Water Bottle 750ml",      "Hydro Flask",    39.90,  16.00),
    (24, 5, "SKU-S004", "Cycling Helmet",                  "Giro",           95.00,  42.00),
    (25, 6, "SKU-T001", "Building Blocks Classic 500pc",   "LEGO",           59.90,  25.00),
    (26, 6, "SKU-T002", "Educational Tablet for Kids",     "LeapFrog",       89.00,  40.00),
    (27, 6, "SKU-T003", "Remote Control Car Pro",          "HotWheels",      49.90,  18.00),
    (28, 6, "SKU-T004", "Puzzle 1000 Pieces",              "Ravensburger",   24.90,   9.00),
    (29, 1, "SKU-E006", "HDMI Cable 2m",                   "Belkin",          9.90,   3.00),
    (30, 3, "SKU-G006", "Green Tea 25 Bags",               "Lipton",          5.90,   2.00),
]

STORES = [
    # (id, name,                       city,           state,   manager_name)
    (1, "MegaMart Central",     "Kuala Lumpur",  "WP",    "James Tan"),
    (2, "MegaMart Northgate",   "Petaling Jaya", "Selangor", "Priya Nair"),
]

CUSTOMERS = [
    # (id, name,                  email,                              loyalty_tier, join_date)
    (1,  "Ahmad bin Yusof",      "ahmad.yusof@email.com",            "Gold",    "2023-06-10"),
    (2,  "Li Wei Chen",          "liwei.chen@email.com",             "Silver",  "2024-01-15"),
    (3,  "Sarah Johnson",        "sarah.j@email.com",                "Platinum","2022-09-01"),
    (4,  "Ravi Kumar",           "ravi.k@email.com",                 "Gold",    "2023-11-20"),
    (5,  "Nurul Hidayah",        "nurul.h@email.com",                "Silver",  "2024-03-05"),
    (6,  "Michael Wong",         "mwong@email.com",                  "Bronze",  "2025-01-12"),
    (7,  "Siti Rahmah",          "siti.r@email.com",                 "Gold",    "2023-07-18"),
    (8,  "John Lim",             "johnlim@email.com",                "Bronze",  "2025-06-22"),
    (9,  "Aisha Mohamed",        "aisha.m@email.com",                "Silver",  "2024-08-30"),
    (10, "Kevin Tan",            "kevintan@email.com",               "Platinum","2021-04-14"),
    (11, "Fatimah Zahra",        "fatimah.z@email.com",              "Bronze",  "2025-11-01"),
    (12, "David Raj",            "david.raj@email.com",              "Silver",  "2024-05-09"),
    (13, "Lee Mei Ling",         "lml@email.com",                    "Gold",    "2023-02-28"),
    (14, "Hassan Ibrahim",       "hassan.i@email.com",               "Bronze",  "2026-01-15"),
    (15, "Christine Ng",         "christine.ng@email.com",           "Platinum","2020-12-05"),
]

# Employees: (id, store_id, name, role, department)
EMPLOYEES = [
    (1, 1, "Raj Chandran",      "Cashier",      "Operations"),
    (2, 1, "Mei Fong Lau",      "Cashier",      "Operations"),
    (3, 1, "Hafiz Amin",        "Supervisor",   "Operations"),
    (4, 1, "Chloe Lee",         "Sales Advisor","Sales"),
    (5, 2, "Arjun Patel",       "Cashier",      "Operations"),
    (6, 2, "Nadia Zainal",      "Cashier",      "Operations"),
    (7, 2, "Boon Kiat Ng",      "Supervisor",   "Operations"),
    (8, 2, "Grace Ooi",         "Sales Advisor","Sales"),
]

PAYMENT_METHODS = ["Cash", "Credit Card", "Debit Card", "E-Wallet", "Voucher"]

RETURN_REASONS = [
    "Defective product",
    "Wrong item received",
    "Changed mind",
    "Size does not fit",
    "Duplicate purchase",
    "Product does not match description",
]

# Products more likely to be bought (bestsellers)
BESTSELLER_WEIGHTS = {
    5:  8,   # USB-C Charging Hub
    11: 9,   # Organic Coffee Beans
    12: 10,  # Mineral Water
    15: 7,   # Protein Snack Bar
    25: 6,   # LEGO Blocks
    29: 9,   # HDMI Cable
    30: 10,  # Green Tea
    6:  8,   # Men's Polo
    22: 7,   # Resistance Band
    28: 6,   # Puzzle
}
DEFAULT_WEIGHT = 2

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def generate_uuid():
    return str(uuid.uuid4())


def random_shift_time(dt, is_weekend):
    """Generate a random time during store hours (10am-10pm, busier afternoons/evenings)."""
    if is_weekend:
        hour = fixture_values.select_many(range(10, 22), weights=[2,3,4,5,6,6,7,7,8,8,5,3], count=1)[0]
    else:
        hour = fixture_values.select_many(range(10, 22), weights=[1,2,3,4,5,5,6,7,8,7,4,2], count=1)[0]
    minute = fixture_values.integer(0, 59)
    second = fixture_values.integer(0, 59)
    return dt.replace(hour=hour, minute=minute, second=second)


def format_date(dt):
    return dt.strftime("%Y-%m-%d")


def format_time(dt):
    return dt.strftime("%H:%M:%S")


def format_timestamp(dt):
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def get_days(start, end):
    """Return list of dates from start to end inclusive."""
    days = []
    current = start.date() if isinstance(start, datetime) else start
    end_d = end.date() if isinstance(end, datetime) else end
    while current <= end_d:
        days.append(datetime.combine(current, datetime.min.time()))
        current += timedelta(days=1)
    return days


def pick_products(n):
    """Pick n products weighted by bestseller weights."""
    product_ids = [p[0] for p in PRODUCTS]
    weights = [BESTSELLER_WEIGHTS.get(pid, DEFAULT_WEIGHT) for pid in product_ids]
    return fixture_values.select_many(product_ids, weights=weights, count=n)


def get_product(pid):
    for p in PRODUCTS:
        if p[0] == pid:
            return p
    return None

# ---------------------------------------------------------------------------
# Database Schema
# ---------------------------------------------------------------------------

def create_tables(cursor):
    """Create all retail tables."""

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS Category (
            ID INTEGER PRIMARY KEY NOT NULL,
            Name VARCHAR(100) NOT NULL,
            Description VARCHAR(255)
        );
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS Product (
            ID INTEGER PRIMARY KEY NOT NULL,
            CategoryID INTEGER NOT NULL,
            SKU VARCHAR(20) UNIQUE NOT NULL,
            Name VARCHAR(255) NOT NULL,
            Brand VARCHAR(100),
            UnitPrice DECIMAL(10,2) NOT NULL,
            CostPrice DECIMAL(10,2),
            IsActive BOOLEAN DEFAULT TRUE,
            FOREIGN KEY (CategoryID) REFERENCES Category(ID)
        );
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS Store (
            ID INTEGER PRIMARY KEY NOT NULL,
            Name VARCHAR(255) NOT NULL,
            City VARCHAR(100),
            State VARCHAR(100),
            ManagerName VARCHAR(255),
            OpenedDate VARCHAR(20)
        );
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS Customer (
            ID INTEGER PRIMARY KEY NOT NULL,
            Name VARCHAR(255) NOT NULL,
            Email VARCHAR(255),
            LoyaltyTier VARCHAR(20),
            JoinDate VARCHAR(20)
        );
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS Employee (
            ID INTEGER PRIMARY KEY NOT NULL,
            StoreID INTEGER NOT NULL,
            Name VARCHAR(255) NOT NULL,
            Role VARCHAR(50),
            Department VARCHAR(50),
            FOREIGN KEY (StoreID) REFERENCES Store(ID)
        );
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS SalesTransaction (
            ID INTEGER PRIMARY KEY NOT NULL,
            TransactionGUID VARCHAR(50),
            StoreID INTEGER NOT NULL,
            CustomerID INTEGER,
            EmployeeID INTEGER NOT NULL,
            Date VARCHAR(20) NOT NULL,
            Time VARCHAR(20),
            TotalAmount DECIMAL(10,2),
            DiscountAmount DECIMAL(10,2) DEFAULT 0,
            PaymentMethod VARCHAR(50),
            FOREIGN KEY (StoreID) REFERENCES Store(ID),
            FOREIGN KEY (CustomerID) REFERENCES Customer(ID),
            FOREIGN KEY (EmployeeID) REFERENCES Employee(ID)
        );
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS SalesItem (
            ID INTEGER PRIMARY KEY NOT NULL,
            TransactionID INTEGER NOT NULL,
            ProductID INTEGER NOT NULL,
            Quantity INTEGER NOT NULL,
            UnitPrice DECIMAL(10,2) NOT NULL,
            Subtotal DECIMAL(10,2) NOT NULL,
            FOREIGN KEY (TransactionID) REFERENCES SalesTransaction(ID),
            FOREIGN KEY (ProductID) REFERENCES Product(ID)
        );
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS Inventory (
            ID INTEGER PRIMARY KEY NOT NULL,
            StoreID INTEGER NOT NULL,
            ProductID INTEGER NOT NULL,
            QtyOnHand INTEGER NOT NULL DEFAULT 0,
            ReorderLevel INTEGER NOT NULL DEFAULT 10,
            LastRestocked VARCHAR(20),
            FOREIGN KEY (StoreID) REFERENCES Store(ID),
            FOREIGN KEY (ProductID) REFERENCES Product(ID)
        );
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ProductReturn (
            ID INTEGER PRIMARY KEY NOT NULL,
            TransactionID INTEGER NOT NULL,
            ProductID INTEGER NOT NULL,
            Quantity INTEGER NOT NULL DEFAULT 1,
            Reason VARCHAR(255),
            ReturnDate VARCHAR(20),
            RefundAmount DECIMAL(10,2),
            FOREIGN KEY (TransactionID) REFERENCES SalesTransaction(ID),
            FOREIGN KEY (ProductID) REFERENCES Product(ID)
        );
    """)


def create_views(cursor):
    """Create useful analytical views."""

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vDailySales AS
        SELECT
            st.Date,
            s.Name AS StoreName,
            COUNT(DISTINCT st.ID) AS TransactionCount,
            SUM(st.TotalAmount) AS TotalRevenue,
            AVG(st.TotalAmount) AS AvgTransactionValue
        FROM SalesTransaction st
        JOIN Store s ON st.StoreID = s.ID
        GROUP BY st.Date, st.StoreID;
    """)

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vTopProducts AS
        SELECT
            p.ID AS ProductID,
            p.Name AS ProductName,
            p.SKU,
            c.Name AS CategoryName,
            SUM(si.Quantity) AS TotalUnitsSold,
            SUM(si.Subtotal) AS TotalRevenue,
            COUNT(DISTINCT si.TransactionID) AS TransactionCount
        FROM SalesItem si
        JOIN Product p ON si.ProductID = p.ID
        JOIN Category c ON p.CategoryID = c.ID
        GROUP BY p.ID;
    """)

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vInventoryStatus AS
        SELECT
            s.Name AS StoreName,
            p.Name AS ProductName,
            p.SKU,
            c.Name AS CategoryName,
            i.QtyOnHand,
            i.ReorderLevel,
            CASE WHEN i.QtyOnHand <= i.ReorderLevel THEN 'Low Stock'
                 WHEN i.QtyOnHand = 0 THEN 'Out of Stock'
                 ELSE 'OK' END AS StockStatus,
            i.LastRestocked
        FROM Inventory i
        JOIN Store s ON i.StoreID = s.ID
        JOIN Product p ON i.ProductID = p.ID
        JOIN Category c ON p.CategoryID = c.ID;
    """)

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vSalesByCategory AS
        SELECT
            c.Name AS CategoryName,
            COUNT(DISTINCT si.TransactionID) AS Transactions,
            SUM(si.Quantity) AS UnitsSold,
            SUM(si.Subtotal) AS Revenue
        FROM SalesItem si
        JOIN Product p ON si.ProductID = p.ID
        JOIN Category c ON p.CategoryID = c.ID
        GROUP BY c.ID;
    """)

# ---------------------------------------------------------------------------
# Seed Data
# ---------------------------------------------------------------------------

def insert_seed_data(cursor):
    """Insert categories, products, stores, customers, employees."""

    for row in CATEGORIES:
        cursor.execute("INSERT OR IGNORE INTO Category (ID, Name, Description) VALUES (?, ?, ?)", row)

    for row in PRODUCTS:
        cursor.execute("""
            INSERT OR IGNORE INTO Product (ID, CategoryID, SKU, Name, Brand, UnitPrice, CostPrice)
            VALUES (?, ?, ?, ?, ?, ?, ?)""", row)

    for row in STORES:
        cursor.execute("""
            INSERT OR IGNORE INTO Store (ID, Name, City, State, ManagerName, OpenedDate)
            VALUES (?, ?, ?, ?, ?, ?)""",
            (row[0], row[1], row[2], row[3], row[4], "2018-01-01"))

    for row in CUSTOMERS:
        cursor.execute("""
            INSERT OR IGNORE INTO Customer (ID, Name, Email, LoyaltyTier, JoinDate)
            VALUES (?, ?, ?, ?, ?)""", row)

    for row in EMPLOYEES:
        cursor.execute("""
            INSERT OR IGNORE INTO Employee (ID, StoreID, Name, Role, Department)
            VALUES (?, ?, ?, ?, ?)""", row)

    print(f"  Seed data: {len(CATEGORIES)} categories, {len(PRODUCTS)} products, "
          f"{len(STORES)} stores, {len(CUSTOMERS)} customers, {len(EMPLOYEES)} employees")


# ---------------------------------------------------------------------------
# Transaction Generation
# ---------------------------------------------------------------------------

def generate_transactions(cursor):
    """Generate SalesTransaction + SalesItem records."""
    days = get_days(DATE_START, DATE_END)
    tx_id = 1
    item_id = 1
    return_id = 1
    completed_transactions = []   # (tx_id, store_id, date)

    # Inventory counters: {(store_id, product_id): qty_sold}
    sales_by_inventory = {}

    for day in days:
        is_weekend = day.weekday() >= 5  # Sat/Sun

        # Weekend gets 1.6x traffic
        weekend_mult = 1.6 if is_weekend else 1.0

        for store in STORES:
            store_id = store[0]
            store_emps = [e[0] for e in EMPLOYEES if e[1] == store_id]

            # Transactions per day per store
            n_tx = max(1, int(fixture_values.normal(
                AVG_TRANSACTIONS_PER_STORE_PER_DAY * weekend_mult,
                AVG_TRANSACTIONS_PER_STORE_PER_DAY * 0.3
            )))

            for _ in range(n_tx):
                emp_id = fixture_values.select(store_emps)
                # ~80% chance customer is registered (loyalty card)
                if fixture_values.fraction() < 0.80:
                    customer_id = fixture_values.select(CUSTOMERS)[0]
                else:
                    customer_id = None  # Walk-in customer

                tx_time = random_shift_time(day, is_weekend)
                payment = fixture_values.select(PAYMENT_METHODS)

                # Build basket: 1-4 different products
                n_items = fixture_values.select_many([1, 2, 3, 4], weights=[40, 35, 18, 7], count=1)[0]
                basket_product_ids = pick_products(n_items)
                # Deduplicate by keeping unique products only
                seen = set()
                unique_basket = []
                for pid in basket_product_ids:
                    if pid not in seen:
                        unique_basket.append(pid)
                        seen.add(pid)

                # Loyalty discount: Platinum=10%, Gold=5%, Silver=2%, Bronze=0%
                discount_rate = 0.0
                if customer_id:
                    tier = next((c[3] for c in CUSTOMERS if c[0] == customer_id), "Bronze")
                    discount_rate = {"Platinum": 0.10, "Gold": 0.05, "Silver": 0.02, "Bronze": 0.0}.get(tier, 0.0)

                # Compute items
                items = []
                subtotal_total = 0.0
                for pid in unique_basket:
                    product = get_product(pid)
                    qty = fixture_values.select_many([1, 2, 3], weights=[70, 22, 8], count=1)[0]
                    unit_price = product[5]
                    subtotal = round(unit_price * qty, 2)
                    items.append((pid, qty, unit_price, subtotal))
                    subtotal_total += subtotal

                    # Track sales for inventory
                    key = (store_id, pid)
                    sales_by_inventory[key] = sales_by_inventory.get(key, 0) + qty

                discount_amt = round(subtotal_total * discount_rate, 2)
                total_amount = round(subtotal_total - discount_amt, 2)
                tx_guid = generate_uuid()

                cursor.execute("""
                    INSERT INTO SalesTransaction
                        (ID, TransactionGUID, StoreID, CustomerID, EmployeeID, Date, Time,
                         TotalAmount, DiscountAmount, PaymentMethod)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (tx_id, tx_guid, store_id, customer_id, emp_id,
                      format_date(day), format_time(tx_time),
                      total_amount, discount_amt, payment))

                for pid, qty, unit_price, subtotal in items:
                    cursor.execute("""
                        INSERT INTO SalesItem (ID, TransactionID, ProductID, Quantity, UnitPrice, Subtotal)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (item_id, tx_id, pid, qty, unit_price, subtotal))
                    item_id += 1

                completed_transactions.append((tx_id, store_id, day, items))
                tx_id += 1

    # Generate returns (~5% of transactions, only for registered customers)
    returnable = [(t[0], t[2], t[3]) for t in completed_transactions
                  if t[3] and len(t[3]) > 0]
    n_returns = max(1, int(len(returnable) * 0.05))
    for tx_id_r, tx_day, tx_items in fixture_values.take(returnable, min(n_returns, len(returnable))):
        pid, qty, unit_price, _ = fixture_values.select(tx_items)
        return_qty = 1
        refund = round(unit_price * return_qty, 2)
        return_date = tx_day + timedelta(days=fixture_values.integer(1, 3))
        reason = fixture_values.select(RETURN_REASONS)
        cursor.execute("""
            INSERT INTO ProductReturn (ID, TransactionID, ProductID, Quantity, Reason, ReturnDate, RefundAmount)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (return_id, tx_id_r, pid, return_qty, reason, format_date(return_date), refund))
        return_id += 1

    return tx_id - 1, item_id - 1, return_id - 1, sales_by_inventory


def generate_inventory(cursor, sales_by_inventory):
    """Generate Inventory records — start with generous stock, subtract sales."""
    inv_id = 1
    starting_stock = 50   # Start each product with 50 units per store

    for store in STORES:
        store_id = store[0]
        restock_date = format_date(DATE_START - timedelta(days=2))

        for product in PRODUCTS:
            pid = product[0]
            sold = sales_by_inventory.get((store_id, pid), 0)
            qty_on_hand = max(0, starting_stock - sold)
            reorder_level = fixture_values.integer(5, 15)

            cursor.execute("""
                INSERT INTO Inventory (ID, StoreID, ProductID, QtyOnHand, ReorderLevel, LastRestocked)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (inv_id, store_id, pid, qty_on_hand, reorder_level, restock_date))
            inv_id += 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    os.makedirs(DB_DIR, exist_ok=True)

    db_path = os.path.join(DB_DIR, DB_FILENAME)
    if os.path.exists(db_path):
        os.remove(db_path)
        print(f"Removed old: {DB_FILENAME}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    print("=" * 70)
    print("MEGAMART RETAIL DATABASE GENERATOR  (PoC)")
    print("=" * 70)
    print(f"Date range : {format_date(DATE_START)} to {format_date(DATE_END)}")
    print(f"Stores     : {len(STORES)}")
    print(f"Products   : {len(PRODUCTS)} across {len(CATEGORIES)} categories")
    print(f"Avg TX/store/day: {AVG_TRANSACTIONS_PER_STORE_PER_DAY}")
    print("=" * 70)

    create_tables(cursor)
    print("Tables created.")

    insert_seed_data(cursor)

    n_tx, n_items, n_returns, sales_map = generate_transactions(cursor)
    print(f"  Transactions : {n_tx}")
    print(f"  Sales items  : {n_items}")
    print(f"  Returns      : {n_returns}")

    generate_inventory(cursor, sales_map)
    print(f"  Inventory    : {len(STORES) * len(PRODUCTS)} records ({len(STORES)} stores x {len(PRODUCTS)} products)")

    create_views(cursor)
    print("Views created.")

    conn.commit()

    # --- Summary ---
    print("\n" + "=" * 70)
    print("DATABASE SUMMARY")
    print("=" * 70)
    tables = ["Category", "Product", "Store", "Customer", "Employee",
              "SalesTransaction", "SalesItem", "Inventory", "ProductReturn"]
    for table in tables:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        print(f"  {table:20s} : {count:,} rows")

    print("\n  VIEWS:")
    for view in ["vDailySales", "vTopProducts", "vInventoryStatus", "vSalesByCategory"]:
        cursor.execute(f"SELECT COUNT(*) FROM {view}")
        count = cursor.fetchone()[0]
        print(f"  {view:20s} : {count:,} rows")

    print("\n  Revenue by Store:")
    cursor.execute("""
        SELECT s.Name, COUNT(t.ID), ROUND(SUM(t.TotalAmount),2)
        FROM SalesTransaction t JOIN Store s ON t.StoreID = s.ID
        GROUP BY s.ID
    """)
    for row in cursor.fetchall():
        print(f"    {row[0]}: {row[1]} transactions, RM {row[2]:,.2f} revenue")

    print("\n  Top 5 Products by Units Sold:")
    cursor.execute("""
        SELECT ProductName, TotalUnitsSold, ROUND(TotalRevenue,2)
        FROM vTopProducts ORDER BY TotalUnitsSold DESC LIMIT 5
    """)
    for row in cursor.fetchall():
        print(f"    {row[0]}: {row[1]} units, RM {row[2]:,.2f}")

    conn.close()

    size_kb = os.path.getsize(db_path) / 1024
    print(f"\n  Saved to: {db_path}")
    print(f"  File size: {size_kb:.1f} KB")
    print("=" * 70)
    print("Done!")
    print("\n  Next steps:")
    print("    python schema_bootstrap.py --db retail --auto")
    print("    (then ask NLQ: 'Show me the top selling products')")
    print("=" * 70)


if __name__ == "__main__":
    main()
