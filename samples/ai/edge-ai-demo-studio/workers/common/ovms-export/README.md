# ovms-export

The Python environment `ovms --pull` converts models in. OpenVINO Model
Server runs `optimum-cli export openvino` from the first Python on PATH;
`model_downloader.ovms_env` puts this directory's `.venv/bin` there on Linux
(Windows uses the Python bundled with the OVMS release instead).

It is OVMS's own conversion recipe, not a project of ours:
`ovms_prepare` (`scripts/worker-common.sh`) builds `.venv` from
[`demos/common/export_models/requirements.txt`](https://github.com/openvinotoolkit/model_server/blob/v2026.4.1/demos/common/export_models/requirements.txt)
at the OVMS release (`OVMS_EXPORT_REQUIREMENTS_URL`) when an OVMS worker
starts, plus [`compat/`](compat). It rebuilds only when that recipe changes, so
later starts work offline, and one worker installs while the others wait.
Windows installs the same file into OVMS's Python (`scripts/worker-common.ps1`).

Upstream owns the versions, and their security fixes, as for the OEP wrappers
(see `workers/README.md`). Move `OVMS_EXPORT_REQUIREMENTS_URL` to the new tag
together with OVMS in `setup.sh` / `setup.ps1`, then rerun the tests below.

What is added to upstream's file, each because it would not run without it:

- [`compat/`](compat) installs `ovms_export_compat.pth`, which restores the
  `SentenceTransformer._text_length` that optimum-intel 2.2.0's
  `OVSentenceTransformer` binds. The file pins sentence-transformers 5.6.0,
  and 5.4 removed it, so without it every int8 embeddings pull fails. Windows
  overrides sentence-transformers to 5.3.0 instead.

[`tests/test_conversions.py`](tests/test_conversions.py) runs the
`optimum-cli` and `convert_tokenizer` commands OVMS issues for each task the
app pulls (text generation, embeddings, rerank, speech to text, image
generation) on small public models and compares the result with PyTorch:

```bash
common/ovms-export/.venv/bin/python common/ovms-export/tests/test_conversions.py   # from workers/
```

`Qwen/Qwen3-ASR-*` cannot be exported with the optimum-intel release OVMS
installs; it converts in [`../ovms-export-qwen3-asr`](../ovms-export-qwen3-asr)
instead, which `model_downloader.ovms` selects per model.
