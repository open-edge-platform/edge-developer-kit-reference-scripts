# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Audio management module for wake word detection."""

import asyncio
import logging
import os
import subprocess  # nosec -- used for arecord parsing
from typing import Optional

import numpy as np
import sounddevice as sd
from scipy import signal

from utils.config import AudioConfig

logger = logging.getLogger("uvicorn.error")


class AudioManager:
    """Manages audio input stream and device selection."""

    def __init__(self, audio_config: AudioConfig):
        self.config = audio_config
        self.audio_queue: asyncio.Queue = asyncio.Queue()
        self.audio_stream: Optional[sd.InputStream] = None
        self.resample_ratio: float = 1.0

    def audio_callback(self, indata, frames, time_info, status):
        """Callback function for audio stream."""
        if status:
            logger.warning(f"Audio status: {status}")

        # Extract mono audio
        audio_float = indata[:, 0]

        # Resample if needed
        if self.resample_ratio != 1.0:
            target_samples = int(len(audio_float) * self.resample_ratio)
            audio_float = signal.resample(audio_float, target_samples)

        # Convert float32 to int16 for openWakeWord
        audio_array = (audio_float * 32767).astype(np.int16)

        # Put in queue for processing
        try:
            self.audio_queue.put_nowait(audio_array.copy())
        except asyncio.QueueFull:
            logger.warning("Audio queue full, dropping frame")

    async def start_stream(self, device_id: int = -1):
        """Start audio stream from the system microphone.

        Args:
            device_id: Optional audio input device ID. If -1, uses system default.
        """
        if self.audio_stream is not None:
            logger.warning("Audio stream already running")
            return

        try:
            logger.info(f"Opening microphone stream with device {device_id}...")

            # Get device info to determine native sample rate
            device_to_use = device_id if device_id != -1 else None
            device_info = sd.query_devices(device_to_use, kind="input")
            native_sample_rate = int(
                device_info.get("default_samplerate", self.config.SAMPLE_RATE)
            )

            # Calculate resampling ratio
            self.resample_ratio = self.config.SAMPLE_RATE / native_sample_rate

            if self.resample_ratio != 1.0:
                logger.info(
                    f"Will resample from {native_sample_rate}Hz to {self.config.SAMPLE_RATE}Hz (ratio: {self.resample_ratio:.3f})"
                )

            # Check if the specified device is sysdefault and convert to None for sounddevice
            if device_info.get("name", "").lower() == "sysdefault":
                device_to_use = None

            # Open microphone stream with sounddevice using native sample rate
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
        """Stop the audio stream."""
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
        """Clear the audio queue."""
        while not self.audio_queue.empty():
            try:
                self.audio_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    @staticmethod
    def parse_arecord_devices() -> dict[str, str]:
        """Parse arecord -l output to get all available hardware devices.

        Returns:
            dict: Mapping of hardware IDs (e.g., "hw:3,0") to device names
        """
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
                    # Look for card/device entries
                    if line.startswith("card ") and "device " in line:
                        try:
                            # Extract card number
                            card_part = line.split(",")[0]
                            card_num = card_part.split("card ")[1].split(":")[0].strip()

                            # Extract device number
                            device_part = line.split("device ")[1].split(":")[0].strip()

                            # Extract card name (first brackets)
                            card_name = line.split("[")[1].split("]")[0]

                            # Create hardware ID
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
        """Get the actual device name for the system default audio device on Linux.

        This function identifies the sysdefault device by:
        1. Getting all hardware devices from arecord -l
        2. Extracting hardware IDs from other sounddevice entries
        3. Finding which arecord device is NOT in sounddevice (that's the default)

        Args:
            sounddevice_list: List of devices from sd.query_devices()

        Returns:
            str: The actual device name from arecord -l, or "System Default" if not found
        """
        if os.name != "posix":
            return "System Default"

        try:
            # Parse all devices from arecord
            arecord_devices = AudioManager.parse_arecord_devices()

            if not arecord_devices:
                return "System Default"

            # Extract hardware IDs from sounddevice entries (excluding sysdefault)
            sounddevice_hw_ids = set()
            for device in sounddevice_list:
                device_name = device.get("name", "")
                # Extract hw:X,Y pattern from device name
                if "(hw:" in device_name:
                    try:
                        hw_id = device_name.split("(")[1].split(")")[0]
                        sounddevice_hw_ids.add(hw_id)
                    except (IndexError, ValueError):
                        continue

            # Find which arecord device is NOT in sounddevice list
            # That device is the system default
            for hw_id, device_name in arecord_devices.items():
                if hw_id not in sounddevice_hw_ids:
                    logger.info(
                        f"Identified sysdefault device: {device_name} ({hw_id})"
                    )
                    return device_name

            # Fallback: use the first device from arecord
            if arecord_devices:
                first_device = next(iter(arecord_devices.values()))
                logger.info(f"Using fallback sysdefault device: {first_device}")
                return first_device

            return "System Default"
        except Exception as e:
            logger.error(f"Could not get sysdefault device name from arecord: {e}")
            return "System Default"

    def list_devices(self, default_device_id: int = -1) -> list[dict]:
        """List available audio input devices (microphones).

        Args:
            default_device_id: The device ID to mark as default

        Returns:
            List of available audio devices with their properties
        """
        try:
            # Force re-initialization of sounddevice to refresh device list
            sd._terminate()
            sd._initialize()

            devices = sd.query_devices()
            available_devices = []

            # Keywords to exclude virtual/system devices
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

            # Get the actual sysdefault device name on Linux
            sysdefault_name = self.get_sysdefault_device_name(devices)

            # Get host API information
            host_apis = sd.query_hostapis()

            for i, device in enumerate(devices):
                if device["max_input_channels"] <= 0:
                    continue  # Not an input device

                # Get host API name
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
                # Skip virtual/system devices
                if (
                    any(keyword in device_name for keyword in exclude_keywords)
                    or device_name == "default"
                ):
                    continue

                # Use the actual device name from arecord for sysdefault
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

            # Add system default option at the beginning
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
