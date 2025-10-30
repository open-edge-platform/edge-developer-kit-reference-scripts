from malaya.normalizer.rules import Normalizer
from malaya.function.validator import validate_object_methods
from malaya.preprocessing import Tokenizer
from overrides.malaya_preprocessing import demoji
from typing import Callable


class MalayaTextNormalizer(Normalizer):
    def __init__(self, *args, **kwargs):
        # Extract demoji_local_dir before passing kwargs to parent
        demoji_local_dir = kwargs.pop("demoji_local_dir", None)
        super().__init__(*args, **kwargs)
        self._demoji = demoji(local_dir=demoji_local_dir).demoji


def load(
    speller: Callable = None,
    stemmer: Callable = None,
    **kwargs,
):
    """
    Load a Normalizer using any spelling correction model.

    Parameters
    ----------
    speller: Callable, optional (default=None)
        function to correct spelling, must have `correct` or `normalize_elongated` method.
    stemmer: Callable, optional (default=None)
        function to stem, must have `stem_word` method.
        If provide stemmer, will accurately to stem kata imbuhan akhir.

    Returns
    -------
    result: malaya.normalizer.rules.Normalizer class
    """

    validate_object_methods(speller, ["correct", "normalize_elongated"], "speller")
    if stemmer is not None:
        if not hasattr(stemmer, "stem_word"):
            raise ValueError("stemmer must have `stem_word` method")

    tokenizer = Tokenizer(**kwargs).tokenize
    return MalayaTextNormalizer(
        tokenizer=tokenizer,
        speller=speller,
        stemmer=stemmer,
        demoji_local_dir=kwargs.get("demoji_local_dir"),
    )
