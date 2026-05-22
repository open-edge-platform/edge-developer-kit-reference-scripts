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

# launch ffmpeg in tmux-session
VIDEO_FILENAME=$1
SESSION_NAME="rtsp-ffmpeg-stream-0"
APP_COMMAND="ffmpeg -v verbose -re -stream_loop -1 -i $VIDEO_FILENAME -c:v libx264 -an -f rtsp -rtsp_transport tcp rtsp://localhost:8554/live"

if tmux has-session -t $SESSION_NAME
then
   tmux kill-session -t $SESSION_NAME
fi
   # Create new tmux-session and run app command
tmux new-session -d -s $SESSION_NAME "$APP_COMMAND"
echo "Started new tmux session: $SESSION_NAME"


