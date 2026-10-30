# Humanoid RL GUI

The Humanoid RL GUI is a browser app for processing videos and managing training runs.

## Architecture

```text
┌─────────────────────┐       ┌─────────────────────┐       ┌─────────────────────┐
│    Local Scripts    │ <---> │       Backend       │ <---> │      Frontend       │
│ process / train /   │       │      FastAPI        │       │    Next.js app      │
│   resume / play     │       │    localhost:8000   │       │   localhost:3000    │
└─────────────────────┘       └──────────┬──────────┘       └─────────────────────┘
								 │
								 ▼
						application/.data
					uploads, artifacts, and jobs
```

The frontend sends requests to the backend. The backend runs the project scripts, tracks jobs and logs, and stores uploaded videos and generated artifacts to local sqlite database.

## Usage

### Starting Training Run

1. Start the backend and frontend as described in [README.md](../README.md#local-browser-gui-usage).
2. In **Library**, choose an MP4 or MOV video to upload, then select it in the video list.
3. Select **Process Video** to open the processing stages. Run **GVHMR**, then **GMR**, then **CSV to NPZ**. Each stage becomes available after its predecessor completes. Use the job status, logs, and previews to check progress.
4. When the motion file is ready, set the training iterations, number of environments, and devices, then select **Train**.

### Pages

- **Jobs** to monitor or cancel queued work. 
- **Library** to upload and process videos, and also start training runs for processed videos.
- **Training Runs** to browse completed runs, inspect files and checkpoints, download a run, start TensorBoard, or launch playback.

### Further Details

- `application/.env` is shared between the frontend and backend and configures TensorBoard (6767) and mjlab playback viewer (8181) ports. In Docker, the frontend is published on port 3008 and the backend on port 8008; TensorBoard and playback are also published on those configured ports for diagnostics.
- Uploaded videos, processing artifacts, and training runs are stored under `application/.data` by default.
- There is a job queue in place to limit resource consumption. At any time, only `(<=1 training run ||  <=1 tensorboard launch || <=1 mjlab viser session)` can be launched at a time.
- Pending/running jobs are **NOT persistent** and will be marked as interrupted on restart.