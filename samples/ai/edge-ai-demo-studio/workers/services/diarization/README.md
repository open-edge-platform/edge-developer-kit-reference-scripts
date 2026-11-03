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
