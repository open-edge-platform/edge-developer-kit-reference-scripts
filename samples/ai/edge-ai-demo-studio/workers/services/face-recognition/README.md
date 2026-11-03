# Face Recognition Worker

FastAPI worker running one of these face-recognition pipelines at a time:

| Preset | Detector | Landmarks | Recogniser | Embedding |
|---|---|---|---|---|
| `omz-retail` (default) | `face-detection-retail-0004` (300x300) | `landmarks-regression-retail-0009` | `face-reidentification-retail-0095` | 256-d |
| `omz-adas` | `face-detection-adas-0001` (672x384) | `landmarks-regression-retail-0009` | `face-reidentification-retail-0095` | 256-d |
| `yunet-sface` | YuNet (OpenCV Zoo) | from the detector | SFace | 128-d |

Everything runs on OpenVINO. The `omz-*` presets are a port of the Open Model
Zoo [`face_recognition_demo`](https://github.com/openvinotoolkit/open_model_zoo/blob/master/demos/face_recognition_demo/python/README.md):
detect -> regress 5 landmarks on the (1.15x expanded) ROI -> align -> embed.
Their defaults mirror the demo's `-t_fd 0.6`, `-exp_r_fd 1.15` and `-t_id 0.3`
(that cosine *distance* is `0.5 * (1 - similarity)`, so the equivalent
similarity threshold used here is 0.4).

Models are downloaded on first load into `models/face-recognition/` at the
project root (`FACE_RECOGNITION_MODELS_DIR` overrides) — Intel FP16 IR from
storage.openvinotoolkit.org and OpenCV Zoo ONNX files, all Apache-2.0 —
through `model_downloader` (`fetch_omz_ir` / `fetch_url`).

The default device is `AUTO`: OpenVINO selects the device (a discrete GPU,
then an integrated GPU, then the CPU). GPU compiles disable Winograd
convolutions, on whichever GPU AUTO picks too, and `runtime` names the device
the model runs on (`openvino:GPU.1`).

## Flow

1. Enroll one or more reference images per person: `POST /gallery`
   (multipart `name` + `files[]`). The largest face in each image is embedded
   by the active model; enrolling the same name again appends images. The
   original bytes are kept, so switching models re-embeds the gallery
   automatically.
2. Recognise: `POST /recognize` (multipart `file`). Every face is matched
   against the gallery by cosine similarity.

Decision thresholds (cosine, on L2-normalised embeddings): `face-reidentification-retail-0095`
0.4 (the demo's `-t_id 0.3` distance), SFace 0.363 (OpenCV's calibrated
default).

## Endpoints

- `GET /healthcheck` — 200 once every requested pipeline is loaded
- `GET /devices` — OpenVINO device list (`AUTO` first)
- `GET /models`, `GET /models/active`, `POST /models/load {model, device}`
- `GET /gallery`, `POST /gallery`, `DELETE /gallery`, `DELETE /gallery/{id}`
- `POST /recognize`

## Run

A member of the `workers/` uv workspace (see [`workers/README.md`](../../README.md));
the shared environment comes from `uv sync --all-packages` in `workers/`.

```bash
./start.sh --port 8032 --model omz-retail --device AUTO
```

## Models on disk

`list_models.py --models <id> [<id> ...]` reports which of `omz-retail`,
`omz-adas`, `yunet-sface` are already downloaded, without starting the
worker (used by the app to show that before a user picks a model). It
mirrors `models/registry.py` and `models/omz|yunet_sface/model.py`'s own
file layout under `models/face-recognition/` — see the script's header
comment for the exact rule.
