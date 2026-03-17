# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
import os
import sys
import time
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List

import matplotlib.pyplot as plt
import psutil

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from utils.DatabaseHandler import DatabaseHandler


class AnalyticsStatistics:
    def __init__(self, database_handler: DatabaseHandler, image_directory: str):
        self.database_handler = database_handler
        self.image_directory = image_directory

    def _serialize_document(self, document: Dict) -> Dict:
        """
        Serialize defect data by converting ObjectId to string and ensuring proper serialization.
        """
        if '_id' in document:
            document['_id'] = str(document['_id'])  # Convert ObjectId to string
        if 'timestamp' in document and isinstance(document['timestamp'], datetime):
            # Convert datetime to ISO string
            document['timestamp'] = document['timestamp'].isoformat()
        return document

    def _get_documents_by_status_since(self, start_time: datetime, status: str = None) -> List[Dict]:
        """
        Get all documents since the specified start_time, optionally filtered by status.

        Args:
            start_time (datetime): The timestamp to filter from.
            status (str): The status to filter by. Can be 'pass', 'fail', or 'none'. Default is None (no status filter).

        Returns:
            List[Dict]: A list of serialized documents.
        """
        query = {"timestamp": {"$gte": start_time}}
        
        # Add status filter if specified
        if status == 'pass':
            query["status"] = "pass"
        elif status == 'fail':
            query["status"] = "fail"
        elif status is None:
            pass

        documents = self.database_handler.find(query)

        return [self._serialize_document(doc) for doc in documents]
    
    def get_documents_last_hours(self, hours: int, status: str = None) -> List[Dict]:
        """
        Get all documents in the last specified hours, optionally filtered by status.

        Args:
            hours (int): The number of hours from the current time.
            status (str): The status to filter by. Can be 'pass', 'fail', or 'none'. Default is None (no status filter).

        Returns:
            List[Dict]: A list of serialized documents.
        """
        start_time = datetime.now() - timedelta(hours=hours)
        return self._get_documents_by_status_since(start_time, status)

    def get_documents_last_days(self, days: int, status: str = None) -> List[Dict]:
        """
        Get all documents in the last specified days, optionally filtered by status.

        Args:
            days (int): The number of days from the current time.
            status (str): The status to filter by. Can be 'pass', 'fail', or 'none'. Default is None (no status filter).

        Returns:
            List[Dict]: A list of serialized documents.
        """
        start_time = datetime.now() - timedelta(days=days)
        return self._get_documents_by_status_since(start_time, status)

    def get_documents_last_weeks(self, weeks: int, status: str = None) -> List[Dict]:
        """
        Get all documents in the last specified weeks, optionally filtered by status.

        Args:
            weeks (int): The number of weeks from the current time.
            status (str): The status to filter by. Can be 'pass', 'fail', or 'none'. Default is None (no status filter).

        Returns:
            List[Dict]: A list of serialized documents.
        """
        start_time = datetime.now() - timedelta(weeks=weeks)
        return self._get_documents_by_status_since(start_time, status)

    def get_documents_last_months(self, months: int, status: str = None) -> List[Dict]:
        """
        Get all documents in the last specified months, optionally filtered by status.

        Args:
            months (int): The number of months from the current time.
            status (str): The status to filter by. Can be 'pass', 'fail', or 'none'. Default is None (no status filter).

        Returns:
            List[Dict]: A list of serialized documents.
        """
        start_time = datetime.now() - timedelta(days=months * 30)  # Approximation of a month
        return self._get_documents_by_status_since(start_time, status)

    def get_documents_last_years(self, years: int, status: str = None) -> List[Dict]:
        """
        Get all documents in the last specified years, optionally filtered by status.

        Args:
            years (int): The number of years from the current time.
            status (str): The status to filter by. Can be 'pass', 'fail', or 'none'. Default is None (no status filter).

        Returns:
            List[Dict]: A list of serialized documents.
        """
        start_time = datetime.now() - timedelta(days=years * 365)  # Approximation of a year
        return self._get_documents_by_status_since(start_time, status)

    def get_latest_document(self, status: str = None) -> Dict:
        """
        Get the latest document, optionally filtered by status.

        Args:
            status (str): The status to filter by. Can be 'pass', 'fail', or 'none'. Default is None (no status filter).

        Returns:
            dict: The latest document that matches the query and status filter. Raises an exception if no document is found.
        """
        # Build the query filter
        query = {}
        if status:
            query["status"] = status
        
        # Fetch the latest document matching the filter, sorting by timestamp in descending order
        latest_document = self.database_handler.find_one(query, sort=[('timestamp', -1)])

        if not latest_document:
            raise Exception(f"No document found with status '{status}'" if status else "No document found")

        return self._serialize_document(latest_document)
    
    def get_most_common_document(self, filters: Dict[str, Any], sort_by: str) -> Dict:
        """
        Get the most common document based on the provided filters and sort criteria.
        
        Args:
            filters (dict): The filters to apply to the documents. e.g., {"status": "fail", "defect_type": "missing capacitor"}
            sort_by (str): The field to sort the results by. e.g., "count" or any field in the document.

        Returns:
            dict: A dictionary with the most common document's field, its count, and the total count of matching documents.
        """
        # Define the aggregation pipeline to find the most common document based on filters and sort criteria
        pipeline = [
            {
                "$match": filters  # Apply the dynamic filters passed as a parameter
            },
            {
                "$group": {
                    "_id": "$defect_type",  # Group by field dynamically
                    "count": {"$sum": 1}  # Count the number of occurrences of each occurence
                }
            },
            {
                "$sort": {sort_by: -1}  # Sort by the specified field in descending order
            },
            {
                "$limit": 1  # Only return the most common document
            }
        ]

        # Run the aggregation query with the dynamic pipeline
        results = self.database_handler.aggregate_documents(pipeline)

        # Calculate the total number of matching documents based on the filters (using a count query)
        total_documents = self.database_handler.count_documents(filters)

        # Extract the most common document
        if results:
            most_common_document = results[0]
            common_field_value = most_common_document.get('_id')
            count = most_common_document.get('count')

            # Return the most common document and the total document count
            return {
                "most_common_field_value": common_field_value,
                "most_common_field_count": count,
                "total_documents": total_documents
            }
        else:
            return {"message": "No documents found matching the criteria."}

    def get_system_info(self) -> dict:
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

    def segment_documents_in_intervals(self, documents, interval=10):
        """
        Segment documents into fixed time intervals and count the number of documents per interval.

        Args:
            documents (list): A list of documents, each containing a 'timestamp' field.
            interval (int): The interval size in minutes for grouping timestamps.

        Returns:
            tuple: A tuple containing:
                - intervals (List[str]): List of interval labels in 'HH:MM' format.
                - counts (List[int]): List of corresponding defect counts per interval.
        """
        interval_counts = defaultdict(int)

        for doc in documents:
            timestamp = doc.get('timestamp')
            if not timestamp:
                continue

            # Parse ISO timestamp with or without microseconds
            try:
                parsed_time = datetime.strptime(timestamp, '%Y-%m-%dT%H:%M:%S.%f')
            except ValueError:
                parsed_time = datetime.strptime(timestamp, '%Y-%m-%dT%H:%M:%S')

            # Align timestamp to the start of the interval
            rounded_time = parsed_time.replace(second=0, microsecond=0)
            rounded_time -= timedelta(minutes=rounded_time.minute % interval)

            interval_counts[rounded_time] += 1

        # Sort intervals and prepare results
        sorted_intervals = sorted(interval_counts.items())
        intervals = [time.strftime('%H:%M') for time, _ in sorted_intervals]
        counts = [count for _, count in sorted_intervals]

        return intervals, counts
    
    def create_bar_chart(self, intervals, counts):
        """
        Create and save a bar chart representing document counts per time interval.

        Args:
            intervals (List[str]): List of interval labels (e.g., '13:00', '13:10', etc.).
            counts (List[int]): List of defect counts for each interval.

        Returns:
            str: File path to the saved bar chart image.
        """
        plt.figure(figsize=(10, 6))
        plt.bar(intervals, counts, color='skyblue')
        plt.xlabel('Time Interval (HH:MM)', fontsize=12)
        plt.ylabel('Number of Defects', fontsize=12)
        plt.title('Defect Count per Time Interval', fontsize=14)
        plt.xticks(rotation=45)
        plt.tight_layout()

        chart_filename = f"{self.image_directory}/{uuid.uuid4()}.png"
        plt.savefig(chart_filename, format='png')
        plt.close()

        return chart_filename
    
    def create_line_chart(self, intervals, counts):
        """
        Create and save a line chart showing defect trends across time intervals.

        Args:
            intervals (List[str]): List of interval labels (e.g., '13:00', '13:10', etc.).
            counts (List[int]): List of defect counts for each interval.

        Returns:
            str: File path to the saved line chart image.
        """
        plt.figure(figsize=(10, 6))
        plt.plot(intervals, counts, marker='o', linestyle='-', color='blue', linewidth=2)
        plt.xlabel('Time Interval (HH:MM)', fontsize=12)
        plt.ylabel('Number of Defects', fontsize=12)
        plt.title('Defect Trend Over Time', fontsize=14)
        plt.xticks(rotation=45)
        plt.grid(True)
        plt.tight_layout()

        chart_filename = f"{self.image_directory}/{uuid.uuid4()}.png"
        plt.savefig(chart_filename, format='png')
        plt.close()

        return chart_filename

    def create_pie_chart(self, data: dict) -> str:
        """
        Create and save a pie chart from a dictionary of labels and their counts.

        Args:
            data (dict): A dictionary where keys are labels and values are counts.

        Returns:
            str: File path to the saved pie chart image.
        """
        labels = list(data.keys())
        counts = list(data.values())

        plt.figure(figsize=(8, 8))
        plt.pie(counts, labels=labels, autopct='%1.1f%%', startangle=140, colors=plt.cm.Paired.colors)
        plt.title('Quality Statistics', fontsize=14)
        plt.tight_layout()

        chart_filename = f"{self.image_directory}/{uuid.uuid4()}.png"
        plt.savefig(chart_filename, format='png')
        plt.close()

        return chart_filename

    def get_document_counts_by_field(self, field_name: str, match_filter: dict = None) -> Dict[str, int]:
        """
        Get counts of documents grouped by a specific field (e.g., 'status', 'defect_type').

        Args:
            field_name (str): The field name to group by.
            match_filter (dict): Optional MongoDB filter to apply before grouping (e.g., {"status": "fail"}).

        Returns:
            Dict[str, int]: A dictionary with field values as keys and their corresponding document counts as values.
        """
        pipeline = []

        # Apply match filter if provided
        if match_filter:
            pipeline.append({"$match": match_filter})

        # Group by the specified field and count
        pipeline.extend([
            {
                "$group": {
                    "_id": f"${field_name}",
                    "count": {"$sum": 1}
                }
            },
            {
                "$sort": {"count": -1}
            }
        ])

        results = self.database_handler.aggregate_documents(pipeline)

        # Convert to a dictionary format
        return {doc["_id"]: doc["count"] for doc in results if doc["_id"] is not None}
