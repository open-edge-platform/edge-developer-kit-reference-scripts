import logging
from malaya_speech.utils.text import TextIDS
from overrides.malaya_normalizer_rules import load

logger = logging.getLogger(__name__)


def load_text_ids(
    pad_to: int = 8,
    understand_punct: bool = True,
    is_lower: bool = True,
    demoji_local_dir: str = None,
):
    """
    Load text normalizer module use by Malaya-Speech TTS.
    """

    try:
        import malaya
        from packaging import version
    except BaseException:
        raise ModuleNotFoundError(
            "malaya not installed. Please install it by `pip install malaya` and try again."
        )

    if version.parse(malaya.__version__) < version.parse("5.1"):
        logger.warning(
            "To get better speech synthesis, make sure Malaya version >= 5.1"
        )

    normalizer = load(demoji_local_dir=demoji_local_dir)
    sentence_tokenizer = malaya.text.function.split_into_sentences

    return TextIDS(
        pad_to=pad_to,
        understand_punct=understand_punct,
        is_lower=is_lower,
        normalizer=normalizer,
        sentence_tokenizer=sentence_tokenizer,
    )
