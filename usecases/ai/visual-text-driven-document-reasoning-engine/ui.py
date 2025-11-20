# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

import json
import shutil
from pathlib import Path

import gradio as gr
import imagehash
from PIL import Image

from config import (
    APP_TITLE,
    DOCUMENT_MODEL,
    NO_HISTORY_ITEMS,
    OPENVINO_DEVICE,
    PYTORCH_DEVICE,
    VLM_MODEL,
)

from document_retrieval_engine import DocumentRetrievalEngine
from visual_understanding_agent import VisualUnderstandingAgent

dir_ = Path(__file__).resolve().parent

document_retrieval_engine = DocumentRetrievalEngine(
    DOCUMENT_MODEL, device=PYTORCH_DEVICE
)
visual_understanding_agent = VisualUnderstandingAgent(
    VLM_MODEL,
    precision="fp16",
    device=OPENVINO_DEVICE,
)

HISTORY_FILE = dir_ / "history" / "history.json"
IMAGE_DIR = dir_ / "history" / "images"
IMAGE_DIR.mkdir(parents=True, exist_ok=True)


def image_hash(img_path):
    # Compute perceptual hash from image file path
    return str(imagehash.phash(Image.open(img_path)))


def load_history():
    if HISTORY_FILE.exists():
        with open(HISTORY_FILE, "r") as f:
            data = json.load(f)
    else:
        # Default test item
        default_data = [["This is a test example", str(dir_ / "assets" / "sample.jpg")]]

        with open(HISTORY_FILE, "w") as f:
            json.dump(default_data, f, indent=2)

        return default_data

    # Filter out items whose files don't exist
    cleaned_data = []
    valid_filepaths = set()

    for item in data:
        if len(item) != 2:
            continue  # Skip malformed items
        query, filepath = item
        file_path = Path(filepath)
        if file_path.exists():
            cleaned_data.append([query, filepath])
            valid_filepaths.add(file_path.resolve())
        # else: silently skip items with missing files

    # Now clean up IMAGE_DIR: remove orphan image files
    if IMAGE_DIR.exists():
        for file in IMAGE_DIR.iterdir():
            if file.is_file() and file.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
                if file.resolve() not in valid_filepaths:
                    try:
                        file.unlink()
                    except Exception:
                        pass  # Optionally log
    
    with open(HISTORY_FILE, "w") as f:
        json.dump(cleaned_data, f, indent=2)


    return cleaned_data


history_list = load_history()


def update_history(query: str, image_path: str):
    with open(HISTORY_FILE, "r") as f:
        history_list = json.load(f)

    history_list[:] = [
        item for item in history_list if item[0] != "This is a test example"
    ]

    # Create a copy of the new image in the history
    ext = Path(image_path).suffix.lstrip(".").lower()
    latest_image_path = str(IMAGE_DIR / f"0.{ext}")
    shutil.copy(image_path, latest_image_path)

    new_history_list = []
    new_history_list.insert(0, [query, latest_image_path])

    new_hash = image_hash(latest_image_path)

    old_history_list = history_list[:]

    filtered_history = []
    for item in old_history_list:
        file_path = Path(item[1])
        if item[0] == query and image_hash(item[1]) == new_hash:
            Path(item[1]).unlink(missing_ok=True)
            print(f"deleting: {item[1]}")
            pass
        else:
            if file_path.exists():
                filtered_history.append(item)

    old_history_list = filtered_history

    new_history_list.extend(old_history_list)

    final_history_list = []
    temp_paths = []
    for idx, item in enumerate(new_history_list):
        query, img_path = item
        ext = Path(img_path).suffix.lstrip(".").lower()
        temp_path = str(IMAGE_DIR / f"temp_{idx}.{ext}")
        shutil.move(img_path, temp_path)
        temp_paths.append((query, temp_path))

    # Step 2: Rename temp files to final names
    final_history_list = []
    for idx, (query, temp_path) in enumerate(temp_paths):
        ext = Path(temp_path).suffix.lstrip(".").lower()
        final_path = str(IMAGE_DIR / f"{idx+1}.{ext}")
        shutil.move(temp_path, final_path)
        final_history_list.append([query, final_path])


    # Return the updated dataset
    with open(HISTORY_FILE, "w") as f:
        json.dump(final_history_list, f, indent=2)

    history_list = final_history_list

    return gr.Dataset(samples=history_list[:NO_HISTORY_ITEMS])


