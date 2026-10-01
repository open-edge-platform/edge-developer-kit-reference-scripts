# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import sqlite3
import uuid
from datetime import datetime, timedelta
import os
from fixture_values import DeterministicFixtureValues

# --- Configuration ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_DIR = os.path.join(BASE_DIR, "databases", "db_manu")

# =========== DATA VOLUME CONTROL (Adjust these to reduce data for faster testing) ===========
DATA_VOLUME_SCALE = 0.1  # 0.1 = 10% data, 0.5 = 50%, 1.0 = 100% (default). Scales all sessions.
DATE_RANGE_DAYS = 7     # Number of days to generate data for (currently ~66 days Jan5-Mar12)
RANDOM_SEED = 42
# =============================================================================================

DATE_START = datetime(2026, 1, 5)
# Dynamically set DATE_END based on DATE_RANGE_DAYS
DATE_END = DATE_START + timedelta(days=DATE_RANGE_DAYS - 1)
SHIFT_START_HOUR = 8   # Day shift start
SHIFT_END_HOUR = 22    # Night shift end

fixture_values = DeterministicFixtureValues(RANDOM_SEED)

# --- Helper Functions ---

def random_datetime_between(start, end):
    delta = end - start
    random_seconds = fixture_values.integer(0, int(delta.total_seconds()))
    return start + timedelta(seconds=random_seconds)

def random_shift_datetime(date_obj):
    """Generate a random datetime within production shift hours (8am-10pm) on a given date."""
    hour = fixture_values.integer(SHIFT_START_HOUR, SHIFT_END_HOUR - 1)
    minute = fixture_values.integer(0, 59)
    second = fixture_values.integer(0, 59)
    return date_obj.replace(hour=hour, minute=minute, second=second)

def generate_uuid():
    return str(uuid.uuid4())

def format_time_12h(dt):
    return dt.strftime("%I:%M:%S %p")

def format_date(dt):
    return dt.strftime("%Y-%m-%d")

def format_timestamp(dt):
    return dt.strftime("%Y-%m-%d %H:%M:%S")

def is_workday(dt):
    """Returns True if date is Monday-Saturday (no Sunday)."""
    return dt.weekday() < 6  # 0=Mon .. 5=Sat, 6=Sun

def get_workdays(start, end):
    """Return list of workday date objects between start and end."""
    days = []
    current = start.date() if isinstance(start, datetime) else start
    end_d = end.date() if isinstance(end, datetime) else end
    while current <= end_d:
        dt = datetime.combine(current, datetime.min.time())
        if is_workday(dt):
            days.append(dt)
        current += timedelta(days=1)
    return days

# --- EMS Contractor Definitions ---

EMS_CONTRACTORS = [
    {
        "id": "EMS01",
        "name": "Acme EMS",
        "location": "Penang",
        "db_filename": "ems1_db.sqlite",
        "yield_profile": 0.90,
        "submit_cycle": "daily",
        "bad_batch_week": 4,          # Week 4 of the date range: yield drops
        "maintenance_date": "2026-02-10",
        "machines": [
            # (StationID, StationName, CavityIDs, RecipeKey)
            ("1", "X590 Motor Drive FCT",    ["1", "2"], "motor_drive"),
            ("2", "X590 Motor Drive FCT",    ["1"],      "motor_drive"),
            ("3", "X310 Heater Control FCT", ["1", "2"], "heater_ctrl"),
        ],
        "users": [
            (1, "Ahmad Razak",   "ahmad.razak",  "hashed_pw_1", "BDG-A01", "Admin",    "Engineering", "ahmad.razak@acme-ems.com",     "+60121110001"),
            (2, "Siti Aminah",   "siti.aminah",  "hashed_pw_2", "BDG-A02", "Operator", "Production",  "siti.aminah@acme-ems.com",     "+60121110002"),
            (3, "Raj Kumar",     "raj.kumar",    "hashed_pw_3", "BDG-A03", "Operator", "Production",  "raj.kumar@acme-ems.com",       "+60121110003"),
            (4, "Lee Wei Ming",  "lee.weiming",  "hashed_pw_4", "BDG-A04", "Engineer", "Engineering", "lee.weiming@acme-ems.com",     "+60121110004"),
            (5, "Nurul Izzah",   "nurul.izzah",  "hashed_pw_5", "BDG-A05", "Engineer", "Quality",     "nurul.izzah@acme-ems.com",     "+60121110005"),
        ],
        "sessions_per_machine_per_day": (3, 6),  # min, max
    },
    {
        "id": "EMS02",
        "name": "Delta Manufacturing",
        "location": "Johor",
        "db_filename": "ems2_db.sqlite",
        "yield_profile": 0.82,
        "submit_cycle": "daily",
        "bad_batch_week": 6,
        "maintenance_date": "2026-02-15",
        "machines": [
            ("1", "X590 Motor Drive FCT",    ["1"],      "motor_drive"),
            ("2", "X310 Heater Control FCT", ["1", "2"], "heater_ctrl"),
            ("3", "X310 Heater Control FCT", ["1"],      "heater_ctrl"),
        ],
        "users": [
            (1, "Tan Boon Keat",  "tan.boonkeat",  "hashed_pw_1", "BDG-D01", "Admin",    "Engineering", "tan.boonkeat@delta-mfg.com",   "+60177710001"),
            (2, "Wong Mei Ling",  "wong.meiling",  "hashed_pw_2", "BDG-D02", "Operator", "Production",  "wong.meiling@delta-mfg.com",   "+60177710002"),
            (3, "Muthu Rajan",    "muthu.rajan",   "hashed_pw_3", "BDG-D03", "Operator", "Production",  "muthu.rajan@delta-mfg.com",    "+60177710003"),
            (4, "Lim Chee Hong",  "lim.cheehong",  "hashed_pw_4", "BDG-D04", "Engineer", "Engineering", "lim.cheehong@delta-mfg.com",   "+60177710004"),
        ],
        "sessions_per_machine_per_day": (2, 5),
    },
    {
        "id": "EMS03",
        "name": "Vertex Tech",
        "location": "Kuala Lumpur",
        "db_filename": "ems3_db.sqlite",
        "yield_profile": 0.83,
        "submit_cycle": "weekly",
        "bad_batch_week": 8,
        "maintenance_date": "2026-02-20",
        "machines": [
            ("1", "X590 Motor Drive FCT",    ["1", "2"], "motor_drive"),
            ("2", "X590 Motor Drive FCT",    ["1"],      "motor_drive"),
            ("3", "X310 Heater Control FCT", ["1", "2"], "heater_ctrl"),
            ("4", "X310 Heater Control FCT", ["1"],      "heater_ctrl"),
        ],
        "users": [
            (1, "Farid Ismail",   "farid.ismail",   "hashed_pw_1", "BDG-V01", "Admin",    "Engineering", "farid.ismail@vertex-tech.com",   "+60133310001"),
            (2, "Chen Li Hua",    "chen.lihua",     "hashed_pw_2", "BDG-V02", "Operator", "Production",  "chen.lihua@vertex-tech.com",     "+60133310002"),
            (3, "Arun Prakash",   "arun.prakash",   "hashed_pw_3", "BDG-V03", "Operator", "Production",  "arun.prakash@vertex-tech.com",   "+60133310003"),
            (4, "Nor Azizah",     "nor.azizah",     "hashed_pw_4", "BDG-V04", "Engineer", "Engineering", "nor.azizah@vertex-tech.com",     "+60133310004"),
            (5, "Kavitha Devi",   "kavitha.devi",   "hashed_pw_5", "BDG-V05", "Engineer", "Quality",     "kavitha.devi@vertex-tech.com",   "+60133310005"),
            (6, "Hafiz Rahman",   "hafiz.rahman",   "hashed_pw_6", "BDG-V06", "Operator", "Production",  "hafiz.rahman@vertex-tech.com",   "+60133310006"),
        ],
        "sessions_per_machine_per_day": (2, 6),
    },
]

