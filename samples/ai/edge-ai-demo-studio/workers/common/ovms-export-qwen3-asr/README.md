# ovms-export-qwen3-asr

The Python environment `ovms --pull` converts **Qwen3-ASR** in
(`Qwen/Qwen3-ASR-*`, served by `services/speech-to-text/ovms`). Every other
model converts in [`../ovms-export`](../ovms-export).

No optimum-intel release exports the Hugging Face-native Qwen3-ASR yet. The
export lives on the `add-qwen3-asr-hf-and-forced-aligner` branch of
[openvino-dev-samples/optimum-intel](https://github.com/openvino-dev-samples/optimum-intel)
and needs transformers 5.13, while `ovms-export` stays on optimum-intel 2.1.0
and transformers 5.5. Rather than swapping packages in and out of one
environment per selected model, this is a second pinned environment:

| | |
|---|---|
| optimum-intel | the fork at the commit pinned in `workers/oep-services.json` (`sources`, `keep_root`), copied into `./thirdparty/optimum-intel` and taken by path — no git dependency |
| transformers | `>=5.13.1,<5.14` (the fork's ceiling), optimum 2.2 |
| shared builds | torch 2.13.0+cpu, torchvision 0.28.0, openvino / openvino-tokenizers 2026.2.1, nncf 3.2.0, numpy 2.4.6 — the same as `ovms-export`, so uv hard-links them and only ~100 MB is really added |

`model_downloader.ovms` picks this environment from the model id
(`EXPORT_PROFILES` in `common/downloader/model_downloader/ovms/env.py`;
`OVMS_EXPORT_VENV_QWEN3_ASR` names another venv). It is **not** synced by
`workers/setup.sh`: `services/speech-to-text/ovms/start.sh` (`.ps1`)
provisions it the first time a Qwen3-ASR model is selected.

The copy carries one patch, `optimum-intel-version.patch`, which sets
`optimum/intel/version.py` to `2.1.0.dev0+4ca1144e`. Upstream's `setup.py`
appends `git rev-parse --short HEAD` to a `.dev0` version. Inside this
repository that is *this* repository's commit, so the version (and `uv.lock`)
would change on every commit here, and the build fails where git is absent.

```bash
./oep-setup.sh fetch common/ovms-export-qwen3-asr          # from workers/
thirdparty/uv/uv sync --project common/ovms-export-qwen3-asr
python -m model_downloader ovms-export-env Qwen/Qwen3-ASR-1.7B-hf
```

Verified on Linux (OVMS 2026.3.1, CPU): `ovms --pull --task speech2text
--source_model Qwen/Qwen3-ASR-1.7B-hf --weight-format fp16` converts, and the
graph serves `/v3/audio/transcriptions`. Windows, where OVMS runs
`optimum-cli` with its bundled Python on `PYTHONHOME`, is not verified.

Retire it when an optimum-intel release exports Qwen3-ASR: add the model to
`ovms-export`, drop the profile and the catalogue entry.
