# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0 

import sys
import json
import uvicorn
import threading
import subprocess  # nosec
import gradio as gr
from pathlib import Path
from typing import List, Tuple

from mcp_api import app
from ai_chatbot import get_response, setup_query_engine
from video_summarization import start_video_analytics, update_collection

gr.set_static_paths(paths=[Path.cwd().absolute()/"assets"])

with open("config.json") as json_file:
    USECASES = json.load(json_file)


def chatbot_response(message: str, history: List[List[str]]) -> str:
    try:
        if not message:
            return "Please enter a valid message."
    
        response = get_response(message)
        return str(response)
    
    except Exception as e:
        return f"An error occurred: {str(e)}"

def summarize_video(video_path: str) -> gr.List:
    try:
        data_from_db = start_video_analytics(video_path)
        
        if not data_from_db:
            print("No data retrieved from video analytics.")
            return create_summary_list(["No summary available."], visible=True)
        
        data_display = []
        data_length = len(data_from_db["ids"])
        
        if data_length == 0:
            print("No video segments found.")
            return create_summary_list(["No video segments found for analysis"], visible=True)
        
        for item in range(data_length):
            try:
                metadata = data_from_db["metadatas"][item]
                timestamp = metadata["timestamp"]
                doc = data_from_db["documents"][item]
                
                if doc:
                    data_display.append(f"At {timestamp}s, {doc}")
            
            except Exception as e:
                print(f"Error processing item {item}: {str(e)}")
                continue
            
        if not data_display:
            data_display = ["Video analysis completed but no content found."]
            
        print("Video summarization completed successfully.")
        return create_summary_list(data_display, visible=True)
    
    except Exception as e:
        print(f"An error occurred during video summarization: {str(e)}")
        return create_summary_list([f"An error occurred: {str(e)}"], visible=True)


def create_summary_list(data: List[str], visible: bool = False) -> gr.List:
    return gr.List(
        label="Video Summary",
        value=data,
        interactive=False,
        wrap=True,
        headers=['Summary'],
        visible=visible,
        max_height=350,
    )


def clear_summary() -> gr.List:
    print("Clearing video summary output from UI.")
    return create_summary_list([], visible=False)


def switch_usecase(usecase_key: str) -> Tuple[gr.HTML, gr.Markdown, gr.Video, gr.List]:
    try:
        if not usecase_key or usecase_key not in USECASES:
            raise ValueError("Invalid use case key provided.")
        
        info = USECASES[usecase_key]
        
        required_fields = ["collection_name", "system_prompt", "header", 
                          "description", "video_label", "video_path"]
        missing_fields = [field for field in required_fields if field not in info]
        if missing_fields:
            raise ValueError(f"Missing required fields in use case config: {missing_fields}")
        
        video_path = Path(info["video_path"])
        if not video_path.exists():
            print(f"Video file not found at path: {video_path}")
        
        try:
            update_collection(info["collection_name"], info["system_prompt"])
            setup_query_engine(info["collection_name"], info["video_path"])
            
        except Exception as e:
            print(f"Error updating collection/query engine: {e}")
        
        return (
            gr.HTML(
                f"""
                <h1>{info["header"]}</h1>
                <p>{info["description"]}</p>
                """
            ),
            gr.Markdown(f'<h1>{info["video_label"]}</h1>'),
            gr.Video(value=info["video_path"]),
            create_summary_list([], visible=True)
        )
    
    except Exception as e:
        print(f"Error switching usecase: {str(e)}")
        return (
            gr.HTML("<h1>Error</h1><p>Failed to load use case. Please try again.</p>"),
            gr.Markdown("<h1>Error</h1>"),
            gr.Video(value=None),
            create_summary_list(["Error loading use case"], visible=True)
        )