# --- Recipe / Process Step Definitions ---
# ProcessStep: ID, TestStepID, TestName, Type  (matches real db_schema.txt exactly)
# RecipeContent links ProcessStepID to a recipe with Skip, Limit, Param1, Param2, FinalTestName

RECIPE_MOTOR_DRIVE_GUID = "30776d71-a850-49e7-a796-fcce0b37160e"
RECIPE_HEATER_CTRL_GUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

# Global ProcessStep definitions (shared across all contractor DBs, same machine type = same steps)
PROCESS_STEPS = [
    # Motor Drive steps (IDs 1-7)
    (1, "TS001", "Initialize DUT",         "INIT"),
    (2, "TS002", "Standby Current Test",   "MEASURE"),
    (3, "TS003", "Supply Voltage Test",    "MEASURE"),
    (4, "TS004", "Motor Spin Test",        "FUNC"),
    (5, "TS005", "Firmware Version Check", "READ"),
    (6, "TS006", "Hardware Version Check", "READ"),
    (7, "TS007", "Serial Number Verify",   "READ"),
    # Heater Control steps (IDs 101-106)
    (101, "TS101", "Initialize DUT",         "INIT"),
    (102, "TS102", "Heater Current Test",    "MEASURE"),
    (103, "TS103", "Thermistor Read",        "MEASURE"),
    (104, "TS104", "Relay Toggle Test",      "FUNC"),
    (105, "TS105", "Firmware Version Check", "READ"),
    (106, "TS106", "Serial Number Verify",   "READ"),
]

# RecipeContent: links recipe to each step with test parameters
RECIPE_CONTENTS = {
    "motor_drive": {
        "guid": RECIPE_MOTOR_DRIVE_GUID,
        "name": "X590 Motor Drive FCT Recipe",
        "steps": [
            # (ProcessStepID, Skip, Limit, Param1, Param2, FinalTestName)
            (1, "FALSE", "N/A",  "N/A", "N/A",  "Initialize DUT"),
            (2, "FALSE", "0.05", "0",   "0.05", "Standby Current Test (A)"),
            (3, "FALSE", "3.6",  "3.0", "3.6",  "Supply Voltage Test (V)"),
            (4, "FALSE", "OK",   "N/A", "N/A",  "Motor Spin Test"),
            (5, "FALSE", "N/A",  "N/A", "N/A",  "FW Version Check"),
            (6, "FALSE", "N/A",  "N/A", "N/A",  "HW Version Check"),
            (7, "FALSE", "N/A",  "N/A", "N/A",  "SN Verify"),
        ],
    },
    "heater_ctrl": {
        "guid": RECIPE_HEATER_CTRL_GUID,
        "name": "X310 Heater Control FCT Recipe",
        "steps": [
            (101, "FALSE", "N/A",  "N/A",  "N/A",  "Initialize DUT"),
            (102, "FALSE", "2.5",  "1.0",  "2.5",  "Heater Current Test (A)"),
            (103, "FALSE", "85.0", "20.0", "85.0", "Thermistor Read (°C)"),
            (104, "FALSE", "OK",   "N/A",  "N/A",  "Relay Toggle Test"),
            (105, "FALSE", "N/A",  "N/A",  "N/A",  "FW Version Check"),
            (106, "FALSE", "N/A",  "N/A",  "N/A",  "SN Verify"),
        ],
    },
}

# Response generators per ProcessStepID
RESPONSE_GENERATORS = {
    1:   lambda ok: "0" if ok else "1",
    2:   lambda ok: f"{fixture_values.range_float(0.01, 0.04):.3f}" if ok else f"{fixture_values.range_float(0.06, 0.10):.3f}",
    3:   lambda ok: f"{fixture_values.range_float(3.1, 3.5):.1f}" if ok else f"{fixture_values.range_float(2.0, 2.9):.1f}",
    4:   lambda ok: "OK" if ok else "FAIL",
    5:   lambda ok: "0923PM.00.02.001.0011",
    6:   lambda ok: "0923PM.00.02.001.0011",
    7:   lambda ok: "0923PM.00.02.001.0011",
    101: lambda ok: "0" if ok else "1",
    102: lambda ok: f"{fixture_values.range_float(1.2, 2.3):.2f}" if ok else f"{fixture_values.range_float(2.6, 3.5):.2f}",
    103: lambda ok: f"{fixture_values.range_float(22.0, 80.0):.1f}" if ok else f"{fixture_values.range_float(86.0, 120.0):.1f}",
    104: lambda ok: "OK" if ok else "FAIL",
    105: lambda ok: "1024HC.01.00.003.0002",
    106: lambda ok: "1024HC.01.00.003.0002",
}

