# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Pocket TTS on OpenVINO in eight languages: Kyutai's seven (English, French, German, Italian,
Portuguese, Spanish, Dutch) and the community Indonesian fine-tune (anak10thn/pocket-tts-indonesian).

Each language is a checkpoint of its own, exported to IR (ov_pocket) the first time it speaks;
Indonesian, the default, at start. A voice is the model's state after hearing a short recording:
Kyutai publishes those for its languages; the Indonesian ones are computed from the four Common
Voice prompts that repository ships.
"""

import copy
import threading
from pathlib import Path
from typing import Iterator

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import Field

from model_downloader import fetch_file, fetch_snapshot
from ov_pocket import PocketTTS, ensure_export, is_exported
import worker_common
from worker_common import (
    add_ffmpeg_to_path,
    base_parser,
    get_logger,
    install_models_routes,
    install_openai_errors,
    lan_origins,
    models_dir,
    normalize_openvino_device,
    serve,
    staged_model_file,
)
from worker_common.speech import Piece, SpeechRequest, retime, speech_response

logger = get_logger(__name__)

MODEL_ID = "pocket-tts"


def _hf_path(uri: str) -> tuple[str, str, str | None]:
    """``hf://owner/repo/path/in/repo@revision`` as (repo, path, revision)."""
    rest, _, revision = uri.removeprefix("hf://").partition("@")
    owner, name, path = rest.split("/", 2)
    return f"{owner}/{name}", path, revision or None


def _fetch(uri: str, local_dir: Path, source: str) -> Path:
    """The ``hf://`` file ``uri`` under ``local_dir`` at its path in the repository."""
    repo, path, revision = _hf_path(uri)
    return fetch_file(repo, path, local_dir, source=source, revision=revision)


def _write_config(config: dict, path: Path) -> Path:
    with staged_model_file(str(path)) as staged:
        Path(staged).write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    return path


class IndonesianCheckpoint:
    """anak10thn/pocket-tts-indonesian, the 6-layer model its card recommends (CC-BY-4.0)."""

    language = "indonesian"
    repo = "anak10thn/pocket-tts-indonesian"
    # The repository at the revision that ships the voice prompts; the config
    # pins its weights and tokenizer to revisions of their own.
    revision = "382fe85ca848546efb04bf1b7fdba78c6396e2ce"
    config_file = "indonesian_6l.yaml"
    # The model card's end-of-speech threshold (pocket-tts defaults to -4.0, which
    # the card measured dropping words).
    eos_threshold = -6.0
    # Voice -> its prompt in the repository (CC0 Common Voice 22.0 clips). Female
    # and male by the pitch of the speech generated from each.
    prompts = {
        "female_1": "voices/common_voice_id_20954552.mp3",
        "female_2": "voices/common_voice_id_20954811.mp3",
        "male_1": "voices/common_voice_id_19961910.mp3",
        "male_2": "voices/common_voice_id_22918082.mp3",
    }

    def __init__(self):
        self.model_dir = models_dir("tts", MODEL_ID, self.repo)
        self.voices = list(self.prompts)
        self.out_dir = self.model_dir / "openvino"
        self.origin = f"hf://{self.repo}@{self.revision}"

    def download(self, source: str) -> tuple[Path, dict[str, str]]:
        """Fetch checkpoint, tokenizer and voice prompts; return a config pointing at them and the prompts."""
        fetch_snapshot(
            self.repo, self.model_dir, source=source, revision=self.revision,
            allow_patterns=[self.config_file, *self.prompts.values()],
        )
        config = yaml.safe_load((self.model_dir / self.config_file).read_text(encoding="utf-8"))
        lookup = config["flow_lm"]["lookup_table"]
        config["weights_path"] = str(_fetch(config["weights_path"], self.model_dir, source))
        lookup["tokenizer_path"] = str(_fetch(lookup["tokenizer_path"], self.model_dir, source))
        config["default_eos_threshold"] = self.eos_threshold
        local = _write_config(config, self.model_dir / "indonesian_6l.local.yaml")
        return local, {voice: str(self.model_dir / path) for voice, path in self.prompts.items()}