with gr.Blocks(
    title="Video Summarization",
    theme=gr.themes.Glass(
        text_size="md",
        spacing_size="md",
        font="ui-sans-serif",
        font_mono="ui-sans-serif"
    ),
    css_paths=["custom.css"],
) as demo:
    
    with gr.Row(elem_classes="radiobutton"):
        gr.HTML("<p>Usecase:</p>")
        usecase_dropdown = gr.Radio(
            label="Select a Usecase",
            choices=list(USECASES.keys()),
            value=list(USECASES.keys())[0],
            interactive=True,
            container=False,
            scale=4
        )
        update_collection(USECASES[usecase_dropdown.value]["collection_name"], USECASES[usecase_dropdown.value]["system_prompt"])
        setup_query_engine(USECASES[usecase_dropdown.value]["collection_name"], USECASES[usecase_dropdown.value]["video_path"])

    with gr.Row(elem_classes="main-header"):
        title = gr.HTML(
            f"""
            <h1>{USECASES[usecase_dropdown.value]["header"]}</h1>
            <p>{USECASES[usecase_dropdown.value]["description"]}</p>
            """
        )

    with gr.Row(equal_height=True):
        # Video Player
        with gr.Column(scale=1, elem_classes="component-card"):
            video_markdown = gr.Markdown(f'<h1>{USECASES[usecase_dropdown.value]["video_label"]}</h1>')
            video = gr.Video(
                value=USECASES[usecase_dropdown.value]["video_path"],
                loop=True,
                autoplay=True,
                show_download_button=False,
                container=False,
                interactive=False,
            )
            with gr.Row():
                summarize_button = gr.Button(
                    value="Summarize Video", 
                    interactive=True, 
                    visible=True, 
                    variant="huggingface"
                )
                clear_button = gr.Button(
                    value="Clear", 
                    interactive=True, 
                    visible=True, 
                    variant="stop",
                )
            
        # Video Summary
        with gr.Column(scale=1, elem_classes="component-card", visible=True):
            gr.Markdown('<h1>Video Summary</h1>')
            summary_output = create_summary_list([], visible=True)
            summarize_button.click(
                fn=summarize_video,
                inputs=video,
                outputs=summary_output,
                show_progress="full",
            )
            clear_button.click(
                fn=clear_summary,
                inputs=None,
                outputs=summary_output,
                show_progress="minimal",
            )

        # Chatbot
        with gr.Column(scale=1, elem_classes="component-card", visible=True):
            gr.Markdown('<h1>AI Chatbot</h1>')
            chatinterface = gr.ChatInterface(
                fn=chatbot_response,
                chatbot=gr.Chatbot(
                    container=False, 
                    height=330, 
                    elem_classes="chat-interface",
                ),
                textbox=gr.Textbox(
                    placeholder="Type text here...", 
                    container=False, 
                    submit_btn=True, 
                    elem_classes="textbox-interface", 
                    autofocus=True, 
                    autoscroll=False,
                ),
                cache_examples=False,
            )
            
    usecase_dropdown.change(
        fn=switch_usecase,
        inputs=[usecase_dropdown],
        outputs=[title, video_markdown, video, summary_output],
        show_progress="minimal"
    )
    
    
def start_fastapi_server() -> None:
    try:
        print("Starting FastAPI server on host 127.0.0.1 and port 5777.")
        uvicorn.run(
            app, 
            host="127.0.0.1", 
            port=5777, 
            log_level="info"
        )
    except Exception as e:
        print(f"Error starting FastAPI server: {e}")
        raise


def start_llamacpp_server() -> None:
    if sys.platform == "win32":
        llamacpp_binary_path = r".\llama-b7223-bin-win-vulkan-x64\llama-server.exe"
        if not Path(llamacpp_binary_path).exists():
            print(f"Llama.cpp binary not found at path: {llamacpp_binary_path}")
            return
        
        subprocess.Popen([
            llamacpp_binary_path,
            "-hf", "unsloth/Qwen3-4B-GGUF:Q4_K_M",
            "-ngl", "99",
            "--reasoning-budget", "0",
            "--host", "127.0.0.1",
            "--port", "5778",
            "--jinja"
        ])
        subprocess.Popen([
            llamacpp_binary_path,
            "-hf", "unsloth/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M",
            "-ngl", "99",
            "--reasoning-budget", "0",
            "--host", "127.0.0.1",
            "--port", "5776",
            "--jinja"
        ])
    elif sys.platform == "linux":
        llamacpp_binary_path = r"./llama-b7223-bin-ubuntu-vulkan-x64/build/bin/llama-server"
        if not Path(llamacpp_binary_path).exists():
            print(f"Llama.cpp binary not found at path: {llamacpp_binary_path}")
            return
            
        subprocess.Popen([
            llamacpp_binary_path,
            "-hf", "unsloth/Qwen3-4B-GGUF:Q4_K_M",
            "-ngl", "99",
            "--reasoning-budget", "0",
            "--host", "127.0.0.1",
            "--port", "5778",
            "--jinja",
        ])
        subprocess.Popen([
            llamacpp_binary_path,
            "-hf", "unsloth/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M",
            "-ngl", "99",
            "--reasoning-budget", "0",
            "--host", "127.0.0.1",
            "--port", "5776",
            "--jinja",
        ])
    else:
        print("Unsupported platform.")
        sys.exit(1)

if __name__ == "__main__":
    try:
        print("Launching application...")
        
        # Start FastAPI server
        fastapi_thread = threading.Thread(target=start_fastapi_server, daemon=True)
        fastapi_thread.start()

        # Start Llama.cpp server
        llamacpp_thread = threading.Thread(target=start_llamacpp_server, daemon=True)
        llamacpp_thread.start()

        # Launch Gradio app
        demo.launch(server_name='127.0.0.1', server_port=5999)
        
    except KeyboardInterrupt:
        print("Application interrupted by user. Exiting...")
    except Exception as e:
        print(f"An error occurred: {str(e)}")
        sys.exit(1)