# Pareto-weighted failure step distribution per recipe
FAILURE_WEIGHTS = {
    "motor_drive": [(1, 5), (2, 10), (3, 40), (4, 25), (5, 0), (6, 0), (7, 0)],
    "heater_ctrl": [(101, 5), (102, 50), (103, 30), (104, 15), (105, 0), (106, 0)],
}

# Error codes tied to specific failure steps
STEP_ERROR_MAP = {
    1:   ("ERR001", "DUT initialization failed"),
    2:   ("ERR002", "Standby current out of range"),
    3:   ("ERR003", "Supply voltage out of range"),
    4:   ("ERR004", "Motor spin test failed"),
    101: ("ERR001", "DUT initialization failed"),
    102: ("ERR005", "Heater current out of range"),
    103: ("ERR006", "Thermistor reading out of range"),
    104: ("ERR007", "Relay toggle test failed"),
}

ES_NUMBERS = {
    "motor_drive": "DOC-1003628/02",
    "heater_ctrl": "DOC-2005412/01",
}

# --- Database Creation Logic ---

def pick_fail_step(recipe_key):
    """Pick which step fails based on Pareto-weighted distribution."""
    weights = FAILURE_WEIGHTS[recipe_key]
    candidates = [(ps_id, w) for ps_id, w in weights if w > 0]
    if not candidates:
        return weights[0][0]
    step_ids, wts = zip(*candidates)
    return fixture_values.select_many(step_ids, weights=wts, count=1)[0]


def create_tables(cursor):
    """Create all tables matching the real db_schema.txt (hybrid approach)."""

    # --- ProcessStep: matches real schema exactly (4 columns) ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ProcessStep (
            ID INTEGER PRIMARY KEY NOT NULL,
            TestStepID VARCHAR(15),
            TestName VARCHAR(1000),
            Type VARCHAR(15)
        );
    """)

    # --- RecipeContent: matches real schema (per-step, links ProcessStepID) ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS RecipeContent (
            ID INTEGER PRIMARY KEY NOT NULL,
            RecipeName VARCHAR(100),
            RecipeGUID VARCHAR(100),
            ProcessStepID INTEGER,
            Skip VARCHAR(5),
            "Limit" VARCHAR(10),
            Param1 VARCHAR(25),
            Param2 VARCHAR(25),
            FinalTestName VARCHAR(1000),
            IsDelete BOOLEAN DEFAULT FALSE
        );
    """)

    # --- User ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS "User" (
            ID INTEGER PRIMARY KEY NOT NULL,
            Name VARCHAR(255),
            Username VARCHAR(255),
            Password VARCHAR(521),
            BadgeID VARCHAR(255),
            Role VARCHAR(50),
            Department VARCHAR(50),
            Email VARCHAR(512),
            Phone VARCHAR(25),
            CreatedTime TIMESTAMP,
            UpdatedTime TIMESTAMP,
            IsDelete BOOLEAN DEFAULT FALSE
        );
    """)

    # --- UUTInfo ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS UUTInfo (
            ID INTEGER PRIMARY KEY NOT NULL,
            StationID VARCHAR(10),
            StationName VARCHAR(255),
            CavityID VARCHAR(25),
            UsageCount BIGINT,
            NextMaintenance BIGINT,
            LastUpdateTime TIMESTAMP,
            LastMaintenanceTime TIMESTAMP,
            LastMaintenanceBy VARCHAR(512),
            OutputLogName VARCHAR(512)
        );
    """)

    # --- OutputLog: matches real schema ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS OutputLog (
            ID INTEGER PRIMARY KEY NOT NULL,
            Date VARCHAR(255),
            UserID INTEGER,
            UUTInfoID VARCHAR(255),
            ESNo VARCHAR(255),
            RecipeContentGUID VARCHAR(100),
            SerialNumber VARCHAR(100),
            OutputGUID VARCHAR(100) NOT NULL UNIQUE,
            StartTime TIMESTAMP,
            EndTime TIMESTAMP,
            Duration VARCHAR(20),
            OverallResult VARCHAR(15),
            MES VARCHAR(25) DEFAULT 'FALSE',
            ErrorCode VARCHAR(25),
            ErrorDescription VARCHAR(1000)
        );
    """)

    # --- OutputDetailLog ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS OutputDetailLog (
            ID INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
            OutputGUID VARCHAR(100) NOT NULL,
            StartTime TIMESTAMP,
            EndTime TIMESTAMP,
            TestStep INTEGER,
            Duration VARCHAR(20),
            Response VARCHAR(250),
            Status VARCHAR(10)
        );
    """)

    # --- ErrorLog: matches real schema (CavityID, Remark, DateTime) ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ErrorLog (
            ID INTEGER PRIMARY KEY NOT NULL,
            UserID INTEGER,
            CavityID VARCHAR(25),
            ErrorCode VARCHAR(100),
            ErrorDescription VARCHAR(5000),
            Remark VARCHAR(1000),
            DateTime TIMESTAMP
        );
    """)

    # --- EventLog: matches real schema (CavityID, EventCode, Remark) ---
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS EventLog (
            ID INTEGER PRIMARY KEY NOT NULL,
            UserID INTEGER,
            CavityID VARCHAR(25),
            DateTime TIMESTAMP,
            EventType VARCHAR(50),
            EventCode VARCHAR(50),
            EventDescription VARCHAR(1000),
            Remark VARCHAR(1000)
        );
    """)