def generate_gallery(
    embeddings,
    pages,
    k,
    user_query=None,
    component_image=None,
    component_name=None,
):
    args = {
        "embeddings": embeddings,
        "document_pages": pages,
        "k": k,
    }

    if user_query:
        args["user_queries"] = [user_query]
    if component_image:
        # If component_image is a string (path), convert to PIL Image
        if isinstance(component_image, str):
            from PIL import Image

            args["component_images"] = [Image.open(component_image)]
        else:
            args["component_images"] = [component_image]
    if component_name:
        args["component_name"] = component_name

    if len(args) == 3:  # only the fixed args, no checkbox data
        raise ValueError(
            "At least one of the following must be selected: User Query, Component Image, or Component Name."
        )

    gallery = document_retrieval_engine.search_and_retrieve(**args)

    return gallery


def build():
    with gr.Blocks(title=APP_TITLE, theme=gr.themes.Ocean()) as demo:
        gr.Markdown(f"# {APP_TITLE}")

        with gr.Row():
            with gr.Column(scale=2):
                gr.Markdown("### 1️⃣  Upload PDFs")
                with gr.Row():
                    with gr.Column(scale=1):
                        pdfs = gr.File(
                            file_types=[".pdf"],
                            file_count="multiple",
                            label="PDF documents",
                            height=140,
                        )
                    with gr.Column(scale=3):
                        embeddings_path = gr.Textbox(
                            label="Custom Embeddings Path (if any)",
                            placeholder=(
                                "Path to load or save embeddings. If not set, a unique filename based on the PDF name will be used in the default location."
                            ),
                            visible=False,
                        )
                        index_status = gr.Textbox(label="Status")
                        index_button = gr.Button("Index PDFs", size="md")

                embeddings = gr.State(value=[])
                page_images = gr.State(value=[])

                gr.Markdown("### 2️⃣  Upload Component Image & Query")
                with gr.Row():
                    with gr.Column(scale=2):
                        component_image = gr.Image(
                            type="filepath",
                            label="Component Image",
                            height=220,
                        )
                        component_description = gr.Textbox(
                            label="Component Description (if any)",
                            placeholder="Optional description of component to refine searching.",
                            visible=False,
                        )
                        component_name = gr.Textbox(label="Component", visible=False)
                    with gr.Column(scale=3):
                        query = gr.Textbox(
                            label="Query", placeholder="Enter your query here..."
                        )
                        k = gr.Slider(
                            minimum=1,
                            maximum=10,
                            step=1,
                            label="Number of results",
                            value=3,
                        )
                        answer_button = gr.Button("Answer", variant="primary")

                history = gr.Examples(
                    history_list,
                    [query, component_image],
                    label="History",
                    examples_per_page=5,
                )

            with gr.Column(scale=3):
                gallery = gr.Gallery(label="Retrieved pages", height=500)
                answer = gr.Textbox(label="Agentic response", lines=16)

        index_button.click(
            document_retrieval_engine.build_index,
            inputs=[pdfs, embeddings_path],
            outputs=[index_status, embeddings, page_images],
        )
        answer_button.click(
            lambda img, desc: (
                visual_understanding_agent.identify_component(img, desc) if img else ""
            ),
            inputs=[component_image, component_description],
            outputs=[component_name],
        ).then(
            generate_gallery,
            inputs=[
                embeddings,
                page_images,
                k,
                query,
                component_image,
                component_name,
            ],
            outputs=[gallery],
        ).then(
            update_history,
            inputs=[query, component_image],
            outputs=history.dataset,
        ).then(
            visual_understanding_agent.generate_response,
            inputs=[query, gallery],
            outputs=[answer],
        )

    return demo
