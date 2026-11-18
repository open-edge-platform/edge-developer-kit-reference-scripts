# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Expose raw YUYV frames on stdin as a V4L2 camera, using only the standard library.

Runs as root where the camera client lives (for example inside the Physical AI Studio container,
through ``docker exec -i -u 0``). It asks the v4l2loopback module for a ``/dev/video<n>`` device,
makes sure the node exists in this mount namespace, and writes every frame read from stdin to it.
The device advertises capture only while frames are being written, so camera discovery lists it
just like a plugged-in webcam. Status lines are JSON on stderr. The device is removed when stdin
closes or on SIGTERM/SIGHUP.
"""

from __future__ import annotations

import argparse
import ctypes
import errno
import fcntl
import grp
import json
import os
import signal
import stat
import sys
import time

CONTROL_DEVICE = "/dev/v4l2loopback"
SYSFS = "/sys/class/video4linux"
LOOPBACK_CTL_ADD = 0x4C80
LOOPBACK_CTL_REMOVE = 0x4C81
V4L2_BUF_TYPE_VIDEO_OUTPUT = 2
V4L2_FIELD_NONE = 1
V4L2_COLORSPACE_SRGB = 8
V4L2_PIX_FMT_YUYV = int.from_bytes(b"YUYV", "little")


class LoopbackConfig(ctypes.Structure):
    _fields_ = [
        ("output_nr", ctypes.c_int32),
        ("unused", ctypes.c_int32),
        ("card_label", ctypes.c_char * 32),
        ("min_width", ctypes.c_uint32),
        ("max_width", ctypes.c_uint32),
        ("min_height", ctypes.c_uint32),
        ("max_height", ctypes.c_uint32),
        ("max_buffers", ctypes.c_int32),
        ("max_openers", ctypes.c_int32),
        ("debug", ctypes.c_int32),
        ("announce_all_caps", ctypes.c_int32),
    ]


class PixFormat(ctypes.Structure):
    _fields_ = [
        (name, ctypes.c_uint32)
        for name in (
            "width",
            "height",
            "pixelformat",
            "field",
            "bytesperline",
            "sizeimage",
            "colorspace",
            "priv",
            "flags",
            "ycbcr_enc",
            "quantization",
            "xfer_func",
        )
    ]


class FormatUnion(ctypes.Union):
    # The kernel union also holds pointers, which gives it 8-byte alignment on 64-bit hosts.
    _fields_ = [("pix", PixFormat), ("raw_data", ctypes.c_uint8 * 200), ("_align", ctypes.c_void_p)]


class Format(ctypes.Structure):
    _fields_ = [("type", ctypes.c_uint32), ("fmt", FormatUnion)]


class Fraction(ctypes.Structure):
    _fields_ = [("numerator", ctypes.c_uint32), ("denominator", ctypes.c_uint32)]


class OutputParm(ctypes.Structure):
    _fields_ = [
        ("capability", ctypes.c_uint32),
        ("outputmode", ctypes.c_uint32),
        ("timeperframe", Fraction),
        ("extendedmode", ctypes.c_uint32),
        ("writebuffers", ctypes.c_uint32),
        ("reserved", ctypes.c_uint32 * 4),
    ]


class StreamParmUnion(ctypes.Union):
    _fields_ = [("output", OutputParm), ("raw_data", ctypes.c_uint8 * 200)]


class StreamParm(ctypes.Structure):
    _fields_ = [("type", ctypes.c_uint32), ("parm", StreamParmUnion)]


def _iowr(number: int, size: int) -> int:
    return (3 << 30) | (size << 16) | (ord("V") << 8) | number


VIDIOC_S_FMT = _iowr(5, ctypes.sizeof(Format))
VIDIOC_S_PARM = _iowr(22, ctypes.sizeof(StreamParm))


def _emit(message: dict) -> None:
    sys.stderr.write(json.dumps(message) + "\n")
    sys.stderr.flush()


def _card_name(number: int) -> str | None:
    try:
        with open(f"{SYSFS}/video{number}/name") as handle:
            return handle.read().strip()
    except OSError:
        return None


def _is_loopback(number: int) -> bool:
    try:
        return "v4l2loopback" in os.path.realpath(f"{SYSFS}/video{number}/device")
    except OSError:
        return False


def _find_existing(label: str) -> int | None:
    """A device left behind by an earlier run (for example one a client still held open)."""
    for entry in sorted(os.listdir(SYSFS)):
        if entry.startswith("video") and entry[5:].isdigit():
            number = int(entry[5:])
            if _is_loopback(number) and _card_name(number) == label:
                return number
    return None


def _add_device(label: str, preferred: int | None) -> int:
    config = LoopbackConfig()
    config.unused = -1
    config.card_label = label.encode()[:31]
    config.max_buffers = 2
    config.max_openers = 10
    config.announce_all_caps = 0
    control = os.open(CONTROL_DEVICE, os.O_RDWR)
    try:
        for number in ([preferred] if preferred is not None else []) + [-1]:
            config.output_nr = number
            try:
                return fcntl.ioctl(control, LOOPBACK_CTL_ADD, config)
            except OSError as error:
                if number == -1 or error.errno not in (errno.EEXIST, errno.EBUSY):
                    raise
    finally:
        os.close(control)
    raise RuntimeError("unreachable")


def _remove_device(number: int, timeout_s: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout_s
    control = os.open(CONTROL_DEVICE, os.O_RDWR)
    try:
        while True:
            try:
                fcntl.ioctl(control, LOOPBACK_CTL_REMOVE, number)
                return True
            except OSError as error:
                # A client that still has the camera open keeps it busy; give it a moment to close.
                if error.errno != errno.EBUSY or time.monotonic() >= deadline:
                    return False
                time.sleep(0.2)
    finally:
        os.close(control)


def _ensure_node(number: int, timeout_s: float = 5.0) -> tuple[str, bool]:
    """Returns the node path and whether this process created it (containers have a private /dev)."""
    path = f"/dev/video{number}"
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            with open(f"{SYSFS}/video{number}/dev") as handle:
                major, minor = (int(part) for part in handle.read().strip().split(":"))
            break
        except OSError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.05)
    if os.path.exists(path):
        existing = os.stat(path)
        if stat.S_ISCHR(existing.st_mode) and existing.st_rdev == os.makedev(major, minor):
            return path, False
        os.unlink(path)
    os.mknod(path, 0o600 | stat.S_IFCHR, os.makedev(major, minor))
    try:
        group_id = grp.getgrnam("video").gr_gid
    except KeyError:
        # No video group here: share the group the host gave the loopback control device.
        group_id = os.stat(CONTROL_DEVICE).st_gid
    os.chown(path, 0, group_id)
    os.chmod(path, 0o660)
    return path, True


def _configure(fd: int, width: int, height: int, fps: int) -> None:
    video_format = Format()
    video_format.type = V4L2_BUF_TYPE_VIDEO_OUTPUT
    pix = video_format.fmt.pix
    pix.width, pix.height = width, height
    pix.pixelformat = V4L2_PIX_FMT_YUYV
    pix.field = V4L2_FIELD_NONE
    pix.bytesperline = width * 2
    pix.sizeimage = width * height * 2
    pix.colorspace = V4L2_COLORSPACE_SRGB
    fcntl.ioctl(fd, VIDIOC_S_FMT, video_format)
    parm = StreamParm()
    parm.type = V4L2_BUF_TYPE_VIDEO_OUTPUT
    parm.parm.output.timeperframe.numerator = 1
    parm.parm.output.timeperframe.denominator = fps
    fcntl.ioctl(fd, VIDIOC_S_PARM, parm)


def _read_exactly(fd: int, size: int) -> bytes | None:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = os.read(fd, min(remaining, 1 << 20))
        if not chunk:
            return None
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--label", required=True, help="Camera name that discovery reports.")
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--number", type=int, help="Preferred /dev/video<n> number.")
    args = parser.parse_args(argv)
    if args.width < 2 or args.width % 2 or args.height < 1:
        _emit({"type": "error", "message": "The camera size must be positive with an even width."})
        return 1

    if not os.path.exists(CONTROL_DEVICE):
        _emit(
            {
                "type": "error",
                "message": "The v4l2loopback kernel module is not loaded (no /dev/v4l2loopback).",
            }
        )
        return 1
    try:
        number = _find_existing(args.label)
        if number is None:
            number = _add_device(args.label, args.number)
        path, created_node = _ensure_node(number)
        fd = os.open(path, os.O_RDWR)
    except OSError as error:
        _emit({"type": "error", "message": f"Could not create the camera device: {error}"})
        return 1

    def stop(_signum: int, _frame: object) -> None:
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGHUP, stop)
    frame_size = args.width * args.height * 2
    try:
        _configure(fd, args.width, args.height, args.fps)
        _emit({"type": "ready", "device": path, "number": number})
        stdin = sys.stdin.fileno()
        while True:
            frame = _read_exactly(stdin, frame_size)
            if frame is None:
                break
            os.write(fd, frame)
    except OSError as error:
        _emit({"type": "error", "message": f"Camera device error: {error}"})
    finally:
        os.close(fd)
        removed = _remove_device(number)
        if created_node and removed and os.path.exists(path):
            os.unlink(path)
        _emit({"type": "closed", "device": path, "removed": removed})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
