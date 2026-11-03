# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Single files over HTTPS, and the Open Model Zoo IR pairs built on them.

Plain standard-library HTTP for files that need no hub client. Writes go through a ``.part``
file renamed into place, so a killed worker never leaves a truncated model; an existing non-empty
file is reused unless ``force`` is set.
"""

from __future__ import annotations

import hashlib
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from ._startup import download_reason, startup_stage
from .errors import ModelDownloadError

__all__ = ["OMZ_STORAGE_URL", "fetch_omz_ir", "fetch_url"]

logger = logging.getLogger("model_downloader.http")

#: Open Model Zoo storage root used by the workers that ship OMZ models.
OMZ_STORAGE_URL = "https://storage.openvinotoolkit.org/repositories/open_model_zoo/temp"

_CHUNK = 1 << 20  # 1 MiB
_PROGRESS_EVERY = 64 << 20  # log every 64 MiB
_USER_AGENT = "edge-ai-demo-studio/model-downloader"


def fetch_url(
    url: str,
    dest: str | os.PathLike[str] | None = None,
    *,
    output_dir: str | os.PathLike[str] | None = None,
    filename: str | None = None,
    sha256: str | None = None,
    force: bool = False,
    timeout: float = 60,
    allow_insecure: bool = False,
) -> Path:
    """Download ``url`` to ``dest`` (or ``output_dir/<filename>``) and return the path.

    ``filename`` defaults to the URL's last path segment. ``sha256`` verifies
    the download; ``allow_insecure`` accepts ``http://``. Raises
    :class:`ModelDownloadError` when the transfer or the checksum fails.
    """
    parsed = urllib.parse.urlparse(url)
    allowed = {"https"} | ({"http"} if allow_insecure else set())
    if parsed.scheme not in allowed or not parsed.netloc:
        raise ValueError(
            f"refusing to download from {url!r}: only https URLs are accepted"
        )

    if dest is not None:
        target = Path(dest)
    elif output_dir is not None:
        name = filename or os.path.basename(parsed.path)
        if not name:
            raise ValueError(
                f"cannot derive a file name from {url!r}; pass filename= or dest="
            )
        target = Path(output_dir) / name
    else:
        raise ValueError("fetch_url needs dest= or output_dir=")

    if target.is_file() and target.stat().st_size > 0 and not force:
        return target

    target.parent.mkdir(parents=True, exist_ok=True)
    # Per-process name: concurrent fetches of the same file (two instances, or a service and an
    # engine) each write their own ".part" and the last os.replace() wins, instead of interleaving.
    part = target.with_name(f"{target.name}.part.{os.getpid()}")
    expected_sha = (sha256 or "").lower() or None
    digest = hashlib.sha256() if expected_sha else None

    logger.info("Downloading %s -> %s", url, target)
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    # The app's startup panel: Downloading <file>, bytes against the size
    # the server announced (none when it announced none).
    with startup_stage(
        "downloading",
        target.name,
        failure=lambda exc: f"Could not download {target.name}: {download_reason(exc)}",
    ) as stage:
        try:
            with (
                urllib.request.urlopen(request, timeout=float(timeout)) as response,  # nosec B310 - scheme validated above
                open(part, "wb") as fh,
            ):
                total = int(response.headers.get("Content-Length") or 0)
                done = 0
                next_report = _PROGRESS_EVERY
                stage.progress(0, total or None)
                while True:
                    chunk = response.read(_CHUNK)
                    if not chunk:
                        break
                    fh.write(chunk)
                    if digest is not None:
                        digest.update(chunk)
                    done += len(chunk)
                    stage.progress(done, total or None)
                    if done >= next_report:
                        next_report += _PROGRESS_EVERY
                        if total:
                            logger.info(
                                "  %s: %.0f%% (%d/%d MiB)",
                                target.name,
                                done * 100 / total,
                                done >> 20,
                                total >> 20,
                            )
                        else:
                            logger.info("  %s: %d MiB", target.name, done >> 20)
            if digest is not None and digest.hexdigest() != expected_sha:
                raise ModelDownloadError(
                    f"sha256 mismatch for {url}: expected {expected_sha}, got {digest.hexdigest()}"
                )
            try:
                os.replace(part, target)
            except PermissionError:
                if force or not (target.is_file() and target.stat().st_size > 0):
                    raise
                part.unlink(missing_ok=True)
        except BaseException as exc:
            try:
                part.unlink()
            except OSError:
                pass
            if isinstance(exc, (urllib.error.URLError, OSError)):
                raise ModelDownloadError(f"url:{url}: {exc}") from exc
            raise

    return target


def fetch_omz_ir(
    root: str | os.PathLike[str],
    *,
    model_name: str | None = None,
    precision: str = "FP32",
    xml_url: str | None = None,
    base_url: str = OMZ_STORAGE_URL,
) -> Path:
    """Fetch an OpenVINO IR pair (``.xml`` + ``.bin``) and return the ``.xml`` path.

    Either give ``xml_url`` (any ``.../<model>/<precision>/<model>.xml`` storage
    URL) or ``model_name`` + ``precision`` under ``base_url``. Files are
    mirrored to ``root/<model>/<precision>/``, the layout every OMZ-based
    worker already reads from.
    """
    if xml_url is None:
        if not model_name:
            raise ValueError("fetch_omz_ir needs model_name= or xml_url=")
        xml_url = f"{base_url.rstrip('/')}/{model_name}/{precision}/{model_name}.xml"
    parts = xml_url.rstrip("/").split("/")
    if len(parts) < 3 or not parts[-1].endswith(".xml"):
        raise ValueError(f"not an OpenVINO IR URL: {xml_url}")
    model, prec, xml_name = parts[-3], parts[-2], parts[-1]
    dest_dir = Path(root) / model / prec
    xml_path = fetch_url(xml_url, dest_dir / xml_name)
    fetch_url(
        xml_url[: -len(".xml")] + ".bin", dest_dir / (xml_name[: -len(".xml")] + ".bin")
    )
    return xml_path
