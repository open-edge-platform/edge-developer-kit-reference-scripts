# model-downloader — shared model fetching for Demo Studio workers

Every worker that pulls weights at start-up goes through this package instead
of calling `huggingface_hub`, `modelscope`, `requests` or the `ovms` binary
itself. One backend per place weights come from, plus `ovms --pull`:

| module | source | how |
|---|---|---|
| `model_downloader.oep` | Hugging Face (and any other upstream plugin: ollama, geti, …) | the [OEP model-download microservice](https://github.com/open-edge-platform/edge-ai-libraries/tree/main/microservices/model-download) from `open-edge-platform/edge-ai-libraries`, used **natively as a Python module** — no container, no separate service process — with its plugin registry driving the download |
| `model_downloader.modelscope` | ModelScope | the `modelscope` SDK directly; OEP has no ModelScope plugin |
| `model_downloader.http` | one `https://` URL, Open Model Zoo IR pairs | standard library, atomic `.part` write, optional sha256 |
| `model_downloader.ovms` | either hub | `ovms --pull`, which downloads *and converts* for OpenVINO Model Server |

A *source* (`huggingface` / `modelscope`, the workers' `--source`) is where
weights come from; it is independent of the method. `fetch_snapshot` and
`fetch_file` dispatch on it, and `ovms_pull` points OVMS at ModelScope through
`HF_ENDPOINT`. `model_downloader.sources` is the one place that mapping lives.

Only `model_downloader.oep` imports the upstream checkout. A worker that only
ever passes `--source modelscope`, fetches URLs or pulls through OVMS never
touches it.

## Using it from a worker

Add the package to the worker's `pyproject.toml`:

```toml
dependencies = [
    "model-downloader",
    ...
]

[tool.uv.sources]
model-downloader = { workspace = true }      # or { path = "../../common/downloader", editable = true } outside the workspace
```

Then:

```python
from model_downloader import fetch_snapshot, fetch_file, file_size, fetch_url, fetch_omz_ir, ovms_pull

# whole repo, or just the files matching allow_patterns, into an explicit dir
fetch_snapshot("Kedreamix/Linly-Talker", "models/wav2lip",
               source=args.source, allow_patterns=["checkpoints/wav2lipv2.pth"])

# one file from a repo -> <local_dir>/<filename>
fetch_file("hexgrad/Kokoro-82M", "config.json", model_dir, source=args.source)
fetch_file("hexgrad/Kokoro-82M", "kokoro-v1_0.pth", model_dir,
           progress=lambda received, total: ...)   # bytes so far; Hugging Face only
file_size("hexgrad/Kokoro-82M", "kokoro-v1_0.pth", source=args.source)   # bytes, or None; for progress bars

# one https URL, atomically via a .part file, skipped when already present
fetch_url("https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/alexa_v0.1.onnx",
          dest=model_path)

# an Open Model Zoo .xml/.bin pair -> <root>/<model>/<precision>/
fetch_omz_ir(models_root / "intel", model_name="noise-suppression-poconetlike-0001",
             precision="FP16")

# ovms --pull: download (and convert) into an OVMS model repository
ovms_pull("OpenVINO/whisper-base-fp16-ov", models_root / "ovms", task="speech2text",
          source=args.source, target_device=args.device, weight_format="fp16")
```

`source` accepts `huggingface` or `modelscope` (a string or an enum with a
`.value`). Every helper is idempotent, returns the local path, and raises
`ModelDownloadError` with the backend's reason on failure. `HF_TOKEN` is
picked up from the environment the same way the upstream service does it.

`modelscope` is an optional extra of this package: a worker that offers
`--source modelscope` lists `modelscope` in its own dependencies (piper,
malaya, lipsync and multiserve do); without it, `source=modelscope` raises
with that instruction.

For anything else on the OEP side, `download(name, hub, output_dir,
**plugin_kwargs)` drives any registered upstream plugin directly (widen the
set with `ENABLED_PLUGINS`), and `manager()` returns an upstream
`ModelManager` with job tracking over the same registry.

### `ovms --pull`

`ovms_pull(...)` is the blocking one-shot the services call before they start
serving (image-generation, speech-to-text/ovms). `OvmsPuller` is for an owner
that streams progress to a client and may cancel — the multiserve engine:

```python
from model_downloader import OvmsPuller, OvmsError

puller = OvmsPuller()
try:
    for line in puller.iter_pull(repo, repo_dir, task="text_generation",
                                 source=source, target_device="NPU", progress_only=True):
        yield line + "\n"
except OvmsError as exc:
    yield "cancelled\n" if exc.cancelled else f"failed: {exc}\n"

puller.cancel()   # from another thread
```

`ovms_env()` locates the binary (`workers/thirdparty/ovms`, or `OVMS_HOME` /
`OVMS_DIR`) and builds the PATH / PYTHONPATH / LD_LIBRARY_PATH environment
OVMS and its bundled `optimum-cli` need. The workers that serve with OVMS use
the same `OvmsEnv.env` for the serving process, so the pull and serve
environments cannot drift. The binary itself is not owned by this package:
`workers/setup.sh` installs it; `ovms_prepare` / `Initialize-Ovms`
(`scripts/worker-common.*`) provision the optimum environment when
multiserve or an OVMS worker starts.

The conversion environment is chosen per model. `EXPORT_PROFILES`
(`model_downloader/ovms/env.py`) lists the models the shared
`common/ovms-export` cannot export and the pinned uv project each converts
with instead — today `Qwen/Qwen3-ASR-*` → `common/ovms-export-qwen3-asr`.
`ovms_pull` and `OvmsPuller` pass the source model on, so callers change
nothing; `ovms_env(source_model=...)` builds such an environment directly,
and a pull whose profile is not provisioned fails with the commands to run.
The worker that serves those models provisions the profile in its start
script, using `python -m model_downloader ovms-export-env <model>` to learn
which project (if any) a model needs.

#### Fix-ups before serving (`model_downloader.ovms.fixups`)

`ovms --pull` takes a pre-converted OpenVINO repository as it is, and gets
two kinds of model wrong. The multiserve engine applies both fixes on every
start (a pull keeps the files of a model it already has, so they stick):

- **Decoder-based embedding models** (Qwen3-Embedding) ship no
  sentence-transformers pooling config, so OVMS pools on the first token and
  every text embeds about the same. `embeddings_pooling(model_dir)` returns
  `LAST` for a `*ForCausalLM` model without one, passed as `--pooling LAST`.
- **Rerank models whose tokenizer adds special tokens** (the
  `OpenVINO/bge-reranker-*-ov` repositories): OVMS's rerank calculator adds
  them too and every document scores near zero.
  `repair_rerank_tokenizer(model_dir, env)` converts the tokenizer again with
  the export environment's `convert_tokenizer --not-add-special-tokens`, once
  per model (it leaves `.ovms_rerank_tokenizer` behind).
- **Image pipelines exported without OpenVINO tokenizers**
  (`Aminfri/sdxl-turbo-openvino`): every generation request fails.
  `add_pipeline_tokenizers(model_dir, env)` converts each `tokenizer*` folder
  that lacks one; the image-generation worker runs it after its pull.

## How the OEP upstream source gets here

`workers/setup.sh` (and `setup.ps1`) run
`workers/oep-setup.sh fetch common/downloader`. That script reads
`workers/oep-services.json`, the catalogue of OEP microservices Demo Studio
uses together with the pinned release `tag`, and copies
`microservices/model-download` at that tag out of the one sparse clone of
`edge-ai-libraries` it keeps under `workers/thirdparty/edge-ai-libraries`.
Like every other catalogued worker, the copy lands in this package's own
gitignored `thirdparty/`:

```
workers/common/downloader/
├── model_downloader/                        this package
└── thirdparty/model-download/               copy of microservices/model-download (gitignored)
    ├── .demo-studio-edge-ai-libraries-ref   the tag the copy was made from
    └── src/                                 the package model_downloader.oep imports
```

`tag` in `workers/oep-services.json` is the single place the release tag
lives; bump it (`workers/oep-setup.sh pin <tag>`) and re-run
`workers/setup.sh` to move to a newer upstream (`EDGE_AI_LIBRARIES_REF=<tag>`
overrides it for one run; `workers/oep-setup.sh check` verifies every pin).
If a worker starts before setup ran, the package fetches on demand (disable
with `OEP_MODEL_DOWNLOAD_AUTO_CLONE=0`), and `OEP_MODEL_DOWNLOAD_HOME` points
it at a directory that already holds the microservice (e.g.
`microservices/model-download` of a local `edge-ai-libraries` checkout)
instead, which is then used as is.

Nothing in the copy is modified. Two things are adapted around it at
import time (see `oep/_upstream.py`):

- `ENABLED_PLUGINS` defaults to `huggingface`, so `import src.plugins` does not
  try to load plugins whose dependencies no worker installs. Set it yourself
  (`huggingface,ollama`, `all`, …) to widen the set.
- `src.utils.logging` is served by a stdlib-`logging` adapter so upstream log
  lines appear in the worker's log with the worker's format, and `structlog`
  is not a dependency of every worker.

The one Demo Studio plugin, `HuggingFaceDownloader` in `oep/plugins.py`,
subclasses the upstream `HuggingFacePlugin` and adds `local_dir`,
`allow_patterns`, `ignore_patterns` and `filename`; without them it is
identical to upstream.

## Command line

```bash
python -m model_downloader info        # pinned tag, checkout path, plugins, where OVMS is
python -m model_downloader snapshot hexgrad/Kokoro-82M models/tts/kokoro --allow config.json
python -m model_downloader file TensorForger/RIFE-safetensors flownet.safetensors models/rife
python -m model_downloader url https://host/model.onnx models/x/model.onnx
python -m model_downloader omz noise-suppression-poconetlike-0001 models/stt/intel --precision FP16
python -m model_downloader ovms-pull OpenVINO/whisper-base-fp16-ov models/ovms --task speech2text
```
