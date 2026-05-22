#!/bin/bash

# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Function to check if the container exists
container_exists() {
    docker ps -a --format '{{.Names}}' | grep -Eq "^$1\$"
}

container_running() {
   #local container_name=$1
   docker inspect -f '{{.State.Running}}'  '$1'
}

# Container name
CONTAINER_NAME="vdms-rag"

# Check if the container exists
if container_exists $CONTAINER_NAME; then
    echo "Container $CONTAINER_NAME exists."

    # Stop the container
    echo "Stopping container $CONTAINER_NAME..."
    docker stop $CONTAINER_NAME && docker rm $CONTAINER_NAME

    sleep 10

    # Start the container in detached mode
    echo "Starting container $CONTAINER_NAME in detached mode..."
    docker run --rm -d --name vdms-rag -p 55555:55555 intellabs/vdms:latest
else
    echo "Starting container $CONTAINER_NAME in detached mode..."
    docker run --rm -d --name vdms-rag -p 55555:55555 intellabs/vdms:latest
fi

# Remove the folder ./video/video_metadata/
#if [ -d "./video_ingest/video_metadata" ]; then
#    echo "Removing folder ./video_ingest/video_metadata ..."
#    rm -rf ./video_ingest/video_metadata
#else
#    echo ""
#fi


#python embedding/generate_store_embeddings.py --config_file ./api/config.yaml
