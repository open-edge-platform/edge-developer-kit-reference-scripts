# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Fixes for packages ovms-export pins past what optimum-intel 2.2.0 was written against.

``ovms_export_compat.pth`` imports this module whenever the environment's interpreter starts, so
the ``optimum-cli`` OVMS launches gets the fixes too. Each one runs right after the module it
patches is first imported, so nothing is imported early. Drop a fix with the release named in it.
"""

from __future__ import annotations

import importlib.abc
import sys
from collections.abc import Callable
from types import ModuleType


def _restore_text_length(module: ModuleType) -> None:
    """Give ``SentenceTransformer`` back the ``_text_length`` that 5.4 replaced with ``_input_length``.

    ``OVSentenceTransformer.__init__`` binds it, so without it every quantized sentence-transformers
    export (OVMS's default int8 embeddings pull) fails. Obsolete once optimum-intel ships
    huggingface/optimum-intel#1681.
    """
    model = module.SentenceTransformer
    if not hasattr(model, "_text_length"):
        model._text_length = lambda self, text: model._input_length(text)


FIXES: dict[str, Callable[[ModuleType], None]] = {
    "sentence_transformers": _restore_text_length,
}


class _FixAfterImport(importlib.abc.MetaPathFinder):
    """Finds a module in :data:`FIXES` through the other finders and fixes it once it has run."""

    def find_spec(self, fullname, path, target=None):
        fix = FIXES.get(fullname)
        if fix is None:
            return None
        for finder in sys.meta_path:
            if finder is self or not hasattr(finder, "find_spec"):
                continue
            spec = finder.find_spec(fullname, path, target)
            if spec is not None:
                break
        else:
            return None
        if spec.loader is None:
            return spec
        exec_module = spec.loader.exec_module

        def exec_and_fix(module: ModuleType) -> None:
            exec_module(module)
            fix(module)

        spec.loader.exec_module = exec_and_fix
        return spec


if not any(isinstance(finder, _FixAfterImport) for finder in sys.meta_path):
    sys.meta_path.insert(0, _FixAfterImport())
