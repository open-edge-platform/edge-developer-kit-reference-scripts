#!/usr/bin/python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import streamlit as st
import pandas as pd
import pytz
from streamlit_autorefresh import st_autorefresh
from influxdb_client import InfluxDBClient
from datetime import timedelta

# Central database influxdb configuration
INFLUX_URL = "http://<SERVER_IP>:8086"
INFLUX_TOKEN = "<TOKEN>"
INFLUX_ORG = "hospital"
INFLUX_BUCKET = "patient_data"

REFRESH_SEC = 1 # auto refresh interval
QUERY_WINDOW = "-1h" # last 10mins
#LOOKBACK = "-30d"

# Setup Streamlit Page
st.set_page_config(
        page_title="Patient Dashboard",
        layout="wide",
)

st.title("Real-Time Patient Monitoring")

# Auto Refresh
st_autorefresh(interval=REFRESH_SEC * 1000, limit=None, key="refresh")

# influxdb client
@st.cache_resource
def get_client():
    return InfluxDBClient(
            url=INFLUX_URL,
            token=INFLUX_TOKEN,
            org=INFLUX_ORG,
    )

client = get_client()
query_api = client.query_api()


def flux_to_dataframe(tables):
    """Safely convert Flux tables to a DataFrame."""
    frames = []
    for table in tables:
        if table.records:
            frames.append(pd.DataFrame([r.values for r in table.records]))
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)

def get_vital(df, field):
    """Safely get a value from column if present."""
    if df.empty or field not in df.columns:
        return None
    return df[field].iloc[0]


# Load tag values
@st.cache_data(ttl=60)
def load_wards_values():
    flux = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: {QUERY_WINDOW})
  |> filter(fn: (r) => r._measurement == "vitals")
  |> keep(columns: ["ward"])
  |> distinct(column: "ward")
'''
    tables = query_api.query(flux)
    return sorted({r.get_value() for t in tables for r in t.records})

@st.cache_data(ttl=60)
def load_patients_values(ward):
    flux = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: {QUERY_WINDOW})
  |> filter(fn: (r) =>
    r._measurement == "vitals" and
    r.ward == "{ward}"
  )
  |> keep(columns: ["patient"])
  |> distinct(column: "patient")
'''
    tables = query_api.query(flux)
    return sorted({r.get_value() for t in tables for r in t.records})

# Query
def render_dashboard(ward, patient):

    latest_flux = f'''
from(bucket: "patient_data")
  |> range(start: -5m)
  |> filter(fn: (r) =>
    r._measurement == "vitals" and
    r.ward == "{ward}" and
    r.patient == "{patient}"
  )
  |> filter(fn: (r) =>
    r._field == "heart_rate" or
    r._field == "spo2" or
    r._field == "respiratory_rate" or
    r._field == "body_temperature"
  )
  |> last()
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
'''

    tables = query_api.query(latest_flux)
    latest_df = flux_to_dataframe(tables)

    # Sort by time descending so index 0 is always the most recent row.
    if not latest_df.empty and "_time" in latest_df.columns:
        latest_df = latest_df.sort_values("_time", ascending=False).reset_index(drop=True)

    # Display
    st.subheader(f" {ward} / {patient} - Current Vitals")

    if latest_df.empty:
        st.warning("No data available.")
    else:
        c1, c2, c3, c4 = st.columns(4)

        c1.metric(" Heart Rate", f"{int(latest_df['heart_rate'][0])} bpm")
        c2.metric(" SpO2", f"{int(latest_df['spo2'][0])} %")
        c3.metric(" Respiratory Rate", f"{int(latest_df['respiratory_rate'][0])} /min")
        c4.metric(" Temperature", f"{int(latest_df['body_temperature'][0])} °C")

    st.subheader(f"Trends ({QUERY_WINDOW})")

    col1, col2 = st.columns(2)

    with col1:
        hr_df = load_timeseries("heart_rate")
        if not hr_df.empty:
            st.markdown("Heart Rate (bpm)")
            st.line_chart(data=hr_df, x="time_label", y="value")
        else:
            st.info("No heart rate data in this window.")

    with col2:
        spo2_df = load_timeseries("spo2")
        if not spo2_df.empty:
            st.markdown(" SpO₂ (%)")
            st.line_chart(data=spo2_df, x="time_label", y="value")
        else:
            st.info("No SpO₂ data in this window.")

    st.markdown("---")
    col3, col4 = st.columns(2)

    with col3:
        rr_df = load_timeseries("respiratory_rate")
        if not rr_df.empty:
            st.markdown(" Respiratory Rate (/min)")
            st.line_chart(data=rr_df, x="time_label", y="value")
        else:
            st.info("No respiratory rate data in this window.")

    with col4:
        temp_df = load_timeseries("body_temperature")
        if not temp_df.empty:
            st.markdown(" Body Temperature (°C)")
            st.line_chart(data=temp_df, x="time_label", y="value")
        else:
            st.info("No Body Temperature data in this window.")

# Time Series Charts
def load_timeseries(field):
    flux = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: {QUERY_WINDOW})
  |> filter(fn: (r) =>
    r._measurement == "vitals" and
    r._field == "{field}" and
    r.ward == "{ward}" and
    r.patient == "{patient}"
  )
'''
    rows = []
    for t in query_api.query(flux):
        for r in t.records:
            rows.append({
                "_time": r.get_time(),
                "value": r.get_value(),
            })

    if not rows:
        return pd.DataFrame(columns=["_time", "value"])

    df = pd.DataFrame(rows)
    local_tz = pytz.timezone("Asia/Kuala_Lumpur")
    df["_time"] = pd.to_datetime(df["_time"], utc=True).dt.tz_convert(local_tz)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.sort_values("_time")
    df["time_label"] = df["_time"].dt.strftime("%H:%M")
    return df

# Sidebar controls
st.sidebar.header("Patient Selection")

wards = load_wards_values()
if not wards:
    st.sidebar.info("Waiting for data.")
    st.info("No data yet. Dashboard will update automatically")
else:
    ward = st.sidebar.selectbox("Ward", wards)

    patients = load_patients_values(ward)
    if not patients:
        st.sidebar.info("Waiting for data.")
        st.info("No data yet. Dashboard will update automatically")
    else:
        patient = st.sidebar.selectbox("Patient", patients)
        st.sidebar.caption(f"{len(patients)} active patients")

        render_dashboard(ward, patient)