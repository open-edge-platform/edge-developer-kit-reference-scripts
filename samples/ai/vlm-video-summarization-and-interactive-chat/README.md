# AI Video Summarization & Interactive Chat

This application provides AI-powered video summarization to generate concise summaries of key events and enables real-time interaction and queries via a chatbot interface.

![demo](./docs/demo.gif)

## Features

- **AI Video Summarization:** Automatically extract and summarize key events from video streams using OpenCV for frame analysis and Vision-Language Models (VLM) for semantic understanding. Supports generating concise textual summaries and highlights for efficient review.

- **AI Chatbot:** Engage in real-time conversations, ask questions about video content, and receive instant insights through an interactive Gradio interface.

- **Embedding Storage with ChromaDB:** Store and manage vector embeddings efficiently using ChromaDB, enabling fast semantic search and retrieval for downstream analytics and querying.

## Requirements

### Validated Hardware
- CPU: 13th Gen Intel(R) Core(TM) i9-13900K
- GPU: Intel® Arc™ Pro B-Series Graphics
- RAM: 32GB
- Disk: 256GB

### Application Ports
| Service                          | Port  | Use                                   |
|----------------------------------|-------|---------------------------------------|
| Main Application                 | 5999  | Gradio web interface                  |
| Qwen2.5-VL-7B-Instruct           | 5776  | Vision-Language Model server          |
| Qwen3-8B                         | 5778  | Text generation model server          |
| Fastapi                          | 5777  | API backend service and MCP server    |

## Prerequisites
Before proceeding with the installation, ensure the following system requirements are met:

- A compatible operating system (Ubuntu 24.04 or Windows 11) must be installed and running.
- Intel GPU driver must be installed and properly configured on the system.

## Quick Start

### Windows
Run the provided PowerShell script to start the servers and application:
```powershell
.\run_app.ps1
```

Alternatively, you can use the batch script:
```batch
.\run_app.bat
```