def create_views(cursor):
    """Create all views matching real db_schema.txt."""

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vOutputLog AS
        SELECT
            ol.ID,
            ol.Date,
            ol.UUTInfoID,
            ol.RecipeContentGUID,
            ol.OutputGUID,
            odl.StartTime,
            odl.EndTime,
            ol.Duration,
            ol.ESNo,
            uut.StationID,
            uut.StationName,
            uut.CavityID,
            ol.UserID,
            ol.SerialNumber,
            ol.OverallResult,
            ol.MES,
            ol.ErrorCode,
            ol.ErrorDescription,
            odl.TestStep,
            odl.Response,
            odl.Status
        FROM OutputLog ol
        JOIN OutputDetailLog odl ON ol.OutputGUID = odl.OutputGUID
        JOIN UUTInfo uut ON CAST(ol.UUTInfoID AS INTEGER) = uut.ID;
    """)

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vOutputLogSMTT AS
        SELECT
            ol.ID,
            ol.Date,
            ol.UUTInfoID,
            ol.RecipeContentGUID,
            ol.OutputGUID,
            odl.StartTime AS "Start Time",
            odl.EndTime AS "End Time",
            ol.Duration,
            ol.ESNo,
            uut.StationID AS "Station_ID",
            uut.StationName AS "Station_Name",
            uut.CavityID AS "Cavity ID",
            ol.UserID AS "User ID",
            ol.SerialNumber AS "Serial Number",
            rc.RecipeName,
            ol.OverallResult AS "Overall Result",
            ol.MES,
            ol.ErrorCode AS "Error Code",
            ol.ErrorDescription AS "Error Description",
            odl.TestStep,
            odl.Response
        FROM OutputLog ol
        JOIN OutputDetailLog odl ON ol.OutputGUID = odl.OutputGUID
        JOIN UUTInfo uut ON CAST(ol.UUTInfoID AS INTEGER) = uut.ID
        LEFT JOIN (
            SELECT DISTINCT RecipeGUID, RecipeName FROM RecipeContent WHERE IsDelete = 0
        ) rc ON ol.RecipeContentGUID = rc.RecipeGUID;
    """)

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vOutputLogSMTTBackup AS
        SELECT
            ol.ID,
            ol.Date,
            ol.UUTInfoID,
            ol.RecipeContentGUID,
            ol.OutputGUID,
            odl.StartTime AS "Start Time",
            odl.EndTime AS "End Time",
            ol.Duration,
            ol.ESNo,
            uut.StationID AS "Station_ID",
            uut.StationName AS "Station_Name",
            uut.CavityID AS "Cavity ID",
            ol.UserID AS "User ID",
            ol.SerialNumber AS "Serial Number",
            ol.OverallResult AS "Overall Result",
            ol.MES,
            ol.ErrorCode AS "Error Code",
            ol.ErrorDescription AS "Error Description",
            odl.TestStep,
            odl.Response
        FROM OutputLog ol
        JOIN OutputDetailLog odl ON ol.OutputGUID = odl.OutputGUID
        JOIN UUTInfo uut ON CAST(ol.UUTInfoID AS INTEGER) = uut.ID;
    """)

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vProcessName AS
        SELECT
            rc.RecipeGUID AS RecipeGUID,
            ps.TestName AS TestName,
            rc.FinalTestName AS FinalTestName
        FROM RecipeContent rc
        JOIN ProcessStep ps ON rc.ProcessStepID = ps.ID
        WHERE rc.IsDelete = 0;
    """)

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vProcessStep AS
        SELECT
            ps.ID,
            ps.TestStepID,
            ps.TestName,
            ps.Type,
            rc.RecipeName,
            rc.Skip,
            rc."Limit",
            rc.Param1,
            rc.Param2,
            rc.FinalTestName,
            rc.IsDelete
        FROM RecipeContent rc
        JOIN ProcessStep ps ON rc.ProcessStepID = ps.ID
        WHERE rc.IsDelete = 0;
    """)


def insert_seed_data(cursor, contractor):
    """Insert ProcessStep, RecipeContent, User, UUTInfo for a contractor."""
    now = format_timestamp(datetime(2026, 1, 1, 8, 0, 0))

    # --- ProcessStep (global, same for all contractors) ---
    for ps in PROCESS_STEPS:
        cursor.execute("""
            INSERT OR IGNORE INTO ProcessStep (ID, TestStepID, TestName, Type)
            VALUES (?, ?, ?, ?)
        """, ps)

    # --- RecipeContent (per-step rows) ---
    rc_id = 1
    for recipe_key in ["motor_drive", "heater_ctrl"]:
        recipe = RECIPE_CONTENTS[recipe_key]
        for step_row in recipe["steps"]:
            ps_id, skip, limit_val, p1, p2, final_name = step_row
            cursor.execute("""
                INSERT OR IGNORE INTO RecipeContent (ID, RecipeName, RecipeGUID, ProcessStepID, Skip, "Limit", Param1, Param2, FinalTestName, IsDelete)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (rc_id, recipe["name"], recipe["guid"], ps_id, skip, limit_val, p1, p2, final_name, False))
            rc_id += 1

    # --- Users ---
    for u in contractor["users"]:
        cursor.execute("""
            INSERT INTO "User" (ID, Name, Username, Password, BadgeID, Role, Department, Email, Phone, CreatedTime, UpdatedTime, IsDelete)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (u[0], u[1], u[2], u[3], u[4], u[5], u[6], u[7], u[8], now, now, False))

    # --- UUTInfo ---
    uut_id = 1
    maint_date = contractor["maintenance_date"]
    engineer_users = [u for u in contractor["users"] if u[5] in ("Engineer", "Admin")]
    maint_by = engineer_users[0][1] if engineer_users else contractor["users"][0][1]

    for station_id, station_name, cavity_ids, recipe_key in contractor["machines"]:
        for cav in cavity_ids:
            usage = fixture_values.integer(8000, 18000)
            next_maint = usage + fixture_values.integer(2000, 5000)
            cursor.execute("""
                INSERT INTO UUTInfo (ID, StationID, StationName, CavityID, UsageCount, NextMaintenance, LastUpdateTime, LastMaintenanceTime, LastMaintenanceBy, OutputLogName)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (uut_id, station_id, station_name, cav, usage, next_maint,
                  f"{maint_date} 08:00:00", f"{maint_date} 10:00:00", maint_by,
                  f"{station_name.replace(' ', '_')}_OutputLog"))
            uut_id += 1

    return uut_id