class KyutaiCheckpoint:
    """One of Kyutai's languages: pocket-tts' own config for it, with the weights that have no voice
    cloning (the ones with it are gated) and the voice states Kyutai precomputed for them.
    """

    def __init__(self, language: str, prefix: str, voices: tuple[str, ...]):
        from pocket_tts.utils.config import CONFIGS_DIR

        self.language = language
        self.config = yaml.safe_load((CONFIGS_DIR / f"{language}.yaml").read_text(encoding="utf-8"))
        self.origin = self.config["weights_path_without_voice_cloning"]
        repo, path, _ = _hf_path(self.origin)
        self.model_dir = models_dir("tts", MODEL_ID, repo)
        self.lang_dir = self.model_dir / Path(path).parent
        self.out_dir = self.lang_dir / "openvino"
        # Voice id -> Kyutai's name for it.
        self.names = {f"{prefix}_{name}": name for name in voices}
        self.voices = list(self.names)

    def download(self, source: str) -> tuple[Path, dict[str, str]]:
        """Fetch weights, tokenizer and voice states; return a config pointing at them and the states."""
        from pocket_tts.utils.utils import get_predefined_voice

        config = copy.deepcopy(self.config)
        weights = config.pop("weights_path_without_voice_cloning")
        config["weights_path"] = str(_fetch(weights, self.model_dir, source))
        lookup = config["flow_lm"]["lookup_table"]
        lookup["tokenizer_path"] = str(_fetch(lookup["tokenizer_path"], self.model_dir, source))
        local = _write_config(config, self.lang_dir / f"{self.language}.local.yaml")
        states = {
            voice: str(_fetch(get_predefined_voice(self.language, name), self.model_dir, source))
            for voice, name in self.names.items()
        }
        return local, states


# Kyutai's pre-made voices are precomputed in every language. English offers eight of its English
# speakers; every other language the voice Kyutai made for it first, then those of the others and
# Alba, Kyutai's default.
_NATIVE_VOICES = ("estelle", "juergen", "giovanni", "rafael", "lola", "daan", "alba")


def _native_first(own: str) -> tuple[str, ...]:
    return (own, *(voice for voice in _NATIVE_VOICES if voice != own))


DEFAULT_LANGUAGE = IndonesianCheckpoint.language


def _checkpoints() -> dict[str, IndonesianCheckpoint | KyutaiCheckpoint]:
    return {
        DEFAULT_LANGUAGE: IndonesianCheckpoint(),
        "english": KyutaiCheckpoint(
            "english", "en",
            ("alba", "marius", "javert", "jean", "fantine", "cosette", "eponine", "azelma"),
        ),
        "french": KyutaiCheckpoint("french", "fr", _native_first("estelle")),
        "german": KyutaiCheckpoint("german", "de", _native_first("juergen")),
        "italian": KyutaiCheckpoint("italian", "it", _native_first("giovanni")),
        "portuguese": KyutaiCheckpoint("portuguese", "pt", _native_first("rafael")),
        "spanish": KyutaiCheckpoint("spanish", "es", _native_first("lola")),
        "dutch": KyutaiCheckpoint("dutch", "nl", _native_first("daan")),
    }


CHECKPOINTS = _checkpoints()
#: Voice id -> its language.
VOICES = {voice: language for language, ckpt in CHECKPOINTS.items() for voice in ckpt.voices}
DEFAULT_VOICE = CHECKPOINTS[DEFAULT_LANGUAGE].voices[0]


class PocketSpeechRequest(SpeechRequest):
    model: str = Field(default=MODEL_ID, description="The model: pocket-tts.")
    voice: str = Field(
        default=DEFAULT_VOICE,
        description="One of GET /v1/audio/voices; it picks the language, too.",
    )


