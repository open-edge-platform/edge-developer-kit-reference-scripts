<!-- Copyright (C) 2026 Intel Corporation -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

## Models on disk

`list_models.py --models <id> [<id> ...]` reports which image-generation
models already have a `graph.pbtxt` under `<repo>/models/ovms/<model id>/`,
without starting the worker or OVMS. OVMS decides completeness itself,
inside its own binary, on every pull; `graph.pbtxt` presence is the same
completeness signal `engines/multiserve/modules/ovms/ov_downloader.py`
already relies on for this pull mechanism elsewhere in this codebase.
