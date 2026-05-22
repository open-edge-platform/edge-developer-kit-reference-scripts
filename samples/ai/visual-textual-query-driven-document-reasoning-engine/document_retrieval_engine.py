# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

import os
from typing import Any, List, Optional

import torch
from pdf2image import convert_from_path
from PIL import Image
from torch.utils.data import DataLoader
from tqdm.auto import tqdm

import config
from model_registry import MODEL_REGISTRY as model_registry

_MAX_PAGES = config.DOCUMENT_INDEX_MAX_PAGES
_BATCH = config.DOCUMENT_INDEX_BATCH_SIZE


class DocumentRetrievalEngine:
    """
    The DocumentRetrievalEngine is responsible for:
      1. Initializing the specified model and processor from a registry.
      2. Converting PDFs to images for further processing.
      3. Building an index by generating embeddings for the PDF images.
      4. Searching and retrieving relevant pages based on text and/or image queries.
    """

    def __init__(self, model_id: str, device: str = torch.device("xpu:0")) -> None:
        """
        Initialize the DocumentRetrievalEngine with a model ID.

        :param model_id: Identifier for the model to be used for document retrieval.
        :param device: Device for the model and inferencing (default is "xpu:1").
        """
        self.model_id = model_id
        self.model = None
        self.processor = None
        self.device = device
        self._initialize_model_processor()
        # self._model_warmup()

    def _initialize_model_processor(self) -> None:
        """
        Initializes the model and processor based on the provided model ID by
        looking up the model registry and loading both the model class and processor class.

        :return: None
        """
        for entry in model_registry:
            if self.model_id in entry["model_ids"]:
                self.model = (
                    entry["model_class"]
                    .from_pretrained(self.model_id, torch_dtype="bfloat16")
                    .to(self.device)
                    .eval()
                )
                self.processor = entry["processor_class"].from_pretrained(self.model_id)

    def _model_warmup(self) -> None:
        """
        Performs a warmup pass on the model to ensure it is ready for inference.
        This is useful for models that require some initial processing before they can be used effectively.
        """
        pdf_file_path = "assets/sample.pdf"
        print(f"Warmup with {pdf_file_path}")
        self.build_index(
            [pdf_file_path],
            embeddings_path=None,
            save_embeddings=False,
        )

    def _convert_pdf_to_images(self, paths: List[str]) -> List[Image.Image]:
        """
        Converts each PDF file in 'paths' into a list of images.

        :param paths: Paths to PDF files.
        :return: A list of Pillow Image objects representing pages of all PDFs combined.
        :raises ValueError: If the combined number of pages exceeds _MAX_PAGES.
        """
        images = []
        for p in paths:
            images.extend(convert_from_path(p, thread_count=4))

        if len(images) >= _MAX_PAGES:
            raise ValueError(f"Limit {_MAX_PAGES} pages exceeded.")
        return images

    def _generate_embedding_filename(
        self, pdf_paths: list[str], model_id: str, custom_path: Optional[str] = None
    ) -> str:
        """
        Generate a deterministic and human-readable filename for embeddings based on the input PDFs and model ID.

        Args:
            pdf_paths (list[str]): List of paths to PDF files.
            model_id (str): Identifier of the embedding model.

        Returns:
            str: A reproducible string filename ending with .pt
        """
        if custom_path:
            return custom_path

        os.makedirs("embeddings", exist_ok=True)

        base_names = sorted(
            [os.path.splitext(os.path.basename(p))[0] for p in pdf_paths]
        )

        pdf_part = "_".join(base_names)
        model_part = model_id.replace("/", "-").replace(" ", "_")
        filename = f"{pdf_part}_{model_part}.pt"

        filename = filename[:240] + ".pt" if len(filename) > 240 else filename

        return os.path.join("embeddings", filename)

    def _save_embeddings(self, embeddings: torch.Tensor, embeddings_path: str) -> None:
        """
        Saves embeddings to the specified path.

        :param embeddings: A torch Tensor containing the embeddings data.
        :param embeddings_path: File path where the embeddings should be stored.
        """
        torch.save(embeddings, embeddings_path)

    def _load_embeddings(self, embeddings_path: str) -> Any:
        """
        Loads embeddings from the specified path.

        :param embeddings_path: File path where the embeddings are stored.
        :return: The loaded torch Tensor or embedding object.
        """
        return torch.load(embeddings_path)

    def build_index(
        self,
        pdf_paths: List[str],
        embeddings_path: Optional[str] = None,
        save_embeddings: Optional[bool] = True,
    ) -> dict:
        """
        Builds an index from provided PDF paths by converting the PDFs to images
        and generating embeddings. If embeddings already exist at 'embeddings_path',
        they are loaded instead of being recalculated.

        :param pdf_paths: List of PDF file paths to be indexed.
        :param embeddings_path: An optional path to load/save embeddings.
        :return: Dictionary containing the status message, computed embeddings, and converted images.
        """
        embeddings = []
        pages = self._convert_pdf_to_images(pdf_paths)
        if save_embeddings:
            embeddings_path = self._generate_embedding_filename(
                pdf_paths, self.model_id, embeddings_path
            )

        if embeddings_path and os.path.exists(embeddings_path):
            print(f"Loading embeddings from {embeddings_path}")
            embeddings = torch.load(embeddings_path)
        else:
            data_loader = DataLoader(
                pages,
                batch_size=_BATCH,
                shuffle=False,
                collate_fn=lambda x: self.processor.process_images(x),
            )
            for batch_doc in tqdm(data_loader):
                with torch.no_grad():
                    batch_doc = {k: v.to(self.device) for k, v in batch_doc.items()}
                    embeddings_doc = self.model(**batch_doc)
                embeddings.extend(list(torch.unbind(embeddings_doc.to(self.device))))

            if embeddings_path:
                torch.save(embeddings, embeddings_path)
                print(f"Embeddings saved to {embeddings_path}")

        return (f"Uploaded and converted {len(pages)} pages", embeddings, pages)

    def search_and_retrieve(
        self,
        embeddings: List,
        document_pages: List[Image.Image],
        user_queries: Optional[List[str]] = None,
        component_images: Optional[List[Image.Image]] = None,
        component_name: Optional[str] = None,
        k: int = 5,
    ) -> List:
        """
        Searches the provided embeddings for the top-k most relevant matches,
        based on text and/or image queries.

        :param embeddings: List of embedding tensors for the indexed pages.
        :param document_pages: List of the actual page images corresponding to 'embeddings'.
        :param user_queries: Optional list of text queries.
        :param component_images: Optional list of reference images to query against the index.
        :param component_name: Optional string to prepend to the user queries.
        :param k: Number of top results to return.
        :return: A list of tuples, with each tuple containing a relevant page image and its label.
        :raises ValueError: If neither 'user_queries' nor 'component_images' is provided.
        """
        if not user_queries and not component_images and not component_name:
            raise ValueError(
                "You must provide at least one of 'user_queries' or 'component_images' or 'component_name'."
            )
        
        text_queries = []
        image_queries = []

        if component_name:
            text_queries.insert(0, component_name)

        # if user_queries:
        #     text_queries.extend(user_queries)

        if component_images:
            image_queries.extend(component_images)

        k = min(k, len(embeddings))
        query_set = []

        with torch.no_grad():
            # Process text queries
            if text_queries:
                batch_text = self.processor.process_queries(text_queries).to(
                    self.model.device
                )
                text_embeddings = self.model(**batch_text)
                query_set.extend(list(torch.unbind(text_embeddings.to(self.device))))

            # Process image queries
            if image_queries:
                batch_img = self.processor.process_images(image_queries).to(
                    self.model.device
                )
                image_embeddings = self.model(**batch_img)
                query_set.extend(list(torch.unbind(image_embeddings.to(self.device))))
        
        scores = self.processor.score(query_set, embeddings, device=self.device)
        top_k_indices = scores[0].topk(k).indices.tolist()
        gallery = [(document_pages[i], f"Page {i}") for i in top_k_indices]
        return gallery
