# Test to image generation

## Overview
Text-to-image generation microservice is a FastAPI-based API that interacts with the stable diffusion model to perform image generation tasks. 
It provides endpoints for managing the pipeline, checking the pipeline status, retrieving the generated image, and performing a health check.

### Supported Models
* Stable Diffusion XL
* Stable Diffusion v3.5 
* Stable Diffusion v3
* Flux.1 Schnell
* Flux.1 Dev

### Supported Inference Device
* CPU
* GPU

---

## Quick Start

### 1. Install Operating System
- Install the latest [Ubuntu 24.04 LTS Desktop](https://releases.ubuntu.com/noble/). Refer to the [Ubuntu Desktop installation tutorial](https://ubuntu.com/tutorials/install-ubuntu-desktop#1-overview) if needed.

### 2. Install GPU Driver (Optional)
- If you plan to use a GPU for inference, install the appropriate GPU driver:
  - **Intel® Arc™ A-Series Graphics:** [Installation Guide](../../../README.md#-5-minute-quick-start)

### 3. Install Docker Engine
- Follow the official [Docker installation guide](https://docs.docker.com/engine/install/) to set up Docker Engine on your system.

### 4. Build and Run the Docker Container
- Build the text-to-image generation docker image.
  ```bash
  docker build --network=host -t text2image .
  ```
- Export the required environment variables and run the container:
  > By default, using -p xxxx:xxxx in docker run exposes the container ports externally on all network interfaces. To restrict access to localhost only, use -p 127.0.0.1:xxxx:xxxx instead.
  ```bash
  # Select your text-to-image model.
  # Eg. stable-diffusion-xl, stable-diffusion-v3.5 or stable-diffusion-v3.
  export TEXT2IMAGE_MODEL=stable-diffusion-xl
  
  # Insert huggingface login token
  export HF_TOKEN=<your_huggingface_token>
  
  # Run the container  
  export RENDER_GROUP_ID=$(getent group render | cut -d: -f3)
  
  docker run -it --rm \
      --name text2image-container \
      --group-add $RENDER_GROUP_ID \
      --device /dev/dri:/dev/dri \
      -p 8100:8100 \
      -e MODEL=$TEXT2IMAGE_MODEL \
      -e HF_TOKEN=$HF_TOKEN \
      -v $(pwd)/data:/usr/src/app/data \
      text2image 
  ```


## Development

---

### 1. Setup text-to-image generation server  

- Change the current directory to the selected model. For example:
  ```bash
  cd stable-diffusion-v3.5
  ```

- Execute the setup script.
  ```bash
  ./setup.sh
  ```

### 2. Verify the server by running the example (optional)
```bash
./run.sh
```

___

## Routes

### 1. **POST /pipeline/select-device**
   - **Description**: Selects and compiles the device for the pipeline.
   - **Request Body**: 
     ```
     {
       "device": "<device_name>"
     }
     ```
   - **Response**:
     - Success:
       ```
       {
         "status": "success",
         "message": "Pipeline prepared on <device_name>."
       }
       ```
     - Error:
       ```
       {
         "status": "error",
         "message": "<error_message>"
       }
       ```

### 2. **POST /pipeline/run**
   - **Description**: Starts the pipeline execution asynchronously in the background.
   - **Request Body**: 
     ```
     {
       "prompt": "<your_prompt>"
     }
     ```
   - **Response**:
     - Success:
       ```
       {
         "status": "success",
         "message": "Pipeline execution started in background."
       }
       ```
     - Error:
       ```
       {
         "status": "error",
         "message": "Pipeline execution is already running or pipeline is not initialized."
       }
       ```

### 3. **GET /pipeline/status**
   - **Description**: Checks the current status of the pipeline.
   - **Response**:
     ```
     {
       "running": <true or false>,
       "completed": <true or false>
     }
     ```

### 4. **GET /pipeline/image**
   - **Description**: Retrieves the generated image once the pipeline has completed execution. This endpoint is available only when the pipeline has finished processing.
   - **Response**:
     - Success (Image):
       The generated image will be returned as a `PNG` file:
       ```
       {
         "status": "success",
         "message": "Image returned"
       }
       ```
     - Error:
       ```
       {
         "status": "error",
         "message": "Pipeline execution is not yet complete."
       }
       ```

### 5. **GET /health**
   - **Description**: A simple health check endpoint to ensure that the API is up and running.
   - **Response**:
     ```
     {
       "status": "healthy"
     }
     ```
     