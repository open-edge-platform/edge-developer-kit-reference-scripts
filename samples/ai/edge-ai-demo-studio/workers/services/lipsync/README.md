<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

## Models on disk

Model weights live under the shared `<repo>/models/wav2lip` and
`<repo>/models/musetalk` (`worker_common.models_dir("wav2lip", ...)` /
`models_dir("musetalk", ...)`), not this worker's own directory -- the same
root the frontend's declared `modelDirectories` and every other instance of
this worker use. A worker directory from before this moved
(`workers/services/lipsync/models/wav2lip` or `.../models/musetalk`) is
migrated into place automatically on first startup after the upgrade, when
the new location does not exist yet; see
`worker_common.paths.migrate_legacy_models_dir`.

`list_models.py --models wav2lip musetalk` reports whether each lipsync
model is already converted to OpenVINO IR, without starting the worker:

- `wav2lip` needs both the FP16 and INT8 IR pairs under
  `<repo>/models/wav2lip/checkpoints/` -- CPU/NPU resolve to INT8 by default,
  and quantising it on first start takes minutes, so both are required for
  "downloaded" to be true.
- `musetalk` needs its four IRs under `<repo>/models/musetalk/ov/` plus
  `<repo>/models/musetalk/whisper/preprocessor_config.json`.

See the script's header comment for the exact file list.
