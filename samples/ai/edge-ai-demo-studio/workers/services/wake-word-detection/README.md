<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

## Models on disk

`list_models.py --models <id> [<id> ...]` reports which openWakeWord preset
models are already downloaded under `<models_dir>/wake-word-detection/`,
without starting the worker: a file exists and is non-empty, the same reuse
rule `model_downloader.http.fetch_url` uses.

## Detection and webhooks

Detection runs on a thread of its own, never on the event loop: it takes the
microphone's 80 ms chunks in capture order and runs the models on each. When
the models fall more than 2 s behind, the oldest audio is dropped (with a
warning) instead of building a backlog.

Every chunk that scores above a subscriber's threshold queues a webhook for
that subscriber. Each subscriber is served in order from its own
thread with a 2 s connect / 5 s read timeout, so a slow or unreachable
endpoint only delays its own notifications; once 32 are waiting, new ones are
dropped and logged. The subscriber list is cached for 2 s and refreshed at
once when it changes through the API. `POST /webhooks/test-webhook` calls all
subscribers at once and reports each call's real outcome.

## Detection in a recording

`POST /v1/wake-word-detection/detect` (multipart `file`, optional
`threshold`, default 0.5) runs the loaded models over a recording instead of
the microphone: ffmpeg decodes it to 16 kHz mono, and openWakeWord scores it
in 80 ms steps with 1 s of silence padded at each end. The answer gives each
model's best score and the second it first reached the threshold:

```json
{"duration": 2.43, "threshold": 0.5, "results": [
  {"model": "hey_jarvis_v0.1", "max_score": 0.999, "detected": true, "detected_at": 1.08}
]}
```

It scores on a model of its own, built from the loaded paths, so live
detection keeps running untouched; nothing is recorded or sent to webhooks.

## Event stream

`GET /v1/wake-word-detection/events/stream[?since=<iso>]` pushes detections and
the input level to the demo page as Server-Sent Events (`worker_common.sse`):

| Event       | Data                                                                    |
| ----------- | ----------------------------------------------------------------------- |
| `events`    | First, once: `{"events": [...]}`, as `GET /events?since=` answers       |
| `detection` | Each detection event as it is stored                                    |
| `cleared`   | `{}` after `DELETE /events`                                             |
| `level`     | `{"level", "active"}` as `GET /audio-level`, ~10 Hz while detecting, once on stop |

`GET /events` and `GET /audio-level` stay for clients that poll.
