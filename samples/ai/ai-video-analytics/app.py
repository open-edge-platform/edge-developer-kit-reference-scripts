# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import shutil
import pandas as pd
import gradio as gr
import magic

from utils.chroma import chromaClient
from utils.model import ImageCaptionPipeline, FaceDataPipeline
from utils.common import VideoProcessor
DEVICE = os.getenv("DEVICE", "CPU")
image_caption_pipeline = ImageCaptionPipeline(device=DEVICE)
face_data_pipeline = FaceDataPipeline()
VIDEO_FOLDER = "./data/video"
os.makedirs(VIDEO_FOLDER, exist_ok=True)
semantic_search_client = chromaClient("video_llm")
face_search_client = chromaClient("face_llm")

def is_valid_video_file(file_path):
    """
    Check if the file is a valid video file based on its MIME type.
    """
    mime = magic.from_file(file_path, mime=True)
    return mime.startswith('video/')

def upload_and_process_video_file(files, progress=gr.Progress()):
    if not os.path.exists(VIDEO_FOLDER):
        os.makedirs(VIDEO_FOLDER, exist_ok=True)

    file_paths = []
    for file in progress.tqdm(files, desc="Uploading and processing video files"):
        try:
            shutil.copy(file, VIDEO_FOLDER)
            video_path = os.path.join(VIDEO_FOLDER, file.name.split("/")[-1])
            if is_valid_video_file(video_path) is False:
                gr.Warning(f"{video_path} is not a supported video file.", duration=3)
                continue
            frame_data = VideoProcessor.extract_video_frames(video_path)
            query = "A picture of"
            result_data = image_caption_pipeline.inference(frame_data, query)
            for data in result_data:
                semantic_search_client.add_data(data)

            face_result_data = face_data_pipeline.inference(frame_data)
            for face_data in face_result_data:
                face_search_client.add_face_data(face_data)

            file_paths.append(video_path)
        except Exception as e:
            gr.Warning(f"Failed to process {file.name}: {str(e)}", duration=3)
            continue

    return file_paths

def face_infer_on_frame(top_k: int, distance: float,image_path,progress=gr.Progress()):

    frame_data = VideoProcessor.extract_video_frames(image_path)
    result_data = face_data_pipeline.inference(frame_data)
    if len(result_data) ==0:
        gr.Warning(
            f'No related image found in the database', duration=3)
        return
    for data in result_data:
        face_landmarks = data["face_landmarks"]
        result_df = query_face_database_results(face_landmarks,top_k,distance)
    return result_df

def refresh_video_list():
    try:
        files = os.listdir(VIDEO_FOLDER)
        print(files)
        return gr.Dropdown(choices=files, interactive=True)
    except FileNotFoundError:
        return []


def get_video_available(selected_video: str):
    return os.path.join(VIDEO_FOLDER, selected_video)


def query_database_results(query: str, top_k: int, threshold: float):
    data = []
    results = semantic_search_client.query_data(query, top_k, threshold)
    if len(results) == 0:
        gr.Warning(
            f'No related query: {query} found in the database', duration=3)
        return

    print("Retrieval results:", results)

    for doc in results:
        metadata = doc.metadata
        data.append({
            'timestamp': metadata['timestamp'],
            'video_path': metadata['video_path'],
            'captions': doc.page_content
        })

    # Creating a DataFrame
    df = pd.DataFrame(data)
    return df

def query_face_database_results(query,top_k: int, distance: float):
    data = []

    results = face_search_client.query_face_data(query, top_k, distance)

    if len(results) == 0:
        gr.Warning(
            f'No related face found in the database', duration=3)
        return

    print("Retrieval results:", results)

    for result in results:
        data.append({
            'timestamp': result[0]['timestamp'],
            'video_path': result[0]['video_path'],
            'distance': result[1]
        })

    # Creating a DataFrame
    df = pd.DataFrame(data)
    return df

