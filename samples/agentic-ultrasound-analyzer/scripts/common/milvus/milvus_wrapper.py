# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from datetime import datetime
from typing import List
from pymilvus import DataType, MilvusClient
import os
import threading


class MilvusManager:    

    def __init__(self, db_name="default", host="localhost", port="19530"):
        self._local = threading.local()
        self.milvus_dbname = db_name
        self.milvus_host = host
        self.milvus_port = port

        test_client = MilvusClient(
            uri=f"http://{self.milvus_host}:{self.milvus_port}"
        )
        dbs = test_client.list_databases()
        if self.milvus_dbname not in dbs:
            print(f"Database {self.milvus_dbname} does not exist. Creating it.")
            test_client.create_database(self.milvus_dbname)
        else:
            print(f"Database {self.milvus_dbname} already exists.")
        
        print(f"Connected to Milvus at {self.milvus_host}:{self.milvus_port} "
              f"using database {self.milvus_dbname}")
        

    def _get_client(self) -> MilvusClient:
        """
        Get a thread-local MilvusClient instance
        """
        if not hasattr(self._local, "client"):
            self._local.client = MilvusClient(uri=f"http://{self.milvus_host}:{self.milvus_port}", db_name=self.milvus_dbname)
        return self._local.client

    def create_collection(self, collection_name: str, dim: int, overwrite=False):
        """
        Create a new collection in Milvus
        """
        client = self._get_client()
        try:
            if client.has_collection(collection_name):
                if overwrite:
                    print(f"Overwrite flag is set. Dropping existing collection {collection_name}.")
                    client.drop_collection(collection_name)
                else:
                    print(f"Collection {collection_name} already exists.")
                    client.load_collection(collection_name)
                    return {"status": "exists", "message": f"Collection {collection_name} already exists."}

            schema = client.create_schema(enable_dynamic_field=True)
            schema.add_field(field_name="pk", datatype=DataType.INT64, is_primary=True, auto_id=True)
            schema.add_field(field_name="vector", datatype=DataType.FLOAT_VECTOR, dim=dim)
            schema.add_field(field_name="metadata", datatype=DataType.JSON)

            index_params = MilvusClient.prepare_index_params()
            index_params.add_index(
                field_name="vector",
                index_type="FLAT",
                index_name="vector_index",
                metric_type="COSINE"
            )

            client.create_collection(
                collection_name=collection_name,
                index_params=index_params,
                schema=schema,
            )
            
            res = client.get_load_state(collection_name=collection_name)
            print(f"Collection {collection_name} created with dimension {dim}: Load state: {res}")
            
            return {"status": "success", "message": f"Collection {collection_name} created.", "load_state": str(res)}

        except Exception as e:
            print(f"Error creating collection {collection_name}: {e}")
            return {"status": "error", "message": str(e)}
    
    def drop_collection(self, collection_name: str):
        """
        Drop a collection in Milvus
        """
        client = self._get_client()
        try:
            if client.has_collection(collection_name):
                client.drop_collection(collection_name)
                return {"status": "success", "message": f"Collection {collection_name} dropped."}
            else:
                return {"status": "error", "message": f"Collection {collection_name} does not exist."}
        except Exception as e:
            print(f"Error dropping collection {collection_name}: {e}")
            return {"status": "error", "message": str(e)}

    def _ensure_partition(self, collection_name: str, partition_name: str):
        """
        Create partition if it does not exist
        """
        client = self._get_client()
        try:
            if not client.has_partition(collection_name, partition_name):
                client.create_partition(collection_name=collection_name,
                                        partition_name=partition_name)
        except Exception as e:
            print(f"Error creating partition {partition_name}: {e}")
            raise

    def generate_partition_name(self, prefix: str = "reid", fmt: str = "%Y%m%d_%H") -> str:
        """
        Generate a partition name based on current time
        """
        return f"{prefix}_{datetime.now().strftime(fmt)}"

    def insert_data(self, collection_name: str, vectors: list, metadatas: list, partition_name: str = None):
        """
        Insert data into the collection
        """
        client = self._get_client()
        try:
            if not client.has_collection(collection_name):
                raise ValueError(f"Collection {collection_name} does not exist.")

            if partition_name is None:
                partition_name = self.generate_partition_name(prefix=collection_name)

            if partition_name:
                self._ensure_partition(collection_name, partition_name)

            if metadatas is None:
                metadatas = [{} for _ in range(len(vectors))]

            records = [{"vector": vec, "metadata": meta} for vec, meta in zip(vectors, metadatas)]
            resp = client.insert(collection_name=collection_name, data=records, partition_name=partition_name)

            return {"status": "success", "total_chunks": resp["insert_count"]}
        except Exception as e:
            print(f"Error inserting data into {collection_name}: {e}")
            return {"status": "error", "message": str(e)}

    def search(self, collection_name: str, query_vector: List[list] | list, output_fields = ["metadata", "vector"],
               limit: int = 1, filter: str = "", partition_names: list = None):
        """
        Search for similar vectors in the collection
        """
        client = self._get_client()
        try:
            if not client.has_collection(collection_name):
                raise ValueError(f"Collection {collection_name} does not exist.")

            search_params = {"metric_type": "COSINE"}

            if partition_names:
                existing_partitions = client.list_partitions(collection_name)
                partition_names = [p for p in partition_names if p in existing_partitions]
                if not partition_names:
                    # print(f"None of the specified partitions exist in {collection_name}.")
                    partition_names = None

            results = client.search(
                collection_name=collection_name,
                data=query_vector,
                output_fields=output_fields,
                limit=limit,
                filter=filter,
                search_params=search_params,
                consistency_level="Strong",
                partition_names=partition_names
            )
            return list(results)
        except Exception as e:
            print(f"Error searching in {collection_name}: {e}")
            return {"status": "error", "message": str(e)}
    
    def upsert_data(self, collection_name: str, pks: list, vectors: list, metadatas: list, partition_name: str = None):
        """
        Upsert data into the collection
        """
        client = self._get_client()
        try:
            if not (len(pks) == len(vectors) == len(metadatas)):
                raise ValueError("pks, vectors, and metadatas length must match.")
            
            if not client.has_collection(collection_name):
                raise ValueError(f"Collection {collection_name} does not exist.")

            if partition_name is None:
                partition_name = self.generate_partition_name(prefix=collection_name)

            if partition_name:
                self._ensure_partition(collection_name, partition_name)

            records = []
            for pk, vector, metadata in zip(pks, vectors, metadatas):
                record = {
                    "pk": pk,
                    "vector": vector,
                    "metadata": metadata
                }
                records.append(record)

            resp = client.upsert(
                collection_name=collection_name,
                data=records,
                partition_name=partition_name
            )

            return {"status": "success", "total_chunks": resp["upsert_count"], "pks": resp["primary_keys"]}
        except Exception as e:
            print(f"Error upserting data into {collection_name}: {e}")
            return {"status": "error", "message": str(e)}
            

    def query(self, collection_name: str, filter: str = "", limit: int = 100, output_fields = ["pk", "metadata"], partition_names: list = None):
        """
        Query the collection with an expression
        """
        client = self._get_client()
        try:
            if not client.has_collection(collection_name):
                raise ValueError(f"Collection {collection_name} does not exist.")

            if partition_names:
                existing_partitions = client.list_partitions(collection_name)
                partition_names = [p for p in partition_names if p in existing_partitions]
                if not partition_names:
                    print(f"None of the specified partitions exist in {collection_name}.")
                    partition_names = None
            
            results = client.query(
                collection_name=collection_name,
                filter=filter,
                output_fields=output_fields,
                limit=limit,
                consistency_level="Strong",
                partition_names=partition_names
            )
            return results
        except Exception as e:
            print(f"Error querying {collection_name}: {e}")
            return {"status": "error", "message": str(e)}