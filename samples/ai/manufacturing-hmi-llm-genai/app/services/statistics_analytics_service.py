# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
import os
import psutil
import time
from pymongo.errors import ServerSelectionTimeoutError
from app.core import globals
from app.core.globals import get_analytics_statistics_generator

# Initialize generators
analytics_statistics_generator = get_analytics_statistics_generator()

# Assign config variables to local variables for efficiency
image_dir = globals.image_dir

def get_system_info() -> dict:
    """
    Get the current system information, including CPU usage, memory usage, and system uptime.

    Returns:
        dict: A dictionary containing the following system information:
            - "cpu_usage_percent": The CPU usage percentage.
            - "memory_available_gb": Available memory in gigabytes.
            - "memory_used_gb": Used memory in gigabytes.
            - "memory_percent": Percentage of used memory.
            - "uptime": System uptime in the format "hh:mm:ss".
    """
    # Get system boot time and calculate uptime in seconds
    boot_time = psutil.boot_time()
    uptime_seconds = time.time() - boot_time

    # Calculate uptime in hours, minutes, seconds
    uptime = time.strftime("%Hh %Mm %Ss", time.gmtime(uptime_seconds))

    # Get memory stats and convert to GB
    memory = psutil.virtual_memory()
    memory_available_gb = memory.available / (1024 ** 3)
    memory_used_gb = memory.used / (1024 ** 3)

    # Collect system information in a dictionary
    system_info = {
        "cpu_usage_percent": psutil.cpu_percent(interval=1),
        "memory_available_gb": round(memory_available_gb, 2),
        "memory_used_gb": round(memory_used_gb, 2),
        "memory_percent": memory.percent,
        "uptime": uptime
    }

    return system_info

def get_latest_defect() -> dict:
    """
    Get the latest defect document from the database.

    Returns:
        dict: The latest defect document.
    """
    latest_defect = analytics_statistics_generator.get_latest_document(status="fail")
    latest_defect = rename_image_path_to_image_url(document=latest_defect)
    return latest_defect

def get_defects_last_hour() -> dict:
    """
    Get defect statistics for the last hour.

    Returns:
        dict: A dictionary containing defect statistics for the last hour.
    """
    defects = analytics_statistics_generator.get_documents_last_hours(hours=1, status="fail")
    intervals, counts = analytics_statistics_generator.segment_documents_in_intervals(documents=defects, interval=10)
    chart_url = analytics_statistics_generator.create_bar_chart(intervals=intervals, counts=counts)
    return {
        "number_defects": len(defects),
        "chart_image_url": chart_url
    }

def get_defects_last_day() -> dict:
    """
    Get defect statistics for the last day.

    Returns:
        dict: A dictionary containing defect statistics for the last day.
    """
    defects = analytics_statistics_generator.get_documents_last_hours(hours=24, status="fail")
    intervals, counts = analytics_statistics_generator.segment_documents_in_intervals(documents=defects, interval=60)
    chart_url = analytics_statistics_generator.create_line_chart(intervals=intervals, counts=counts)
    return {
        "number_defects": len(defects),
        "chart_image_url": chart_url
    }

def get_most_common_defect() -> dict:
    """
    Get the most common defect.

    Returns:
        dict: A dictionary containing the most common defect.
    """
    data = analytics_statistics_generator.get_most_common_document(sort_by="defect_type", filters={"status": "fail"})

    return {
        "most_common_defect": data["most_common_field_value"],
        "most_common_defect_count": data["most_common_field_count"],
        "total_defects": data["total_documents"],
    }

def rename_image_path_to_image_url(document: dict) -> dict:
    """
    Rename 'image_path' key to 'image_url' in a single document dictionary.

    Args:
        document (dict): The input dictionary.

    Returns:
        dict: A new dictionary with 'image_path' renamed to 'image_url'.
    """
    if "image_path" in document:
        document["image_url"] = document.pop("image_path")
    return document

def get_quality_distribution() -> dict:
    """
    Get the quality distribution of defects.

    Returns:
        dict: A dictionary containing the quality distribution.
    """
    distribution = analytics_statistics_generator.get_document_counts_by_field(field_name="status")
    chart_url = analytics_statistics_generator.create_pie_chart(data=distribution)
    return {
        "chart_image_url": chart_url,
        "pass": distribution['pass'],
        "fail": distribution['fail']
    }