<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

## Models on disk

`list_models.py --models <id> [<id> ...]` reports which PaddleOCR presets
are already on disk under `<repo>/models/ocr/`, without starting the
worker: the `ppocrv5`/`ppocrv5-server` ONNX + dictionary files, the
`ppocrv3` `.tar` archives (re-fetched by the worker unless already present)
plus their extracted inference graphs, or the `paddleocr-vl`/
`paddleocr-vl-1.5` OpenVINO IR -- see the script's header comment for the
exact rule.

## Text as it is generated

The PaddleOCR-VL presets generate their text token by token (tens of
seconds on a CPU), so the worker reports it while it comes; the PP-OCR
presets are fast and report their whole text at once, through the same
contract.

- `POST /ocr?stream=true` (or `Accept: text/event-stream`) answers with
  Server-Sent Events: `delta` `{text}` per piece, then `done` with exactly
  the JSON body a plain `POST /ocr` returns (`elapsed_ms` is the model
  time), or `error` `{detail, status}`. A bad image (400) or no loaded
  model (503) still fails before the stream starts. Closing the stream
  stops the VL generation at its next token, freeing the model.
- `POST /ocr/jobs` jobs keep a growing `partial_text` in their status;
  `GET /ocr/jobs/{job_id}/events` streams that status (`status` events,
  via `worker_common.watch_status`) until the `done`/`error`/`cancelled`
  one; `done` carries the same `perf` block as the poll. Jobs have no
  deadline.
- `DELETE /ocr/jobs/{job_id}` cancels a job (`worker_common.cancel`): a
  pending one is `cancelled` at once and never runs; a running VL
  generation stops at its next token, freeing the model for the next job
  and the camera; a running PP-OCR pass is not interrupted, but its result
  is dropped. Until it stops the job keeps its status with
  `cancel_requested: true`. A finished job is left as it is.

Models opt in with `streams_text = True` and `on_text`/`cancel` arguments
in `_infer` (see `models/base.py`); the VL model passes a transformers
`TextStreamer` through `generation_config`, which the vendored
`ov_paddleocr_vl.chat()` spreads into `generate()`. `generate()` hands the
streamer every token from inside its decoding loop, so the streamer checks
the `CancelToken` there and `JobCancelled` unwinds out of `generate()` and
the model lock. Closing a `?stream=true` stream cancels the same way.

## Server-side camera

`GET /camera/stream` viewers share one background inference loop
(`core/camera.py`): it OCRs the latest frame back to back (at most every
`PADDLEOCR_CAMERA_INTERVAL_MS`) while anyone watches, and every viewer
draws the latest regions on the latest frame, so the video never waits for
a pass. With several viewers the most recent viewer's options apply.
