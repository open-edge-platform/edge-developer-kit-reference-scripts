<!-- Copyright (C) 2025 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

## Embedding Worker

This worker provides an embedding service using Hugging Face models with Intel OpenVINO acceleration through OpenVINO Model Server (OVMS). It supports both embedding generation and reranking capabilities, includes a vector database (FAISS) for document storage and retrieval, and supports RAG (Retrieval-Augmented Generation) workflows.

### Setup

To set up the Embedding worker, you need to download third-party packages (such as OpenVINO Model Server) and install all required dependencies.

**For Ubuntu/Linux:**
```bash
./setup.sh
```

This will ensure all necessary components are installed before you run the worker, including:
- Python 3.11 virtual environment with all dependencies
- OpenVINO Model Server (OVMS) for Ubuntu 22/24
- Required ML libraries (OpenVINO, PyTorch, FastAPI, FAISS, etc.)

### Usage

Before starting the Embedding worker, activate the Python virtual environment:

To start the Embedding worker, run:

**For Ubuntu/Linux:**
```bash
./start.sh --embedding-model-id OpenVINO/bge-base-en-v1.5-int8-ov --reranker-model-id OpenVINO/bge-reranker-base-int8-ov
```

**For Windows:**
```powershell
.\start.ps1 -embeddingModelId "OpenVINO/bge-base-en-v1.5-int8-ov" -rerankerModelId "OpenVINO/bge-reranker-base-int8-ov"
```

**With all available options:**

**For Ubuntu/Linux:**
```bash
./start.sh \
  --embedding-model-id OpenVINO/bge-base-en-v1.5-int8-ov \
  --embedding-device CPU \
  --reranker-model-id OpenVINO/bge-reranker-base-int8-ov \
  --reranker-device CPU \
  --port 5003 \
  --ovms-port 5951
```

**For Windows:**
```powershell
.\start.ps1 `
  -embeddingModelId "OpenVINO/bge-base-en-v1.5-int8-ov" `
  -embeddingDevice "CPU" `
  -rerankerModelId "OpenVINO/bge-reranker-base-int8-ov" `
  -rerankerDevice "CPU" `
  -port 5003 `
  -ovmsPort 5951
```

**Options:**

- `embedding-model-id`: (Required) Hugging Face model ID or path for embedding model (e.g., `OpenVINO/bge-base-en-v1.5-int8-ov`)
- `embedding-device`: Device to run the embedding model on - CPU, GPU, NPU, or HETERO (default: CPU)
- `reranker-model-id`: (Required) Hugging Face model ID or path for reranker model (e.g., `OpenVINO/bge-reranker-base-int8-ov`)
- `reranker-device`: Device to run the reranker model on - CPU, GPU, NPU, or HETERO (default: CPU)
- `port`: Port for the FastAPI server (default: 5003)
- `ovms-port`: Port for the OpenVINO Model Server (default: 5951)

### What Happens

1. Downloads the specified embedding and reranker models from Hugging Face Hub if not present
2. Converts both models to OpenVINO format with int8 quantization for optimal performance
3. Starts the OpenVINO Model Server (OVMS) in the background with both models
4. Waits for both embedding and reranker models to be ready and healthy (concurrent health checks)
5. Logs the OVMS process ID for manual management if needed
6. Initializes database and knowledge base services
7. Starts the FastAPI server with embedding, reranking, and document management endpoints

### API Endpoints

The worker provides several REST API endpoints:

**Embedding Generation:**
- `POST /v1/embeddings` - Generate embeddings for text input (OpenAI-compatible)

**Reranking:**
- `POST /v1/rerank` - Rerank documents based on query relevance (Cohere-compatible)

**Knowledge Base Management:**
- `GET /v1/kb` - List all knowledge bases
- `POST /v1/kb` - Create a new knowledge base
- `GET /v1/kb/{id}` - Get a knowledge base
- `DELETE /v1/kb/{id}` - Delete a knowledge base
- `GET /v1/kb/{id}/files` - List all files
- `DELETE /v1/kb/{id}/files` - Delete a file
- `POST /v1/kb/{id}/files` - Upload files to a knowledge base
- `POST /v1/kb/{id}/create` - Create knowledge base embeddings
- `POST /v1/kb/{id}/search` - Search within a knowledge base using RAG

**Health Check:**
- `GET /healthcheck` - Service health status

### Supported Models

The worker supports both embedding and reranking models from Hugging Face.

**Embedding Models:**
Any Hugging Face embedding model compatible with the `sentence-transformers` library:
- `OpenVINO/bge-base-en-v1.5-int8-ov` (recommended for English, pre-optimized)
- `BAAI/bge-small-en-v1.5` (smaller, faster)
- `BAAI/bge-base-en-v1.5` (balanced performance)

**Reranker Models:**
Models designed for reranking tasks:
- `OpenVINO/bge-reranker-base-int8-ov` (recommended, pre-optimized)
- `BAAI/bge-reranker-base`
- `BAAI/bge-reranker-large`

**Note:** OpenVINO-optimized models (with `-int8-ov` suffix) are pre-converted and quantized for better performance on Intel hardware.

### Document Processing

The worker supports document upload and processing for RAG workflows:

- **Supported formats**: PDF, Plain text (.txt), CSV, DOC/DOCX, HTML, Markdown, ODT, PPT/PPTX, EPUB, EverNote
- **Chunking**: Configurable chunk size and overlap for optimal retrieval (default: 1000 chunks, 200 overlap)
- **Vector storage**: Documents are automatically embedded and stored using FAISS vector database
- **Reranking**: Uses contextual compression with Cohere reranker for improved search relevance

### Notes

- For GPU support, ensure Intel GPU drivers are installed
- Model cache is stored in `./models/` directory (project-local)
- Knowledge base data and FAISS indices are stored in `./data/` directory