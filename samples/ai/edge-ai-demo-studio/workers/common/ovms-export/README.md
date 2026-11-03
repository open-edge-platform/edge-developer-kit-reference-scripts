# ovms-export

The Python environment `ovms --pull` converts models in. OpenVINO Model
Server runs `optimum-cli export openvino` from the first Python on PATH;
`model_downloader.ovms_env` puts this project's `.venv/bin` there on Linux
(Windows uses the Python bundled with the OVMS release instead).

It is a separate uv project, synced by `ovms_prepare`
(`scripts/worker-common.sh`) when multiserve or an OVMS worker starts, and pinned to the same torch / openvino / optimum-intel
builds as `services/embeddings` so the two share their wheels through uv's
hard-links. See the comments in `pyproject.toml` for what is deliberately
left out.

```bash
uv sync --project common/ovms-export        # from workers/
common/ovms-export/.venv/bin/optimum-cli --help
```

transformers (5.15.1) and sentence-transformers (6.2.0) are pinned past what
optimum-intel 2.2.0 declares, for CVE fixes. Two things keep that safe:

- [`compat/`](compat) installs `ovms_export_compat.pth`, which restores the
  `SentenceTransformer._text_length` that optimum-intel's
  `OVSentenceTransformer` binds (sentence-transformers 5.4 removed it).
  Without it every int8 embeddings pull fails.
- [`tests/test_conversions.py`](tests/test_conversions.py) runs the
  `optimum-cli` and `convert_tokenizer` commands OVMS issues for each task the
  app pulls (text generation, embeddings, rerank, speech to text, image
  generation) on small public models and compares the result with PyTorch.
  Rerun it after changing any pin here:

```bash
common/ovms-export/.venv/bin/python common/ovms-export/tests/test_conversions.py   # from workers/
```

`Qwen/Qwen3-ASR-*` cannot be exported with the optimum-intel release pinned
here; it converts in [`../ovms-export-qwen3-asr`](../ovms-export-qwen3-asr)
instead, which `model_downloader.ovms` selects per model.
