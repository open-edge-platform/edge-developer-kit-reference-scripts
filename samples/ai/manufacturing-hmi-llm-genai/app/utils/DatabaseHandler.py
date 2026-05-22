# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 
from datetime import datetime
from typing import Dict, List, Union, Optional

from pymongo import MongoClient
from pymongo.errors import ServerSelectionTimeoutError
from geti_sdk.data_models import Prediction


class DatabaseHandler:
    def __init__(self, db_name: str, collection_name: str, uri: str = 'mongodb://localhost:27017/'):
        """
        Initialize the DatabaseHandler.

        Args:
            db_name (str): The name of the database.
            collection_name (str): The name of the collection.
            uri (str): The database connection string. Default is 'mongodb://localhost:27017/'.
        """
        self.client = MongoClient(uri)
        self.db_name = db_name
        self.db = self.client[db_name]
        self.collection_name = collection_name
        self.collection = self.db[collection_name]

        self._ensure_db_and_collection()

    def find(self, query: Dict, sort=None) -> List[Dict]:
        """
        Fetch multiple documents from the collection that match the specified query, optionally sorted.

        Args:
            query (dict): The filter criteria to search for matching documents.
            sort (list, optional): A list of tuples specifying the sort order. Each tuple should be in the form of 
                                (field_name, direction), where direction is either 1 (ascending) or -1 (descending). 
                                Default is None, meaning no sorting.

        Returns:
            List[Dict]: A list of documents that match the query, each document represented as a dictionary. 
                        If no documents match, an empty list is returned.
        """
        return self.collection.find(query, sort=sort)
    
    def find_one(self, query: Dict, sort: list) -> Dict:
        """
        Find one document that matches the query and sorting criteria.

        Args:
            query (dict): The filter criteria to search the document.
            sort (list): The sorting criteria for ordering the results.

        Returns:
            dict: The matching document, or None if no document is found.
        """
        return self.collection.find_one(query, sort=sort)
    
    def aggregate_documents(self, pipeline: List[Dict]) -> List[Dict]:
        """
        Perform aggregation operations on the collection.

        Args:
            pipeline (List[Dict]): A list of aggregation stages to be processed.

        Returns:
            List[Dict]: A list of documents resulting from the aggregation.
        """
        return list(self.collection.aggregate(pipeline))
    
    def count_documents(self, query: Dict) -> int:
        """
        Count the number of documents in the collection that match the specified query.

        Args:
            query (Dict): The filter criteria to match documents.

        Returns:
            int: The count of matching documents.
        """
        return self.collection.count_documents(query)

    def insert_document(self, pcb_id: str, status: str, image_path: str, prediction: Optional[Prediction] = None) -> None:
        """
        Insert PCB information (either pass or fail) into the collection.

        Args:
            pcb_id (str): The PCB identifier.
            status (str): The status of the PCB. Can be 'pass' or 'fail'.
            prediction (Prediction, optional): The prediction object containing annotations with defect information. 
                                                Only required if the status is 'fail'.
            image_path (str): The path to the image associated with the PCB.
        """
        timestamp = datetime.now()

        if status == "fail":
            if prediction is None:
                raise ValueError("Prediction must be provided for failed PCBs.")

            # Insert failed PCB information based on defect annotations
            for annotation in prediction.annotations:
                for label in annotation.labels:
                    entry = {
                        'pcb_id': pcb_id,
                        'status': "fail",
                        'defect_type': label.name,
                        'annotation_id': str(annotation.id),
                        'timestamp': timestamp,
                        'image_path': image_path
                    }
        elif status == "pass":
            # Insert passed PCB information
            entry = {
                'pcb_id': pcb_id,
                'status': "pass",
                'timestamp': timestamp,
                'image_path': image_path
            }
        else:
            raise ValueError("Invalid status. Must be 'pass' or 'fail'.")
        
        try:
            self.collection.insert_one(entry)
        except ServerSelectionTimeoutError as e:
            raise ServerSelectionTimeoutError(f"Database insert error: {e}")

    def get_next_pcb_id(self):
        # Get the document with the highest pcb_id, or return None
        highest_pcb = self.collection.find().sort('pcb_id', -1).limit(1)
        first_pcb = next(highest_pcb, None)

        if not first_pcb:
            return 1

        highest_pcb_id = first_pcb['pcb_id']
        next_pcb_id = highest_pcb_id + 1
        return next_pcb_id
    
    def _ensure_db_and_collection(self) -> None:
        """
        Ensures that a MongoDB database and a specific collection exist.
        If the database or collection doesn't exist, it will be created.

        Returns:
            None
        """

        # Check if database exists
        if self.db_name in self.client.list_database_names():
            print(f"Database '{self.db_name}' exists.")
        else:
            print(f"Database '{self.db_name}' does not exist. Creating it...")

        db = self.db

        # Check if collection exists
        if self.collection_name in db.list_collection_names():
            print(f"Collection '{self.collection_name}' already exists in '{self.db}'.")
        else:
            print(f"Collection '{self.collection_name}' does not exist. Creating it...")
            db.create_collection(self.collection_name)
            print(f"Collection '{self.collection_name}' created.")
    
    def close_connection(self) -> None:
        """
        Close the MongoDB connection.
        """
        self.client.close()
