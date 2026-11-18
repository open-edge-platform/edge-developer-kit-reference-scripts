# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Simulation-ready OBJ conversion using the existing obj2mjcf pipeline."""

import argparse
from dataclasses import dataclass
from pathlib import Path

from obj2mjcf.cli import Args, CoacdArgs, process_obj


@dataclass(frozen=True)
class SimulationCoacdArgs(CoacdArgs):
    decimate: bool = True
    max_ch_vertex: int = 32


def convert_simulation_object(directory: Path, max_hulls: int = 8) -> None:
    if not 1 <= max_hulls <= 8:
        raise ValueError("Simulation collision geometry requires between 1 and 8 hulls.")
    objects = sorted(directory.glob("*.obj"))
    if not objects:
        raise ValueError(f"No OBJ files found in {directory}.")
    args = Args(
        obj_dir=str(directory),
        save_mjcf=True,
        overwrite=True,
        decompose=True,
        coacd_args=SimulationCoacdArgs(max_convex_hull=max_hulls),
    )
    for source in objects:
        process_obj(source, args)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--obj-dir", type=Path, required=True)
    parser.add_argument("--save-mjcf", action="store_true", required=True)
    parser.add_argument("--overwrite", action="store_true", required=True)
    parser.add_argument("--decompose", action="store_true", required=True)
    parser.add_argument("--coacd-args.max-convex-hull", dest="max_hulls", type=int, default=8)
    args = parser.parse_args()
    convert_simulation_object(args.obj_dir, args.max_hulls)


if __name__ == "__main__":
    main()
