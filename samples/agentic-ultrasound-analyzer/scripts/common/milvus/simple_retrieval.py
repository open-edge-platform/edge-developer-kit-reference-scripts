# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import argparse
import os
import re

from common.milvus.milvus_wrapper import MilvusManager
from common.openvino_blip.openvino_blip_embeddings import OpenVINOBlipEmbeddings
from common.openvino_blip.blip_client import BlipServiceClient


EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "Salesforce/blip-itm-base-coco")
TXT_EMBEDDING_DEVICE = os.environ.get("TXT_EMBEDDING_DEVICE", "GPU")
IMG_EMBEDDING_DEVICE = os.environ.get("IMG_EMBEDDING_DEVICE", "GPU")
BLIP_SERVICE_URL = os.environ.get("BLIP_SERVICE_URL", "")

class Retrieval:
    def __init__(self, milvus_uri: str, milvus_port: str, milvus_dbname: str, collection_name: str):
        self.milvus_manager = MilvusManager(host=milvus_uri, 
                                            port=milvus_port, 
                                            db_name=milvus_dbname)
        
        if BLIP_SERVICE_URL:
            self.ov_blip_embedder = BlipServiceClient(base_url=BLIP_SERVICE_URL)
        else:
            self.ov_blip_embedder = OpenVINOBlipEmbeddings(
                model_id=EMBEDDING_MODEL,
                ov_text_device=TXT_EMBEDDING_DEVICE,
                ov_vision_device=IMG_EMBEDDING_DEVICE,
            )
        self.test = "true"
        
        self.collection_name = collection_name
        
        milvus_client = self.milvus_manager._get_client()
        if milvus_client is None:
            raise ConnectionError("Failed to connect to Milvus server.")

        if milvus_client.has_collection(collection_name):
            print(f"Collection {collection_name} already exists.")
            milvus_client.load_collection(collection_name)
        else:
            raise ValueError(f"Collection {collection_name} does not exist.")

    def _filter_by_score(self, docs, min_score=None):
        if not docs or min_score is None:
            return docs

        return [doc for doc in docs if float(doc.get("distance", 0.0)) >= min_score]

    def _compose_mode_filter(self, mode: str, filter_expression=None):
        mode_filter = f'metadata["mode"] == "{mode}"'
        normalized_filter = self._normalize_filter_expression(filter_expression)
        if normalized_filter:
            return f"({mode_filter}) and ({normalized_filter})"
        return mode_filter

    @staticmethod
    def _escape_filter_value(value: str) -> str:
        return value.replace("\\", "\\\\").replace('"', '\\"')

    def _compose_video_filter(self, video_id: str, mode: str = "analysis", extra_filter_expression=None):
        video_filter = f'metadata["video_id"] == "{self._escape_filter_value(video_id)}"'
        base_filter = self._compose_mode_filter(mode, video_filter) if mode else video_filter
        normalized_extra_filter = self._normalize_filter_expression(extra_filter_expression)
        if normalized_extra_filter:
            return f"({base_filter}) and ({normalized_extra_filter})"
        return base_filter

    @staticmethod
    def _normalize_filter_expression(filter_expression: str) -> str:
        if not isinstance(filter_expression, str):
            return ""

        expr = filter_expression.strip()

        # Normalize key syntax: metadata[video_id] or metadata['video_id'] -> metadata["video_id"]
        expr = re.sub(r"metadata\[\s*'([^']+)'\s*\]", r'metadata["\1"]', expr)
        expr = re.sub(r"metadata\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]", r'metadata["\1"]', expr)

        # Normalize quoted string literals to double quotes for Milvus expression parser.
        expr = re.sub(r"(==|!=)\s*'([^']*)'", r'\1 "\2"', expr)

        # Quote bareword RHS string values (common when shell strips quotes).
        def _quote_bareword(match):
            lhs = match.group(1)
            rhs = match.group(2)
            lower_rhs = rhs.lower()
            if lower_rhs in {"true", "false", "null"}:
                return f"{lhs}{rhs}"
            if re.fullmatch(r"-?\d+(\.\d+)?", rhs):
                return f"{lhs}{rhs}"
            return f'{lhs}"{rhs}"'

        expr = re.sub(
            r'(metadata\["[^"]+"\]\s*(?:==|!=)\s*)([A-Za-z0-9_:\.-]+)',
            _quote_bareword,
            expr,
        )
        return expr

    @staticmethod
    def _normalize_docs(docs):
        """Flatten pymilvus search/query results into a uniform list of dicts."""
        if isinstance(docs, dict):
             raise RuntimeError(docs.get("message", "Unexpected Milvus response"))
        if docs is None:
            return []
        # If it's already a plain list of dicts (from query()), return as-is
        if isinstance(docs, list) and docs and isinstance(docs[0], dict):
            return docs
        # search() returns list[HybridHits]; flatten the first (and only) query vector's hits
        normalized = []
        for result_set in docs:
            for hit in result_set:
                normalized.append(dict(hit))
        return normalized

    def run(
        self,
        query_text=None,
        query_img=None,
        retrive_top_k=3,
        filter_expression=None,
        min_score=None,
    ):
        docs = None
        use_score_filter = False
        
        if query_text:
            use_score_filter = True
            effective_filter = self._compose_mode_filter("analysis", filter_expression)
            print("Performing similarity search with the following parameters:")
            print(f"Search Query: {query_text}")
            print(f"With Filter Expression: {effective_filter}")

            embedding = self.ov_blip_embedder.embed_query(query_text)
            print(f"Generated text embedding of Shape: {embedding.shape}")
            
            docs = self.milvus_manager.search(collection_name=self.collection_name,
                                            query_vector=[embedding],
                                            limit=retrive_top_k,
                                            filter=effective_filter)
            docs = self._normalize_docs(docs)

                    
        elif query_img:
            use_score_filter = True
            effective_filter = self._compose_mode_filter("image", filter_expression)
            print("Performing similarity search with image query:")
            print(f"Image Path: {query_img}")
            print(f"With Filter Expression: {effective_filter}")

            embedding = self.ov_blip_embedder.embed_image(query_img)
            print(f"Generated img embedding of Shape: {embedding.shape}")
            
            docs = self.milvus_manager.search(collection_name=self.collection_name,
                                            query_vector=[embedding],
                                            limit=retrive_top_k,
                                            filter=effective_filter)
            docs = self._normalize_docs(docs)
           
        elif filter_expression:
            print("Permforming query with filter expression (no similarity search since query_text is None):")

            effective_filter = self._normalize_filter_expression(filter_expression)
            print(f"With Filter Expression: {effective_filter}")

            docs = self.milvus_manager.query(collection_name=self.collection_name, 
                                            filter=effective_filter,
                                            limit=retrive_top_k)
            docs = self._normalize_docs(docs)
        else:
            print("No query text and filter expression provided. Please set either of them.")

        if min_score is not None and use_score_filter:
            before = len(docs) if docs else 0
            docs = self._filter_by_score(docs, min_score=min_score)
            after = len(docs) if docs else 0
            print(f"Applied min_score={min_score}. Kept {after}/{before} results.")
        elif min_score is not None and not use_score_filter and docs is not None:
            print("Skipped min_score filtering for metadata-only query (no similarity scores available).")
        
        return docs
  
    def display_results(self, docs):
        if docs:
            for doc in docs:
                print(f"Similarity Score: {doc['distance'] if 'distance' in doc else 'Not Applicable'}")
                if "entity" in doc:
                    print(f"All Metadata: {doc['entity']['metadata'] if 'metadata' in doc['entity'] else 'No metadata available'}")
                elif "metadata" in doc:
                    print(f"All Metadata: {doc['metadata']}")
                else:
                    print("No metadata available for this document.")
                print(f"{'-'*50}")
                
            print(f"Total documents retrieved: {len(docs)}")

        else:
            print("No results found for the provided query/filter expression.")

    def get_report_data(
        self,
        video_id: str,
        filter_expression=None,
    ):
        docs = None
        effective_filter = self._compose_video_filter(
            video_id=video_id,
            mode="analysis",
            extra_filter_expression=filter_expression,
        )        
        print(f"Filter Expression: {effective_filter}")        
        docs = self.milvus_manager.query(collection_name=self.collection_name,
                                          filter=effective_filter,
                                          limit=3)        
        reports = []
        if docs:
            for doc in docs:                
                metadata = None
                if isinstance(doc, dict):
                    if "entity" in doc and isinstance(doc["entity"], dict):
                        metadata = doc["entity"].get("metadata")
                    elif "metadata" in doc:
                        metadata = doc.get("metadata")

                if isinstance(metadata, dict) and "text" in metadata and "image_path" in metadata:
                    reports.append({"report": metadata["text"], "image_path": metadata["image_path"]})
                else:
                    print("Missing data for this document.")
        #print("Reports Retrieved:", reports)
        return reports
      
if __name__ == "__main__":
    parser = argparse.ArgumentParser()    
    parser.add_argument("--query_text", type=str, default=None)
    parser.add_argument("--query_img", type=str, default=None)
    parser.add_argument("--milvus_uri", type=str, default="localhost")
    parser.add_argument("--milvus_port", type=int, default=19530)
    parser.add_argument("--milvus_dbname", type=str, default="default")
    parser.add_argument("--collection_name", type=str, default="ultrasound_captures")
    parser.add_argument("--retrieve_top_k", type=int, default=3)
    parser.add_argument("--filter_expression", type=str, nargs="?", default=None)
    parser.add_argument("--min_score", type=float, default=0.7)

    args = parser.parse_args()
    
    ret = Retrieval(milvus_uri=args.milvus_uri, 
              milvus_port=args.milvus_port, 
              milvus_dbname=args.milvus_dbname,
              collection_name=args.collection_name)

    docs = ret.run(query_text=args.query_text,
            query_img=args.query_img,
            retrive_top_k=args.retrieve_top_k,
            filter_expression=args.filter_expression,
            min_score=args.min_score)
    
    ret.display_results(docs)