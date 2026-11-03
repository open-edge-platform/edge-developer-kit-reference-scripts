# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import logging
import os
import queue
import subprocess  # nosec -- used for arecord parsing
import threading
import time
from typing import Optional

import numpy as np
import sounddevice as sd
from scipy import signal

from utils.config import AudioConfig

logger = logging.getLogger("uvicorn.error")

# Chunks (80 ms each) waiting for detection; past this the oldest audio is dropped so detection
# stays close to real time.
MAX_BACKLOG_CHUNKS = 25

# Seconds between "dropping audio" warnings while detection is behind.
DROP_WARNING_INTERVAL = 5.0


class MicrophoneUnavailableError(RuntimeError):
    """The host has no audio input device, or not the one asked for."""


class AudioManager:
    def __init__(self, audio_config: AudioConfig):
        self.config = audio_config
        self._thread_queue: queue.Queue = queue.Queue(maxsize=MAX_BACKLOG_CHUNKS)
        self.audio_stream: Optional[sd.InputStream] = None
        self.resample_ratio: float = 1.0
        self.current_rms: float = 0.0
        self._dropped_chunks = 0
        self._last_drop_warning = 0.0
        # Refreshing PortAudio's device list restarts it, which must not
        # happen while another thread lists devices or opens one.
        self._portaudio_lock = threading.RLock()

    def audio_callback(self, indata, frames, time_info, status):
        if status:
            logger.warning(f"Audio status: {status}")

        audio_float = indata[:, 0]

        # 0.0-1.0
        self.current_rms = float(np.sqrt(np.mean(audio_float**2)))

        if self.resample_ratio != 1.0:
            target_samples = int(len(audio_float) * self.resample_ratio)
            audio_float = signal.resample(audio_float, target_samples)

        # openWakeWord takes int16.
        audio_array = (audio_float * 32767).astype(np.int16)

        # This callback is the only producer, so after dropping the oldest chunk there is room.
        try:
            self._thread_queue.put_nowait(audio_array)
        except queue.Full:
            try:
                self._thread_queue.get_nowait()
            except queue.Empty:
                pass
            self._thread_queue.put_nowait(audio_array)
            self._note_dropped_chunk()

    def _note_dropped_chunk(self):
        """Count a dropped chunk, warning at most every few seconds."""
        self._dropped_chunks += 1
        now = time.monotonic()
        if now - self._last_drop_warning >= DROP_WARNING_INTERVAL:
            logger.warning(
                f"Detection is behind the microphone; dropped {self._dropped_chunks} "
                "audio chunk(s)"
            )
            self._dropped_chunks = 0
            self._last_drop_warning = now

    def next_chunk(self, timeout: float = 0.1):
        """The next audio chunk, oldest first; queue.Empty after ``timeout`` seconds."""
        return self._thread_queue.get(timeout=timeout)

    async def start_stream(self, device_id: int = -1):
        """Open the microphone (-1: system default) in a worker thread, since opening blocks."""
        await asyncio.to_thread(self._open_stream, device_id)

    def _query_devices(self):
        """PortAudio's devices as they are now, not as they were when it started.

        Restarting PortAudio would destroy an open stream, so the list is only
        refreshed while none is open.
        """
        with self._portaudio_lock:
            if self.audio_stream is None:
                sd._terminate()
                sd._initialize()
            return sd.query_devices()

    def _open_stream(self, device_id: int):
        with self._portaudio_lock:
            self._open_stream_locked(device_id)

    def _open_stream_locked(self, device_id: int):
        if self.audio_stream is not None:
            logger.warning("Audio stream already running")
            return

        # Say what is missing rather than PortAudio's "Error querying device -1".
        if not any(d["max_input_channels"] > 0 for d in self._query_devices()):
            message = (
                "This server has no microphone: no audio input device was "
                "found. Connect one, then start detection again."
            )
            logger.warning(message)
            raise MicrophoneUnavailableError(message)
        device_to_use = device_id if device_id != -1 else None
        try:
            device_info = sd.query_devices(device_to_use, kind="input")
        except (ValueError, sd.PortAudioError) as e:
            which = "The default microphone" if device_to_use is None else f"Microphone {device_id}"
            message = f"{which} is not available ({e}). Pick another one from the microphone list."
            logger.warning(message)
            raise MicrophoneUnavailableError(message) from e

        try:
            logger.info(f"Opening microphone stream with device {device_id}...")

            native_sample_rate = int(
                device_info.get("default_samplerate", self.config.SAMPLE_RATE)
            )

            self.resample_ratio = self.config.SAMPLE_RATE / native_sample_rate

            if self.resample_ratio != 1.0:
                logger.info(
                    f"Will resample from {native_sample_rate}Hz to {self.config.SAMPLE_RATE}Hz (ratio: {self.resample_ratio:.3f})"
                )

            # sounddevice may resolve "sysdefault" differently than expected, so with no device
            # requested fall back to PortAudio's default.
            if device_id == -1 and device_info.get("name", "").lower() == "sysdefault":
                device_to_use = None

            self.audio_stream = sd.InputStream(
                samplerate=native_sample_rate,
                channels=self.config.CHANNELS,
                dtype="float32",
                blocksize=self.config.CHUNK_SIZE,
                callback=self.audio_callback,
                device=device_to_use,
            )
            self.audio_stream.start()
            logger.info(
                f"Microphone stream opened with device {device_id} at {native_sample_rate}Hz, listening for wake word..."
            )

        except Exception as e:
            logger.error(f"Error with microphone: {e}")
            logger.error(f"Available devices: {sd.query_devices()}")
            raise

    async def stop_stream(self):
        """Stop the audio stream (in a worker thread: stopping waits for PortAudio)."""
        await asyncio.to_thread(self._close_stream)

    def _close_stream(self):
        if self.audio_stream is not None:
            try:
                self.audio_stream.stop()
                self.audio_stream.close()
                logger.info("Microphone stream closed")
            except Exception as e:
                logger.error(f"Error closing stream: {e}")
            finally:
                self.audio_stream = None

    def clear_queue(self):
        while not self._thread_queue.empty():
            try:
                self._thread_queue.get_nowait()
            except queue.Empty:
                break

    @staticmethod
    def parse_arecord_devices() -> dict[str, str]:
        """``arecord -l``'s capture devices as ``{"hw:3,0": card name}``; empty off POSIX."""
        devices = {}

        if os.name != "posix":
            return devices

        try:
            result = subprocess.run(
                ["arecord", "-l"], capture_output=True, text=True, timeout=2
            )

            if result.returncode == 0:
                lines = result.stdout.strip().split("\n")
                for line in lines:
                    if line.startswith("card ") and "device " in line:
                        try:
                            card_part = line.split(",")[0]
                            card_num = card_part.split("card ")[1].split(":")[0].strip()

                            device_part = line.split("device ")[1].split(":")[0].strip()

                            card_name = line.split("[")[1].split("]")[0]

                            hw_id = f"hw:{card_num},{device_part}"
                            devices[hw_id] = card_name

                        except (IndexError, ValueError):
                            continue

            return devices
        except Exception as e:
            logger.error(f"Could not parse arecord output: {e}")
            return devices

    @staticmethod
    def get_sysdefault_device_name(sounddevice_list) -> str:
        """The real name of Linux's sysdefault input: the ``arecord -l`` device no sounddevice entry
        names, else arecord's first, else "System Default"."""
        if os.name != "posix":
            return "System Default"

        try:
            arecord_devices = AudioManager.parse_arecord_devices()

            if not arecord_devices:
                return "System Default"

            sounddevice_hw_ids = set()
            for device in sounddevice_list:
                device_name = device.get("name", "")
                if "(hw:" in device_name:
                    try:
                        hw_id = device_name.split("(")[1].split(")")[0]
                        sounddevice_hw_ids.add(hw_id)
                    except (IndexError, ValueError):
                        continue

            for hw_id, device_name in arecord_devices.items():
                if hw_id not in sounddevice_hw_ids:
                    logger.info(
                        f"Identified sysdefault device: {device_name} ({hw_id})"
                    )
                    return device_name

            if arecord_devices:
                first_device = next(iter(arecord_devices.values()))
                logger.info(f"Using fallback sysdefault device: {first_device}")
                return first_device

            return "System Default"
        except Exception as e:
            logger.error(f"Could not get sysdefault device name from arecord: {e}")
            return "System Default"

    def list_devices(self, default_device_id: int = -1) -> list[dict]:
        """Physical audio input devices, after a "System Default" entry with id -1."""
        try:
            devices = self._query_devices()
            available_devices = []

            exclude_keywords = [
                "pipewire",
                "pulse",
                "dmix",
                "dsnoop",
                "monitor",
                "loopback",
                "mix",
                "alt",
                "hdmi",
            ]

            sysdefault_name = self.get_sysdefault_device_name(devices)

            host_apis = sd.query_hostapis()

            for i, device in enumerate(devices):
                if device["max_input_channels"] <= 0:
                    continue

                host_api_idx = device.get("hostapi", 0)
                host_api_name = (
                    host_apis[host_api_idx]["name"]
                    if host_api_idx < len(host_apis)
                    else "Unknown"
                )

                logger.info(
                    f"Checking device {i}: {device['name']} (Host API: {host_api_name})"
                )

                # On Windows, only show WASAPI devices (support shared mode)
                if os.name == "nt":
                    if "WASAPI" not in host_api_name.upper():
                        continue

                device_name = device["name"].lower()
                if (
                    any(keyword in device_name for keyword in exclude_keywords)
                    or device_name == "default"
                ):
                    continue

                display_name = (
                    sysdefault_name
                    if device_name == "sysdefault"
                    else str(device["name"])
                )

                available_devices.append(
                    {
                        "id": int(i),
                        "name": display_name,
                        "max_input_channels": int(device["max_input_channels"]),
                        "default_samplerate": (
                            float(device.get("default_samplerate"))
                            if device.get("default_samplerate")
                            else None
                        ),
                        "host_api": host_api_name,
                    }
                )

            available_devices.insert(
                0,
                {
                    "id": -1,
                    "name": "System Default",
                    "max_input_channels": None,
                    "default_samplerate": None,
                },
            )

            return available_devices

        except Exception as e:
            logger.error(f"Error listing audio devices: {e}")
            raise