Once running, open [http://localhost:5999](http://localhost:5999) in your browser.

### Linux

Before installing Python dependencies, ensure you have Python, curl, and FFmpeg installed:

```bash
sudo apt update
sudo apt install python3 curl ffmpeg
```

Run the provided bash script to start the servers and application:
```bash
./run_app.sh
```

Once running, open [http://localhost:5999](http://localhost:5999) in your browser.

## Manual Setup Instructions

Choose the appropriate setup method for your operating system:

### Windows Setup

#### 1. Set Up Python Environment with uv

Make sure you have Python 3.8 and higher installed. Then install `uv`, create a virtual environment, and install the required Python packages.

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
uv venv
.\.venv\Scripts\activate
uv pip install -r requirements.txt
```

#### 2. Use Pre-compiled Llama.cpp Binaries

Download the pre-compiled Windows binaries for llama.cpp with Vulkan or SYCL support from the [llama.cpp b7223 release page](https://github.com/ggml-org/llama.cpp/releases/tag/b7223). Place the extracted `llama-b7223-bin-win-vulkan-x64.zip` folder in your project directory.

#### 3. Start Llama Servers

Start the Qwen3-8B server (port 5778) as required. The Qwen2.5-VL server (port 5776) is optional if you have previously run it and already have the database.

**Qwen3-8B (port 5778):**

```powershell
.\llama-b7223-bin-win-vulkan-x64\llama-server.exe -hf unsloth/Qwen3-8B-GGUF:Q4_K_M -ngl 99 --reasoning-budget 0 --host 0.0.0.0 --port 5778 --jinja
```

**Qwen2.5-VL-7B-Instruct (port 5776, optional):**

```powershell
.\llama-b7223-bin-win-vulkan-x64\llama-server.exe -hf unsloth/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M -ngl 99 --reasoning-budget 0 --host 0.0.0.0 --port 5776 --jinja
```

#### 4. Run the Gradio Application

```powershell
uv run app.py
```

### Linux Setup

#### 1. Set Up Python Environment with uv

Make sure you have Python 3.8 and higher installed. Then install `uv`, create a virtual environment, and install the required Python packages.

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

#### 2. Prepare llama.cpp 

You can either **compile llama.cpp with SYCL backend** or **use the precompiled Vulkan binary**:

**Option A: Compile llama.cpp with SYCL backend**

Follow [SYCL backend instructions](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md):

1. Install oneAPI Base Toolkit ([download link](https://www.intel.com/content/www/us/en/developer/tools/oneapi/base-toolkit-download.html?packages=dl-essentials&dl-essentials-os=linux&dl-lin=apt)):

    ```bash
    sudo apt update
    sudo apt install -y gpg-agent wget
    wget -O- https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB \
      | gpg --dearmor | sudo tee /usr/share/keyrings/oneapi-archive-keyring.gpg > /dev/null
    echo "deb [signed-by=/usr/share/keyrings/oneapi-archive-keyring.gpg] https://apt.repos.intel.com/oneapi all main" | sudo tee /etc/apt/sources.list.d/oneAPI.list
    sudo apt update
    sudo apt install intel-deep-learning-essentials
    ```

2. Set up environment:

    ```bash
    source /opt/intel/oneapi/<oneapi-version>/oneapi-vars.sh
    ```

    > **Note:** To verify SYCL installation, run:
    > ```bash
    > sycl-ls
    > ```

3. Build llama.cpp:

    ```bash
    git clone https://github.com/ggml-org/llama.cpp
    cd llama.cpp
    sed -i 's/-DLLAMA_CURL=OFF/-DLLAMA_CURL=ON/g' ./examples/sycl/build.sh
    sudo apt install curl libcurl4-openssl-dev cmake build-essential
    ./examples/sycl/build.sh
    ```

**Option B: Use Precompiled Vulkan Binary**

Download the precompiled Vulkan binary for Linux from the [llama.cpp b7223 release page](https://github.com/ggml-org/llama.cpp/releases/tag/b7223). Extract and place the binary in your project directory for use with Vulkan.

#### 3. Start Llama Servers

Start the Qwen3-8B server (port 5778) as required. The Qwen2.5-VL server (port 5777) is optional if you have previously run it and already have the database.

**Qwen3-8B (port 5778):**

```bash
ONEAPI_DEVICE_SELECTOR=level_zero:0 ./llama-b7223-bin-ubuntu-vulkan-x64/build/bin/llama-server -hf unsloth/Qwen3-8B-GGUF:Q4_K_M -ngl 99 --reasoning-budget 0 --host 0.0.0.0 --port 5778 --jinja
```

**Qwen2.5-VL-7B-Instruct (port 5776, optional):**

```bash
ONEAPI_DEVICE_SELECTOR=level_zero:0 ./llama-b7223-bin-ubuntu-vulkan-x64/build/bin/llama-server -hf unsloth/Qwen2.5-VL-7B-Instruct-GGUF:Q4_K_M -ngl 99 --reasoning-budget 0 --host 0.0.0.0 --port 5776 --jinja
```

#### 4. Run the Gradio Application

Once dependencies and the server are ready, run the script:

```bash
uv run app.py
```

Once started, open http://localhost:5999 in your browser.

## FAQ

### How do I change the video file, collection name, or system prompt?

The application comes with pre-configured scenarios (Traffic, Retail, Manufacturing), but you can customize them by modifying the `config.json` file. Each scenario contains the following configurable parameters:

#### Customizing Video Files and Settings

To change the video file, collection name, or system prompt for any scenario:

1. **Open the `config.json` file** in your project directory
2. **Locate the scenario** you want to modify (e.g., "Traffic", "Retail", "Manufacturing")
3. **Update the following fields** as needed:

```json
{
    "YourScenario": {
        "video_path": "path/to/your/video.mp4",
        "video_label": "Your Custom Video Label",
        "collection_name": "your_collection_name",
        "header": "Your Custom Header Title",
        "description": "Your custom description for the scenario",
        "system_prompt": "Your custom system prompt that defines the AI assistant's behavior and analysis focus."
    }
}
```

#### Parameter Descriptions:
- **`video_path`**: Path to your video file (relative to the project directory)
- **`video_label`**: Display name for the video in the interface
- **`collection_name`**: Name for the ChromaDB collection (used for storing embeddings)
- **`header`**: Title displayed at the top of the web interface
- **`description`**: Description text shown in the interface
- **`system_prompt`**: Instructions that define how the AI assistant should analyze and respond to video content

#### Example: Adding a Custom Scenario

```json
{
    "Security": {
        "video_path": "assets/security-footage.mp4",
        "video_label": "Security Monitoring",
        "collection_name": "security",
        "header": "Smart Security Intelligence: AI Video Summarization + Interactive Chat",
        "description": "Intelligent security monitoring system for detecting and analyzing suspicious activities.",
        "system_prompt": "You are a security monitoring assistant. Analyze the video for any suspicious activities, unauthorized access, or security incidents. Provide detailed descriptions of people, their actions, and any potential security concerns."
    }
}
```

4. **Save the file** and restart the application for changes to take effect
5. **Place your video file** in the specified path (typically in the `assets/` folder)

### How do I change the AI models used in the application?

The application uses three different AI models for various tasks:

#### Current Models:
- **Qwen3-8B** (Port 5778): Text generation and chatbot responses
- **Qwen2.5-VL-7B-Instruct** (Port 5776): Vision-language model for video frame analysis
- **BAAI/bge-small-en-v1.5**: Embedding model for vector storage (used in both `video_summarization.py` and `ai_chatbot.py`)
- **BAAI/bge-reranker-base**: Reranker model for improving search results (used in `ai_chatbot.py`)

#### Changing the LLM or VLM:

1. **Modify the model in app.py**:
   - Open `app.py` and locate the `start_llamacpp_server()` function
   - Replace the model names in the `-hf` parameter:

   ```python
   # For text generation model (port 5778)
   "-hf", "your-organization/your-text-model-GGUF:quantization"
   
   # For vision-language model (port 5776)  
   "-hf", "your-organization/your-vision-model-GGUF:quantization"
   ```

2. **Update API endpoints** (if using different ports):
   - In `ai_chatbot.py`, modify the `api_base` URL (line 19) for the text model
   - In `video_summarization.py`, modify the `base_url` (line 70) for the vision model

#### Changing the Embedding Model:

1. **Modify the embedding model in both files**:
   - In `video_summarization.py` (line 140): Replace the model name for video analysis embedding
   - In `ai_chatbot.py` (line 42): Replace the model name for chatbot query embedding

   ```python
   # In both files
   embed_model = HuggingFaceEmbedding(model_name="your-preferred-embedding-model")
   ```

#### Changing the Reranker Model:

1. **Modify the reranker model in ai_chatbot.py**:
   - Open `ai_chatbot.py`
   - Locate line 56 and replace the reranker model:

   ```python
   rerank = SentenceTransformerRerank(top_n=1, model="your-preferred-reranker-model")
   ```

#### Requirements for Model Changes:
- **GGUF Format**: LLM models must be in GGUF format for llama.cpp compatibility
- **Hugging Face**: Models should be available on Hugging Face Hub
- **Quantization**: Choose appropriate quantization (e.g., Q4_K_M, Q5_K_M, Q8_0)
- **Hardware**: Ensure your hardware can handle the model size and requirements

#### Example: Using Different Models

```python
# In app.py - Replace with Llama 3.1 models
"-hf", "unsloth/Llama-3.1-8B-Instruct-GGUF:Q4_K_M"  # Text model
"-hf", "openbmb/MiniCPM-V-4_5-gguf:Q8_0"      # Vision model

# In both video_summarization.py and ai_chatbot.py - Use different embedding model  
embed_model = HuggingFaceEmbedding(model_name="BAAI/bge-base-en-v1.5")

# In ai_chatbot.py - Use different reranker model
rerank = SentenceTransformerRerank(top_n=1, model="BAAI/bge-reranker-large")
```

**Note**: After changing models, restart the application and allow time for the new models to download on first use.