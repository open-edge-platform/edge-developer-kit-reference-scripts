# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Exceptions raised by every backend of :mod:`model_downloader`."""

from __future__ import annotations


class ModelDownloadError(RuntimeError):
    """A download failed; the message carries the backend's reason."""


class UpstreamMissingError(RuntimeError):
    """The OEP model-download source is absent and could not be fetched."""


class OvmsError(ModelDownloadError):
    """``ovms --pull`` did not complete."""

    def __init__(
        self,
        message: str,
        *,
        returncode: int | None = None,
        cancelled: bool = False,
        detail: str | None = None,
    ):
        super().__init__(message)
        self.returncode = returncode
        self.cancelled = cancelled
        self.detail = detail


class OvmsNotFoundError(OvmsError):
    """The OVMS binary is not where the workers' setup put it."""


class OvmsBusyError(OvmsError):
    """A pull is already running on this :class:`~model_downloader.ovms.OvmsPuller`."""
