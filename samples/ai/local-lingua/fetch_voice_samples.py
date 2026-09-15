#!/usr/bin/env python3
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
Download MediaSpeech (AR/ES/FR/TR) + OpenSLR-83 Midlands English (male)
datasets, extract them, and copy N unique RANDOM WAV samples per language
into ./voice_samples/<LANG>/

Usage:
    python3 fetch_voice_samples.py                 # keep downloads/extracted files
    python3 fetch_voice_samples.py --cleanup        # delete _downloads/ and _extracted/ after sampling
    python3 fetch_voice_samples.py --n 15           # change sample count per language
    python3 fetch_voice_samples.py --cleanup --n 5  # combine flags

Re-running this script always picks a NEW random set of samples
(random seed is re-initialized from system time on every run).

Requires: only Python standard library (urllib, zipfile, tarfile, shutil, random, argparse)
"""

import argparse
import random
import shutil
import zipfile
import tarfile
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path("voice_samples")
DOWNLOAD_DIR = Path("_downloads")
EXTRACT_DIR = Path("_extracted")

SOURCES = {
    "AR": "https://github.com/NTRLab/MediaSpeech/releases/download/1.1/AR.zip",
    "ES": "https://github.com/NTRLab/MediaSpeech/releases/download/1.1/ES.zip",
    "FR": "https://github.com/NTRLab/MediaSpeech/releases/download/1.1/FR.zip",
    "TR": "https://github.com/NTRLab/MediaSpeech/releases/download/1.1/TR.zip",
    "EN": "https://openslr.trmal.net/resources/83/midlands_english_male.zip",
}

def download(url: str, dest: Path):
    if urlparse(url).scheme not in ("http", "https"):
        raise ValueError(f"Refusing to fetch non-http(s) URL: {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        print(f"[skip] Already downloaded: {dest.name}")
        return
    print(f"[download] {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    # Scheme validated above; only http(s) URLs reach this point.
    with urllib.request.urlopen(req) as resp, open(dest, "wb") as out:  # nosec B310
        shutil.copyfileobj(resp, out)
    print(f"[done] {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")

def extract(archive: Path, dest_dir: Path):
    dest_dir.mkdir(parents=True, exist_ok=True)
    print(f"[extract] {archive.name} -> {dest_dir}")
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive, "r") as z:
            z.extractall(dest_dir)
    elif archive.suffix in (".tgz", ".tar") or archive.name.endswith(".tar.gz"):
        with tarfile.open(archive, "r:*") as t:
            t.extractall(dest_dir)
    else:
        raise ValueError(f"Unknown archive format: {archive}")

def find_wavs(root: Path):
    return list(root.rglob("*.wav")) + list(root.rglob("*.WAV"))

def sample_and_copy(wav_files, lang: str, n: int):
    out_dir = BASE_DIR / lang
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if len(wav_files) == 0:
        print(f"[warn] No WAV files found for {lang}")
        return

    chosen = random.SystemRandom().sample(wav_files, min(n, len(wav_files)))
    for f in chosen:
        shutil.copy2(f, out_dir / f.name)
    print(f"[ok] {lang}: copied {len(chosen)} random samples -> {out_dir}")

def process_language(lang: str, url: str, n: int):
    out_dir = BASE_DIR / lang
    existing = list(out_dir.glob("*.wav")) + list(out_dir.glob("*.WAV")) if out_dir.exists() else []
    if len(existing) >= n:
        print(f"[skip] {lang}: already has {len(existing)} samples")
        return

    fname = url.split("/")[-1]
    archive_path = DOWNLOAD_DIR / fname
    extract_path = EXTRACT_DIR / lang
    download(url, archive_path)
    extract(archive_path, extract_path)
    wavs = find_wavs(extract_path)
    sample_and_copy(wavs, lang, n)

def cleanup():
    for d in (DOWNLOAD_DIR, EXTRACT_DIR):
        if d.exists():
            try:
                shutil.rmtree(d)
                print(f"[cleanup] Removed {d}/")
            except OSError:
                print(f"[cleanup] Could not fully remove {d}/ (may need sudo)")
                pass

def main():
    parser = argparse.ArgumentParser(description="Fetch and sample multilingual voice datasets.")
    parser.add_argument("--cleanup", action="store_true",
                         help="Delete downloaded archives and extracted files after sampling.")
    parser.add_argument("--n", type=int, default=10,
                         help="Number of random unique samples per language (default: 10).")
    args = parser.parse_args()

    random.seed()
    BASE_DIR.mkdir(exist_ok=True)
    DOWNLOAD_DIR.mkdir(exist_ok=True)
    EXTRACT_DIR.mkdir(exist_ok=True)

    for lang, url in SOURCES.items():
        try:
            process_language(lang, url, args.n)
        except Exception as e:
            print(f"[error] Failed processing {lang}: {e}")

    if args.cleanup:
        cleanup()

    print("\nSummary:")
    for lang_dir in sorted(BASE_DIR.iterdir()):
        count = len(list(lang_dir.glob("*.wav")))
        print(f"  {lang_dir.name}: {count} samples")

if __name__ == "__main__":
    main()