class PocketService:
    def __init__(self, device: str, source: str):
        # CPU unless another device is named: the GPU runs the one-frame-at-a-time loop at about a
        # fifth of the CPU's speed. AUTO goes to OpenVINO as is.
        self.device = normalize_openvino_device(device, default="CPU")
        self.source = source
        #: Language -> its loaded model; the default at start, the others on first use.
        self.models: dict[str, PocketTTS] = {}
        # Each model's one infer request holds the generation state, and a language's first use
        # downloads and exports it: requests take turns chunk by chunk (worker_common.speech.measured).
        self.lock = threading.Lock()

    def initialize(self) -> None:
        self.model(DEFAULT_LANGUAGE)
        logger.info("Pocket TTS loaded on %s; warming up", self.device)
        for _ in self.synthesize("Selamat datang.", DEFAULT_VOICE, 1.0):
            pass

    def model(self, language: str) -> PocketTTS:
        """``language``'s model, downloaded and exported first if need be."""
        model = self.models.get(language)
        if model is None:
            ckpt = CHECKPOINTS[language]
            logger.info("Loading Pocket TTS %s", language)
            config, voices = ckpt.download(self.source)
            ensure_export(str(config), voices, ckpt.out_dir, ckpt.origin)
            model = self.models[language] = PocketTTS(str(config), ckpt.out_dir, ckpt.voices, self.device)
        return model

    def ready(self, language: str) -> bool:
        """Whether ``language`` speaks without a download or export first."""
        ckpt = CHECKPOINTS[language]
        return language in self.models or is_exported(ckpt.out_dir, ckpt.voices, ckpt.origin)

    def synthesize(self, text: str, voice: str, speed: float) -> Iterator[Piece]:
        """Speech for ``text``, one pocket-tts chunk (about a sentence) at a time."""
        model = self.model(VOICES[voice])
        for prompt, frames_after_eos in model.chunks(text):
            audio = model.generate(voice, prompt, frames_after_eos)
            if audio.size:
                # The model has no speed control of its own.
                yield retime((audio, model.sample_rate), speed)


def create_app(service: PocketService) -> FastAPI:
    app = worker_common.create_app(
        "Pocket TTS API",
        description="OpenAI-compatible Text-to-Speech API: Pocket TTS on OpenVINO, in eight languages",
        healthcheck=False,
        # Called straight from the demo page on the app's port.
        allow_origins=lan_origins(8080),
    )

    @app.get("/healthcheck")
    async def healthcheck():
        return JSONResponse({"status": "ok"})

    @app.get("/v1/audio/voices")
    async def list_voices():
        """Every voice; false for those whose language downloads on its first use."""
        ready = {language: service.ready(language) for language in CHECKPOINTS}
        return {voice: ready[language] for voice, language in VOICES.items()}

    @app.post("/v1/audio/speech")
    async def create_speech(request: PocketSpeechRequest):
        if request.voice not in VOICES:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported voice: {request.voice}. Available voices: {', '.join(VOICES)}",
            )
        try:
            return await speech_response(
                service.synthesize(request.input, request.voice, request.speed),
                request.response_format,
                stream=request.stream,
                stream_format=request.stream_format,
                lock=service.lock,
                headers={
                    "Content-Disposition": f"attachment; filename=speech.{request.response_format}",
                    "Cache-Control": "no-cache",
                },
            )
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            logger.error("Speech generation failed: %s", e)
            raise HTTPException(status_code=500, detail="Failed to generate speech")

    install_models_routes(app, [MODEL_ID], owned_by="kyutai")
    install_openai_errors(app)
    return app


def main() -> int:
    args = base_parser(
        "Pocket TTS (OpenVINO)",
        default_port=5006,
        default_device="CPU",
        device_help=(
            "OpenVINO device for inference (AUTO: OpenVINO selects, a GPU "
            "when there is one). Default: CPU"
        ),
        source=True,
    ).parse_args()
    # ffmpeg encodes the non-WAV formats and applies the speed.
    add_ffmpeg_to_path()

    service = PocketService(args.device, args.source)
    try:
        service.initialize()
    except Exception as e:  # noqa: BLE001
        logger.error("Failed to initialize Pocket TTS: %s", e)
        return 1

    logger.info("Starting Pocket TTS server on port %s", args.port)
    serve(create_app(service), args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
