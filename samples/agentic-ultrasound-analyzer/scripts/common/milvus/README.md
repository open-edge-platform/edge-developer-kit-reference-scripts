# Simple Retrieval for Ultrasound Captures

This script enables similarity and metadata-based search over a Milvus collection containing ultrasound images, VLM-generated analysis reports, all embedded with BLIP.

## Prerequisites

- Python 3.8+
- Milvus server running and accessible
- Collection created with BLIP 256-dim embeddings
- Required Python packages installed (`pymilvus`, `numpy`, etc.)

## Usage

### 1. Set up your environment

- Ensure Milvus is running and your collection is populated.
- Optionally set environment variables (defaults are provided):

```bash
export EMBEDDING_MODEL=Salesforce/blip-itm-base-coco
export TXT_EMBEDDING_DEVICE=GPU
export IMG_EMBEDDING_DEVICE=GPU
```

### 2. Run the script

Note: Please set PYTHONPATH as needed to the root directory of the code

```bash
python simple_retrieval.py [options]
```

#### Common options

- `--query_text "your question"` : Search using a text query (e.g., "normal ultrasound").
- `--query_img path/to/image.png` : Search using an image file.
- `--retrieve_top_k N` : Number of top results to return (default: 3).
- `--filter_expression "your Milvus filter"` : Advanced filtering (e.g., `"metadata['mode'] == 'image' for searching through images`).
- `--min_score 0.7` : Minimum similarity score for results (default: 0.7).
- `--milvus_uri HOST` : Milvus host (default: localhost).
- `--milvus_port PORT` : Milvus port (default: 19530).
- `--milvus_dbname NAME` : Milvus database name (default: default).
- `--collection_name NAME` : Milvus collection name (default: ultrasound_captures).

#### Examples

- Text search across all modes:
  ```bash
  python simple_retrieval.py --query_text "normal ultrasound"
  ```

- Image search in image mode only:
  ```bash
  python simple_retrieval.py --query_img captures/frame_001.png
  ```

- Text search restricted to a specific video:
  ```bash
  python simple_retrieval.py --query_text "normal ultrasound" --filter_expression 'metadata["video_id"] == "vid_001"'
  ```

- Metadata-only query - simple query in DB (no embedding):
  ```bash
  python simple_retrieval.py --filter_expression 'metadata["mode"] == "analysis" and metadata["video_id"] == "vid_001"'
  ```

## Output

The script prints the top results with similarity scores, source mode, and metadata for each match.