def show_video_frame(df: pd.DataFrame, evt: gr.SelectData):
    if evt.row_value[1] == "":
        return None 
    
    video_path = evt.row_value[1]
    video_timestamp = evt.row_value[0]

    # # Get the top results for now
    retrieved_video = VideoProcessor.retrieve_with_video_timestamp(
        video_path,
        video_timestamp
    )
    if retrieved_video:
        return retrieved_video
    else:
        return None


def clear_collection():
    isClear = semantic_search_client.reset_database()
    FaceisClear = face_search_client.reset_database()
    if not isClear or not FaceisClear:
        gr.Warning('No data in the vector and video database', duration=3)
    else:
        if os.path.exists(VIDEO_FOLDER):
            shutil.rmtree(VIDEO_FOLDER)
        gr.Info("Successfully clear the vector and video database", duration=3)


with gr.Blocks() as demo:
    gr.Markdown("AI Video Analytics")
    with gr.Tab("Database Preparation"):
        with gr.Row():
            with gr.Column():
                gr.Markdown("Upload video")
                file_output = gr.File()
                upload_button = gr.UploadButton("Upload video files", file_types=[
                                                "video"], file_count="multiple")
                upload_button.upload(
                    upload_and_process_video_file, upload_button, file_output)
            with gr.Column():
                gr.Markdown("Video vault")
                video_player = gr.Video(label="Video")
                refresh_button = gr.Button(value="Refresh Video List")
                video_dropdown = gr.Dropdown(
                    choices=os.listdir(VIDEO_FOLDER),
                    label="Video lists", 
                    info="Select the video to view",
                    allow_custom_value=True
                )
                refresh_button.click(
                    fn=refresh_video_list,
                    outputs=video_dropdown
                )
                video_dropdown.input(
                    get_video_available,
                    inputs=video_dropdown,
                    outputs=video_player
                )

    with gr.Tab("Semantic search"):
        with gr.Row():
            with gr.Column():
                gr.Markdown(
                    "Click on the data to visualize the retrieve video")
                result_df = gr.Dataframe(headers=[
                                            'timestamp', 'video_path', 'captions'], interactive=False, label="Retrieval Results")
                retrieval_video_file = gr.Video(
                    label="Retrieval Video")
            with gr.Column():
                user_query = gr.Textbox(label="User Question")
                top_k = gr.Slider(
                    1, 20, value=1, step=1, label="Number of search results")
                threshold = gr.Slider(
                    0.01, 1.0, value=0.5, step=0.01, label="Confidence threshold")
                output_btn = gr.Button("Search database")
            output_btn.click(
                fn=query_database_results,
                inputs=[
                    user_query,
                    top_k,
                    threshold
                ],
                outputs=[
                    result_df,
                ]
            )
            result_df.select(
                show_video_frame,
                inputs=result_df,
                outputs=retrieval_video_file
            )
    with gr.Tab("Face identification"):
        with gr.Row():
            with gr.Column():
                gr.Markdown(
                    "Click on the data to visualize the retrieve video")
                face_result_df = gr.Dataframe(headers=[
                                            'timestamp', 'video_path', 'distances'], interactive=False, label="Retrieval Results")
                retrieval_face_video_file = gr.Video(
                    label="Retrieval Video")
            with gr.Column():
                top_k = gr.Slider(
                    1, 20, value=1, step=1, label="Number of search results")
                distance = gr.Slider(
                    0.000001, 1.0, value=0.000001, step=0.0001, label="Distances")
                gr.Markdown("Face identification")
                face_btn = gr.Button("Face Infer")
                input_image = gr.Image(type="filepath")
                
            face_btn.click(
                fn=face_infer_on_frame,
                inputs=[
                    top_k,
                    distance,
                    input_image],
                outputs=[
                    face_result_df,
                ]
            )
            face_result_df.select(
                show_video_frame,
                inputs=face_result_df,
                outputs=retrieval_face_video_file
            )
    with gr.Tab("Settings"):
        with gr.Row():
            clear_database_btn = gr.Button("Clear database")
            clear_database_btn.click(
                fn=clear_collection,
            )

demo.launch(server_name="localhost", server_port=5980)
