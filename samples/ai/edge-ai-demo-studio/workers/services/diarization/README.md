<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

## Models on disk

`list_models.py --models pyannote/speaker-diarization-community-1` reports
whether the pyannote diarization pipeline snapshot is already downloaded,
without starting the worker: `config.yaml` plus the weight files the
snapshot bundles next to it (`segmentation/pytorch_model.bin`,
`embedding/pytorch_model.bin`, `plda/plda.npz`, `plda/xvec_transform.npz`),
under `<repo>/models/diarization/pyannote/speaker-diarization-community-1/`
(`DIARIZATION_MODEL_ID` in `modules/models.py`).

## Live diarization

`WS /v1/audio/stream` diarizes a live microphone on the speech-to-text
OVMS backend's protocol ([`common/audio-input-stream`](../../common/audio-input-stream)):
binary 16 kHz mono int16 PCM frames in, `{"event": "stop"}` to finish. Its
Silero VAD, with the same defaults, cuts the same utterances the speech-to-text
stream does, so a pass runs as each transcript is due. The medical scribe
streams one microphone capture to both workers. The browser holds the audio
until both sockets are open, then sends it from the first sample on, so both
get the same samples on one timeline and a burst of held audio may arrive
first. If this stream
is slower than 3 s to open, transcription starts without it and it joins at
the next frame, on the same timeline. The VAD loads at startup so a stream
need not wait for it.

- Before the audio, send `{"event": "config", ...}` with the `POST /v1/diarize`
  fields as JSON (`reference_embedding` and `speaker_profiles` as lists, not
  JSON strings). It goes in a frame, not the URL, so voice prints stay out of
  access logs.
- Each utterance is answered with `{"type": "speakers", "segments",
  "covered_until", "start", "end", "latency"}`. `segments` holds every speaker
  turn of the session so far, and `covered_until` is how far into the received
  audio the pass heard. Each pass re-runs pyannote over the latest
  `WINDOW_SECONDS` (120 s, `modules/live.py`) of audio, on the same pipeline
  thread as the jobs. Without voice prints, speakers keep their names from one
  pass to the next (matched by overlap). Utterances that queue up behind a slow
  pass are answered together.
- Closing the socket without a stop cancels the pass in progress at
  pyannote's next step, so a job submitted next does not wait for it.
