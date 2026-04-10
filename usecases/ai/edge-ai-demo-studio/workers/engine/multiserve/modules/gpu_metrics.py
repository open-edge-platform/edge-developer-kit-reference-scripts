# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import subprocess  # nosec - disable B404:import-subprocess check
import json
from pprint import pprint
from typing import List, Dict, Any, Optional
import os


class XpuManager:
    def __init__(self):
        self._key_metrics_map = {
            "XPUM_STATS_POWER": "power_W",
            "XPUM_STATS_GPU_UTILIZATION": "gpu_utilization_pct",
            "XPUM_STATS_MEMORY_USED": "memory_used_MB",
            "XPUM_STATS_MEMORY_UTILIZATION": "memory_utilization_pct",
            "XPUM_STATS_GPU_FREQUENCY": "gpu_frequency_MHz",
            "XPUM_STATS_CORE_TEMPERATURE": "core_temperature_C",
        }
        self.is_windows = os.name == "nt"
        self.command = "./engine/xpu-smi/xpu-smi.exe" if self.is_windows else "xpu-smi"

    def _run_xpusmi_command(self, command_args: List[str]) -> Optional[str]:
        full_command = [self.command] + command_args

        try:
            result = subprocess.run(
                full_command, capture_output=True, text=True, check=True, timeout=10
            )
            return result.stdout
        except FileNotFoundError:
            print(
                "Error: 'xpu-smi' command not found. Ensure it's installed and in your PATH."
            )
            return None
        except subprocess.CalledProcessError as e:
            print(f"Error: {e}")
            return None
        except subprocess.TimeoutExpired:
            print("Error: Command timed out.")
            return None
        except Exception as e:
            print(f"Unexpected error: {e}")
            return None

    def _parse_xpu_stats(self, stats_data: Dict[str, Any]) -> Dict[str, Any]:
        if not stats_data or "device_level" not in stats_data:
            return {"error": "Invalid stats data structure."}

        extracted_metrics = {
            "device_id": stats_data.get("device_id"),
        }

        for key in self._key_metrics_map.values():
            extracted_metrics[key] = None

        for metric in stats_data.get("device_level", []):
            metric_type = metric.get("metrics_type")
            metric_value = metric.get("value")

            if metric_type in self._key_metrics_map:
                key = self._key_metrics_map[metric_type]
                if isinstance(metric_value, (float, int)):
                    extracted_metrics[key] = (
                        round(metric_value, 2)
                        if isinstance(metric_value, float)
                        else metric_value
                    )
                else:
                    extracted_metrics[key] = metric_value

        return extracted_metrics

    def discover_devices(self) -> List[Dict[str, Any]]:
        discovery_stdout = self._run_xpusmi_command(["discovery", "-j"])

        if not discovery_stdout:
            return []

        try:
            discovery_data = json.loads(discovery_stdout)
            return discovery_data.get("device_list", [])
        except json.JSONDecodeError:
            print("Failed to parse discovery JSON.")
            return []
        except Exception as e:
            print(f"Unexpected error during discovery parsing: {e}")
            return []

    def get_device_stats(self, device_id: int) -> Optional[Dict[str, Any]]:
        stats_stdout = self._run_xpusmi_command(["stats", "-d", str(device_id), "-j"])

        if stats_stdout:
            try:
                raw_stats = json.loads(stats_stdout)
                return self._parse_xpu_stats(raw_stats)
            except json.JSONDecodeError:
                return None
            except Exception as e:
                print(f"Unexpected error during stats parsing: {e}")
                return None
        return None

    def get_all_device_data(self) -> Dict[int, Dict[str, Any]]:
        devices = self.discover_devices()
        if not devices:
            return {}

        all_data: Dict[int, Dict[str, Any]] = {}

        for device in devices:
            dev_id = device.get("device_id")
            if dev_id is not None:
                stats = self.get_device_stats(dev_id)
                if stats and "error" not in stats:
                    full_info = {**device, **stats}
                    all_data[dev_id] = full_info

        return all_data


if __name__ == "__main__":
    manager = XpuManager()

    print("Initializing XPU Manager and querying all devices...")

    xpu_data = manager.get_all_device_data()

    print("\n" + "=" * 60)
    if xpu_data:
        print(f"Successfully retrieved data for {len(xpu_data)} XPU device(s).")
        print("=" * 60)

        for dev_id, data in xpu_data.items():
            print(f"Device ID {dev_id}: {data.get('device_name', 'N/A')}")
            print(f"  - Power Draw: {data.get('power_W', 'N/A')} W")
            print(f"  - GPU Util: {data.get('gpu_utilization_pct', 'N/A')}%")
            print(f"  - Mem Util: {data.get('memory_utilization_pct', 'N/A')}%")
            print(f"  - Mem Used: {data.get('memory_used_MB', 'N/A')} MB")
            print(f"  - Core Temp: {data.get('core_temperature_C', 'N/A')}°C")
            print("-" * 60)

        print("\n--- Full Data Dictionary (Combined Discovery and Stats) ---")
        pprint(xpu_data)

    else:
        print(
            "No XPU data could be retrieved. Check your XPU-SMI installation and device status."
        )
