# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Where virtual device relays run, so their devices appear where the client looks for them.

* ``--container NAME``: inside the client's container (for example Physical AI Studio's), through
  ``docker exec``, because a container only sees the devices in its own ``/dev``.
* ``--helper-image IMAGE``: on this computer, through a short-lived privileged helper container
  that shares the host's ``/dev``. Docker supplies the root access device nodes need, so no
  password or host setup is involved; any Python image works, since relays use only the standard
  library.
* Neither: as this process, which then needs that access itself (tests use a private link path).
"""

from __future__ import annotations

import argparse

# Labels the helper containers so they can be found (and cleaned up) by hand.
HELPER_LABEL = "physical-ai-scene-builder.virtual-device"


def add_target_arguments(parser: argparse.ArgumentParser) -> None:
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--container", help="Create the devices inside this Docker container.")
    target.add_argument(
        "--helper-image",
        help="Create the devices on this computer from a helper container of this Python image.",
    )
    parser.add_argument(
        "--relay-python", default="python3", help="Python that runs the relays where they live."
    )


def relay_command_prefix(arguments: argparse.Namespace) -> list[str]:
    if arguments.container:
        return ["docker", "exec", "-i", "-u", "0", arguments.container]
    if arguments.helper_image:
        return [
            "docker",
            "run",
            "--rm",
            "-i",
            "--privileged",
            "--network",
            "none",
            "--pull",
            "missing",
            "--label",
            HELPER_LABEL,
            # The host's /dev (with its /dev/pts): device nodes and links appear on this computer.
            "-v",
            "/dev:/dev",
            arguments.helper_image,
        ]
    return []