def generate_test_sessions(cursor, contractor):
    """Generate OutputLog + OutputDetailLog + ErrorLog for a contractor."""
    contractor_id = contractor["id"]
    yield_base = contractor["yield_profile"]
    bad_batch_week = contractor["bad_batch_week"]
    min_sess, max_sess = contractor["sessions_per_machine_per_day"]

    operator_ids = [u[0] for u in contractor["users"] if u[5] == "Operator"]
    if not operator_ids:
        operator_ids = [contractor["users"][0][0]]

    # Build UUTInfo lookup: station_id + cavity_id -> UUTInfo.ID
    cursor.execute("SELECT ID, StationID, CavityID FROM UUTInfo")
    uut_map = {}
    for row in cursor.fetchall():
        uut_map[(str(row[1]), str(row[2]))] = row[0]

    workdays = get_workdays(DATE_START, DATE_END)
    week_start = DATE_START.date() if isinstance(DATE_START, datetime) else DATE_START

    output_log_id = 126000 + fixture_values.integer(0, 500)
    error_log_id = 1
    serial_counters = {}
    retest_queue = []

    total_output = 0
    total_detail = 0
    total_errors = 0

    for day in workdays:
        day_d = day.date() if isinstance(day, datetime) else day
        week_number = ((day_d - week_start).days // 7) + 1

        # Yield adjustment: bad batch week, Monday effect
        day_yield = yield_base
        if week_number == bad_batch_week:
            day_yield = max(0.50, yield_base - fixture_values.range_float(0.20, 0.35))
        elif day.weekday() == 0:  # Monday
            day_yield = max(0.60, yield_base - fixture_values.range_float(0.03, 0.08))

        for station_id, station_name, cavity_ids, recipe_key in contractor["machines"]:
            recipe = RECIPE_CONTENTS[recipe_key]
            recipe_guid = recipe["guid"]
            es_no = ES_NUMBERS[recipe_key]
            step_defs = recipe["steps"]

            for cav_id in cavity_ids:
                uut_info_id = uut_map.get((station_id, cav_id))
                if uut_info_id is None:
                    continue

                num_sessions = fixture_values.integer(min_sess, max_sess)
                # Apply DATA_VOLUME_SCALE to reduce data generation
                num_sessions = max(1, int(num_sessions * DATA_VOLUME_SCALE))

                # Process retests first
                retests_today = [r for r in retest_queue
                                 if r[1] == recipe_key and r[2] == uut_info_id
                                 and r[3] <= day_d]
                for rt in retests_today:
                    retest_queue.remove(rt)

                sessions_to_run = []

                for rt_sn, rt_rk, rt_uut, rt_date in retests_today:
                    sessions_to_run.append((rt_sn, True))

                for _ in range(num_sessions):
                    counter_key = f"{recipe_key}_{contractor_id}"
                    serial_counters.setdefault(counter_key, 0)
                    serial_counters[counter_key] += 1
                    seq = serial_counters[counter_key]
                    prefix = "MD" if recipe_key == "motor_drive" else "HC"
                    sn = f"{prefix}-{contractor_id}-{day.strftime('%y%m%d')}-{seq:04d}"
                    sessions_to_run.append((sn, False))

                for serial_number, is_retest in sessions_to_run:
                    user_id = fixture_values.select(operator_ids)
                    output_guid = generate_uuid()

                    session_dt = random_shift_datetime(day)
                    step_time = session_dt
                    step_times = []
                    for i in range(len(step_defs)):
                        s_start = step_time
                        s_dur = fixture_values.integer(1, 20)
                        s_end = s_start + timedelta(seconds=s_dur)
                        step_times.append((s_start, s_end, s_dur))
                        step_time = s_end + timedelta(seconds=fixture_values.integer(0, 3))

                    session_start = format_time_12h(step_times[0][0])
                    session_end = format_time_12h(step_times[-1][1])
                    session_duration = int((step_times[-1][1] - step_times[0][0]).total_seconds())

                    retest_boost = 0.05 if is_retest else 0.0
                    is_pass = fixture_values.fraction() < (day_yield + retest_boost)
                    overall_result = "Pass" if is_pass else "Fail"

                    fail_step_id = None
                    fail_step_idx = None
                    error_code = "N/A"
                    error_description = "N/A"

                    if not is_pass:
                        fail_step_id = pick_fail_step(recipe_key)
                        for idx, sd in enumerate(step_defs):
                            if sd[0] == fail_step_id:
                                fail_step_idx = idx
                                break
                        if fail_step_idx is None:
                            fail_step_idx = 0
                            fail_step_id = step_defs[0][0]

                        err = STEP_ERROR_MAP.get(fail_step_id, ("ERR999", "Unknown error"))
                        error_code = err[0]
                        error_description = err[1]

                    mes_value = "TRUE" if is_pass and not is_retest and fixture_values.fraction() < 0.95 else "FALSE"

                    cursor.execute("""
                        INSERT INTO OutputLog (ID, Date, UserID, UUTInfoID, ESNo, RecipeContentGUID,
                            SerialNumber, OutputGUID, StartTime, EndTime, Duration, OverallResult,
                            MES, ErrorCode, ErrorDescription)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (output_log_id, format_date(day), user_id, str(uut_info_id), es_no,
                          recipe_guid, serial_number, output_guid,
                          session_start, session_end, str(session_duration),
                          overall_result, mes_value, error_code, error_description))
                    total_output += 1

                    for i, step_def in enumerate(step_defs):
                        ps_id = step_def[0]
                        s_start_dt, s_end_dt, s_dur = step_times[i]

                        if not is_pass and fail_step_idx is not None:
                            if i == fail_step_idx:
                                step_ok = False
                                step_status = "Fail"
                            elif i > fail_step_idx:
                                step_ok = True
                                step_status = "Skip"
                            else:
                                step_ok = True
                                step_status = "Pass"
                        else:
                            step_ok = True
                            step_status = "Pass"

                        response_gen = RESPONSE_GENERATORS.get(ps_id, lambda ok: "N/A")
                        response_value = response_gen(step_ok)

                        cursor.execute("""
                            INSERT INTO OutputDetailLog (OutputGUID, StartTime, EndTime, TestStep, Duration, Response, Status)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (output_guid, format_time_12h(s_start_dt), format_time_12h(s_end_dt),
                              i + 1, str(s_dur), response_value, step_status))
                        total_detail += 1

                    if not is_pass:
                        cursor.execute("""
                            INSERT INTO ErrorLog (ID, UserID, CavityID, ErrorCode, ErrorDescription, Remark, DateTime)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (error_log_id, user_id, cav_id, error_code, error_description,
                              f"Session {output_guid}", format_timestamp(session_dt)))
                        error_log_id += 1
                        total_errors += 1

                        if fixture_values.fraction() < 0.60:
                            retest_date = day_d + timedelta(days=fixture_values.integer(1, 3))
                            retest_queue.append((serial_number, recipe_key, uut_info_id, retest_date))

                    output_log_id += 1

    return total_output, total_detail, total_errors


def generate_event_log(cursor, contractor):
    """Generate EventLog entries for a contractor."""
    event_types = [
        ("LOGIN",          "EVT001", "User logged into the system"),
        ("LOGOUT",         "EVT002", "User logged out of the system"),
        ("MAINTENANCE",    "EVT003", "Scheduled maintenance performed on station"),
        ("RECIPE_CHANGE",  "EVT004", "Recipe updated for station"),
        ("CALIBRATION",    "EVT005", "Station calibration completed"),
    ]

    cursor.execute("SELECT ID, CavityID FROM UUTInfo")
    uut_cavities = cursor.fetchall()

    evt_id = 1
    workdays = get_workdays(DATE_START, DATE_END)

    for day in workdays:
        num_events = fixture_values.integer(1, 4)
        # Apply DATA_VOLUME_SCALE to reduce event log generation
        num_events = max(0, int(num_events * DATA_VOLUME_SCALE))
        for _ in range(num_events):
            evt_type, evt_code, evt_desc = fixture_values.select(event_types)
            user = fixture_values.select(contractor["users"])
            uut_row = fixture_values.select(uut_cavities)
            evt_dt = random_shift_datetime(day)

            remark = ""
            if evt_type == "MAINTENANCE":
                remark = f"Maintenance by {user[1]}"
            elif evt_type == "CALIBRATION":
                remark = f"Calibration passed, next due in 30 days"

            cursor.execute("""
                INSERT INTO EventLog (ID, UserID, CavityID, DateTime, EventType, EventCode, EventDescription, Remark)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (evt_id, user[0], uut_row[1], format_timestamp(evt_dt),
                  evt_type, evt_code, evt_desc, remark))
            evt_id += 1

    return evt_id - 1


def create_contractor_db(contractor):
    """Create a complete database for one EMS contractor."""
    db_path = os.path.join(DB_DIR, contractor["db_filename"])

    if os.path.exists(db_path):
        os.remove(db_path)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    print(f"\n{'='*60}")
    print(f"Creating DB for {contractor['name']} ({contractor['id']})")
    print(f"  Location: {contractor['location']}")
    print(f"  File: {db_path}")
    print(f"{'='*60}")

    create_tables(cursor)
    print("  Tables created.")

    insert_seed_data(cursor, contractor)
    print(f"  Seed data inserted ({len(contractor['users'])} users, {len(contractor['machines'])} machines).")

    total_out, total_det, total_err = generate_test_sessions(cursor, contractor)
    print(f"  Test sessions: {total_out} OutputLog, {total_det} OutputDetailLog, {total_err} ErrorLog")

    num_events = generate_event_log(cursor, contractor)
    print(f"  EventLog: {num_events} entries")

    create_views(cursor)
    print("  Views created.")

    conn.commit()
    conn.close()
    print(f"  Done: {db_path}")

    return db_path


def create_central_db(contractor_db_paths):
    """Create a merged central database with ContractorID/ContractorName added to OutputLog."""
    central_path = os.path.join(DB_DIR, "central_db.sqlite")

    if os.path.exists(central_path):
        os.remove(central_path)

    conn = sqlite3.connect(central_path)
    cursor = conn.cursor()

    print(f"\n{'='*60}")
    print("Creating CENTRAL merged database")
    print(f"  File: {central_path}")
    print(f"{'='*60}")

    create_tables(cursor)

    # Add contractor columns to OutputLog, ErrorLog, EventLog
    cursor.execute("ALTER TABLE OutputLog ADD COLUMN ContractorID VARCHAR(10);")
    cursor.execute("ALTER TABLE OutputLog ADD COLUMN ContractorName VARCHAR(255);")
    cursor.execute("ALTER TABLE ErrorLog ADD COLUMN ContractorID VARCHAR(10);")
    cursor.execute("ALTER TABLE ErrorLog ADD COLUMN ContractorName VARCHAR(255);")
    cursor.execute("ALTER TABLE EventLog ADD COLUMN ContractorID VARCHAR(10);")
    cursor.execute("ALTER TABLE EventLog ADD COLUMN ContractorName VARCHAR(255);")

    global_output_id = 100000
    global_error_id = 1
    global_event_id = 1
    global_user_id_offset = 0
    global_uut_id_offset = 0

    # Insert shared ProcessStep and RecipeContent once
    first_contractor_path = contractor_db_paths[0]
    src_conn = sqlite3.connect(first_contractor_path)
    src_cursor = src_conn.cursor()

    src_cursor.execute("SELECT * FROM ProcessStep")
    for row in src_cursor.fetchall():
        cursor.execute("INSERT OR IGNORE INTO ProcessStep VALUES (?, ?, ?, ?)", row)

    src_cursor.execute('SELECT * FROM RecipeContent')
    for row in src_cursor.fetchall():
        cursor.execute('INSERT OR IGNORE INTO RecipeContent VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', row)

    src_conn.close()

    for contractor, db_path in zip(EMS_CONTRACTORS, contractor_db_paths):
        cid = contractor["id"]
        cname = contractor["name"]
        print(f"\n  Merging {cname} ({cid})...")

        src_conn = sqlite3.connect(db_path)
        src_cursor = src_conn.cursor()

        # --- Users ---
        src_cursor.execute('SELECT * FROM "User"')
        user_rows = src_cursor.fetchall()
        user_id_map = {}
        for row in user_rows:
            old_id = row[0]
            new_id = old_id + global_user_id_offset
            user_id_map[old_id] = new_id
            cursor.execute("""
                INSERT OR IGNORE INTO "User" (ID, Name, Username, Password, BadgeID, Role, Department, Email, Phone, CreatedTime, UpdatedTime, IsDelete)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (new_id,) + row[1:])
        global_user_id_offset += len(user_rows) * 100

        # --- UUTInfo ---
        src_cursor.execute("SELECT * FROM UUTInfo")
        uut_rows = src_cursor.fetchall()
        uut_id_map = {}
        for row in uut_rows:
            old_id = row[0]
            new_id = old_id + global_uut_id_offset
            uut_id_map[old_id] = new_id
            cursor.execute("INSERT INTO UUTInfo VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (new_id,) + row[1:])
        global_uut_id_offset += len(uut_rows) * 100

        # --- OutputLog + OutputDetailLog ---
        src_cursor.execute("SELECT * FROM OutputLog")
        output_rows = src_cursor.fetchall()
        src_cursor.execute("PRAGMA table_info(OutputLog)")
        ol_cols = [c[1] for c in src_cursor.fetchall()]

        for row in output_rows:
            row_dict = dict(zip(ol_cols, row))
            old_user_id = row_dict.get("UserID")
            new_user_id = user_id_map.get(old_user_id, old_user_id)
            try:
                old_uut_id = int(row_dict.get("UUTInfoID", "0"))
            except (ValueError, TypeError):
                old_uut_id = 0
            new_uut_id = uut_id_map.get(old_uut_id, old_uut_id)
            output_guid = row_dict["OutputGUID"]

            cursor.execute("""
                INSERT INTO OutputLog (ID, Date, UserID, UUTInfoID, ESNo, RecipeContentGUID,
                    SerialNumber, OutputGUID, StartTime, EndTime, Duration, OverallResult,
                    MES, ErrorCode, ErrorDescription, ContractorID, ContractorName)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (global_output_id, row_dict["Date"], new_user_id, str(new_uut_id),
                  row_dict["ESNo"], row_dict["RecipeContentGUID"],
                  row_dict["SerialNumber"], output_guid,
                  row_dict["StartTime"], row_dict["EndTime"], row_dict["Duration"],
                  row_dict["OverallResult"], row_dict.get("MES", "FALSE"),
                  row_dict["ErrorCode"], row_dict["ErrorDescription"],
                  cid, cname))

            src_cursor.execute("SELECT * FROM OutputDetailLog WHERE OutputGUID = ?", (output_guid,))
            for detail_row in src_cursor.fetchall():
                cursor.execute("""
                    INSERT INTO OutputDetailLog (OutputGUID, StartTime, EndTime, TestStep, Duration, Response, Status)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, detail_row[1:8])

            global_output_id += 1

        # --- ErrorLog ---
        src_cursor.execute("SELECT * FROM ErrorLog")
        for row in src_cursor.fetchall():
            old_user_id = row[1]
            new_user_id = user_id_map.get(old_user_id, old_user_id)
            cursor.execute("""
                INSERT INTO ErrorLog (ID, UserID, CavityID, ErrorCode, ErrorDescription, Remark, DateTime, ContractorID, ContractorName)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (global_error_id, new_user_id, row[2], row[3], row[4], row[5], row[6], cid, cname))
            global_error_id += 1

        # --- EventLog ---
        src_cursor.execute("SELECT * FROM EventLog")
        for row in src_cursor.fetchall():
            old_user_id = row[1]
            new_user_id = user_id_map.get(old_user_id, old_user_id)
            cursor.execute("""
                INSERT INTO EventLog (ID, UserID, CavityID, DateTime, EventType, EventCode, EventDescription, Remark, ContractorID, ContractorName)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (global_event_id, new_user_id, row[2], row[3], row[4], row[5], row[6], row[7], cid, cname))
            global_event_id += 1

        src_conn.close()
        print(f"    Merged {len(output_rows)} output logs")

    # Recreate views for central DB with contractor columns
    for view_name in ["vOutputLog", "vOutputLogSMTT", "vOutputLogSMTTBackup", "vProcessName", "vProcessStep"]:
        cursor.execute(f"DROP VIEW IF EXISTS {view_name}")

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vOutputLog AS
        SELECT
            ol.ID,
            ol.Date,
            ol.UUTInfoID,
            ol.RecipeContentGUID,
            ol.OutputGUID,
            odl.StartTime,
            odl.EndTime,
            ol.Duration,
            ol.ESNo,
            uut.StationID,
            uut.StationName,
            uut.CavityID,
            ol.UserID,
            ol.SerialNumber,
            ol.OverallResult,
            ol.MES,
            ol.ErrorCode,
            ol.ErrorDescription,
            odl.TestStep,
            odl.Response,
            odl.Status,
            ol.ContractorID,
            ol.ContractorName
        FROM OutputLog ol
        JOIN OutputDetailLog odl ON ol.OutputGUID = odl.OutputGUID
        JOIN UUTInfo uut ON CAST(ol.UUTInfoID AS INTEGER) = uut.ID;
    """)

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vOutputLogSMTT AS
        SELECT
            ol.ID,
            ol.Date,
            ol.UUTInfoID,
            ol.RecipeContentGUID,
            ol.OutputGUID,
            odl.StartTime AS "Start Time",
            odl.EndTime AS "End Time",
            ol.Duration,
            ol.ESNo,
            uut.StationID AS "Station_ID",
            uut.StationName AS "Station_Name",
            uut.CavityID AS "Cavity ID",
            ol.UserID AS "User ID",
            ol.SerialNumber AS "Serial Number",
            rc.RecipeName,
            ol.OverallResult AS "Overall Result",
            ol.MES,
            ol.ErrorCode AS "Error Code",
            ol.ErrorDescription AS "Error Description",
            odl.TestStep,
            odl.Response,
            ol.ContractorID AS "Contractor ID",
            ol.ContractorName AS "Contractor Name"
        FROM OutputLog ol
        JOIN OutputDetailLog odl ON ol.OutputGUID = odl.OutputGUID
        JOIN UUTInfo uut ON CAST(ol.UUTInfoID AS INTEGER) = uut.ID
        LEFT JOIN (
            SELECT DISTINCT RecipeGUID, RecipeName FROM RecipeContent WHERE IsDelete = 0
        ) rc ON ol.RecipeContentGUID = rc.RecipeGUID;
    """)

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vOutputLogSMTTBackup AS
        SELECT
            ol.ID,
            ol.Date,
            ol.UUTInfoID,
            ol.RecipeContentGUID,
            ol.OutputGUID,
            odl.StartTime AS "Start Time",
            odl.EndTime AS "End Time",
            ol.Duration,
            ol.ESNo,
            uut.StationID AS "Station_ID",
            uut.StationName AS "Station_Name",
            uut.CavityID AS "Cavity ID",
            ol.UserID AS "User ID",
            ol.SerialNumber AS "Serial Number",
            ol.OverallResult AS "Overall Result",
            ol.MES,
            ol.ErrorCode AS "Error Code",
            ol.ErrorDescription AS "Error Description",
            odl.TestStep,
            odl.Response,
            ol.ContractorID AS "Contractor ID",
            ol.ContractorName AS "Contractor Name"
        FROM OutputLog ol
        JOIN OutputDetailLog odl ON ol.OutputGUID = odl.OutputGUID
        JOIN UUTInfo uut ON CAST(ol.UUTInfoID AS INTEGER) = uut.ID;
    """)

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vProcessName AS
        SELECT
            rc.RecipeGUID AS RecipeGUID,
            ps.TestName AS TestName,
            rc.FinalTestName AS FinalTestName
        FROM RecipeContent rc
        JOIN ProcessStep ps ON rc.ProcessStepID = ps.ID
        WHERE rc.IsDelete = 0;
    """)

    cursor.execute("""
        CREATE VIEW IF NOT EXISTS vProcessStep AS
        SELECT
            ps.ID,
            ps.TestStepID,
            ps.TestName,
            ps.Type,
            rc.RecipeName,
            rc.Skip,
            rc."Limit",
            rc.Param1,
            rc.Param2,
            rc.FinalTestName,
            rc.IsDelete
        FROM RecipeContent rc
        JOIN ProcessStep ps ON rc.ProcessStepID = ps.ID
        WHERE rc.IsDelete = 0;
    """)

    conn.commit()

    # --- Summary ---
    print(f"\n{'='*60}")
    print("CENTRAL DATABASE SUMMARY")
    print(f"{'='*60}")
    tables = ["User", "UUTInfo", "ProcessStep", "RecipeContent", "OutputLog", "OutputDetailLog", "ErrorLog", "EventLog"]
    for table in tables:
        cursor.execute(f'SELECT COUNT(*) FROM "{table}"')
        count = cursor.fetchone()[0]
        print(f"  {table:25s} : {count} rows")

    views = ["vOutputLog", "vOutputLogSMTT", "vOutputLogSMTTBackup", "vProcessName", "vProcessStep"]
    print("\n  VIEWS:")
    for view in views:
        cursor.execute(f'SELECT COUNT(*) FROM "{view}"')
        count = cursor.fetchone()[0]
        print(f"  {view:25s} : {count} rows")

    cursor.execute("SELECT ContractorName, COUNT(DISTINCT ID) FROM OutputLog GROUP BY ContractorName")
    print("\n  Per-contractor OutputLog:")
    for row in cursor.fetchall():
        print(f"    {row[0]}: {row[1]} sessions")

    cursor.execute("SELECT ContractorName, OverallResult, COUNT(*) FROM OutputLog GROUP BY ContractorName, OverallResult")
    print("\n  Pass/Fail by contractor:")
    for row in cursor.fetchall():
        print(f"    {row[0]} - {row[1]}: {row[2]}")

    conn.close()
    print(f"\n  Central DB saved to: {central_path}")
    return central_path


def main():
    """Main entry point - generates per-contractor DBs + central merged DB."""
    os.makedirs(DB_DIR, exist_ok=True)

    # Remove old DB files
    for f in os.listdir(DB_DIR):
        if f.endswith(".sqlite"):
            os.remove(os.path.join(DB_DIR, f))
            print(f"Removed old database: {f}")

    print(f"\n{'='*60}")
    print("SOPHIC FCT DATABASE GENERATOR")
    print(f"{'='*60}")
    print(f"Date range: {format_date(DATE_START)} to {format_date(DATE_END)} ({DATE_RANGE_DAYS} days)")
    print(f"Data volume scale: {DATA_VOLUME_SCALE*100:.0f}% of default")
    print(f"Contractors: {len(EMS_CONTRACTORS)}")
    for c in EMS_CONTRACTORS:
        print(f"  - {c['id']}: {c['name']} ({c['location']}) -- yield ~{c['yield_profile']*100:.0f}%")
    print(f"{'='*60}")

    contractor_db_paths = []
    for contractor in EMS_CONTRACTORS:
        fixture_values.reseed(f"{RANDOM_SEED}:{contractor['id']}")
        path = create_contractor_db(contractor)
        contractor_db_paths.append(path)

    fixture_values.reseed(RANDOM_SEED)
    central_path = create_central_db(contractor_db_paths)

    print(f"\n{'='*60}")
    print("ALL DATABASES GENERATED SUCCESSFULLY")
    print(f"{'='*60}")
    for p in contractor_db_paths + [central_path]:
        size_kb = os.path.getsize(p) / 1024
        print(f"  {os.path.basename(p):30s} : {size_kb:.1f} KB")
    print(f"{'='*60}")
    print("Done!")


if __name__ == "__main__":
    main()
