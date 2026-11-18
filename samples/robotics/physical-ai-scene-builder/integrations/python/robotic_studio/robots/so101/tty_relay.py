# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Serve an emulated Feetech servo bus on a serial device node, using only the standard library.

Runs where the serial client lives (for example inside the Physical AI Studio container, through
``docker exec -i``): it opens a pseudo-terminal, links ``/dev/ttyACM<n>`` to it so
``serial.tools.list_ports`` lists it, and answers the client's packets itself with
:mod:`.feetech_bus`. Answering locally keeps replies within the few milliseconds a USB adapter
takes; clients such as ``scservo_sdk`` give up after about 34 ms and read any later reply as the
answer to their next request.

The servos' motion comes from the simulation, which owns the arm. JSON lines on stdin:

* ``{"type": "load", "servos": [hex registers...], "ticks": [...]}``: first line, the start state.
* ``{"type": "ticks", "values": [...]}``: each servo's actual encoder position.
* ``{"type": "write", "index": i, "address": a, "data": [...]}``: a register write from the host.

Whenever registers change, a ``{"type": "registers", "packets": n, "servos": {index: hex}}`` line
on stdout reports the changed servos (and, at most a few times a second, the packet count alone).
Status lines are JSON on stderr. The link is removed when stdin closes or on SIGTERM/SIGHUP.
"""

from __future__ import annotations

import argparse
import contextlib
import errno
import json
import os
import select
import signal
import string
import sys
import time
import tty

from .feetech_bus import FeetechBus, VirtualServo

PACKET_REPORT_INTERVAL_S = 0.25
DEVICE_PATH_CHARS = string.ascii_letters + string.digits + "/._-"


def _emit(message: dict) -> None:
    sys.stderr.write(json.dumps(message) + "\n")
    sys.stderr.flush()


def _link_device(target: str, link: str | None, device_dir: str, prefix: str) -> str:
    if link:
        os.symlink(target, link)
        return link
    for index in range(64):
        name = f"{prefix}{index}"
        candidate = os.path.join(device_dir, name)
        if os.path.lexists(candidate) or os.path.exists(f"/sys/class/tty/{name}"):
            continue
        try:
            os.symlink(target, candidate)
        except FileExistsError:
            continue
        return candidate
    raise RuntimeError(f"No free {prefix}<n> name in {device_dir}.")


def _grant_serial_access(path: str, owner_uid: int) -> None:
    """Let the owner and the dialout group open the terminal, like a USB serial adapter."""
    try:
        import grp

        group_id = grp.getgrnam("dialout").gr_gid
    except (KeyError, ImportError):
        group_id = -1
    with contextlib.suppress(PermissionError):
        os.chown(path, owner_uid, group_id)
    os.chmod(path, 0o660)


def load_bus(message: dict) -> FeetechBus:
    """The bus described by the host's ``load`` line."""
    if message.get("type") != "load":
        raise ValueError("The first host message must be 'load'.")
    servos = []
    for registers, ticks in zip(message["servos"], message["ticks"], strict=True):
        data = bytes.fromhex(registers)
        servo = VirtualServo(data[5])
        if len(data) != len(servo.registers):
            raise ValueError("Each servo needs a full register file.")
        servo.registers[:] = data
        servo.actual_ticks = int(ticks)
        servos.append(servo)
    return FeetechBus(servos)


class BusServer:
    """Applies host messages and client packets to the bus and reports register changes."""

    def __init__(self, bus: FeetechBus) -> None:
        self.bus = bus
        self._reported = [bytes(servo.registers) for servo in bus.servos]
        self._reported_packets = bus.packets_handled
        self._next_packet_report = 0.0

    def host_message(self, message: dict) -> None:
        kind = message.get("type")
        if kind == "ticks":
            self.bus.set_actual_ticks([int(value) for value in message["values"]])
        elif kind == "write":
            self.bus.servos[int(message["index"])].write(int(message["address"]), message["data"])

    def report(self, now: float) -> dict | None:
        """The changes since the last report, or None when there is nothing to send yet."""
        changed = {}
        for index, servo in enumerate(self.bus.servos):
            current = bytes(servo.registers)
            if current != self._reported[index]:
                changed[str(index)] = current.hex()
                self._reported[index] = current
        packets = self.bus.packets_handled
        if not changed and (packets == self._reported_packets or now < self._next_packet_report):
            return None
        self._reported_packets = packets
        self._next_packet_report = now + PACKET_REPORT_INTERVAL_S
        return {"type": "registers", "packets": packets, "servos": changed}


def _host_lines(server: BusServer, buffer: bytearray) -> None:
    """Applies every complete line in ``buffer`` and keeps the unfinished rest."""
    *lines, rest = bytes(buffer).split(b"\n")
    buffer[:] = rest
    for line in lines:
        if line.strip():
            server.host_message(json.loads(line))


def _read_line(fd: int, buffer: bytearray) -> bytes | None:
    """Blocks until one full line arrives on ``fd``; None at end of input."""
    while b"\n" not in buffer:
        data = os.read(fd, 65536)
        if not data:
            return None
        buffer.extend(data)
    line, _, rest = bytes(buffer).partition(b"\n")
    buffer[:] = rest
    return line


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--link", help="Exact device path to create instead of the next free name.")
    parser.add_argument("--device-dir", default="/dev")
    parser.add_argument("--prefix", default="ttyACM")
    parser.add_argument(
        "--owner-uid", type=int, default=-1, help="User that owns the port (default: unchanged)."
    )
    args = parser.parse_args(argv)
    device_paths: list[str] = []
    for value in (args.link or "", args.device_dir, args.prefix):
        copied = ""
        for character in value:
            for allowed in DEVICE_PATH_CHARS:
                if allowed == character:
                    copied += allowed
                    break
            else:
                parser.error(f"Device paths may only use letters, digits, and '{DEVICE_PATH_CHARS[-4:]}'.")
        if ".." in copied.split("/"):
            parser.error("Device paths must not contain '..'.")
        device_paths.append(copied)
    link, device_dir, prefix = device_paths
    if not prefix or "/" in prefix:
        parser.error("--prefix must be a device name, not a path.")

    stdin, stdout = sys.stdin.fileno(), sys.stdout.fileno()
    pending = bytearray()
    first = _read_line(stdin, pending)
    if first is None:
        return 0
    try:
        server = BusServer(load_bus(json.loads(first)))
        _host_lines(server, pending)
    except (KeyError, TypeError, ValueError) as error:
        _emit({"type": "error", "message": f"Invalid servo state from the host: {error}"})
        return 1

    master, slave = os.openpty()
    tty.setraw(slave)
    # A client that stops reading must not stall the bus; like a UART, overflowing replies drop.
    os.set_blocking(master, False)
    terminal = os.ttyname(slave)
    _grant_serial_access(terminal, args.owner_uid)
    try:
        device = _link_device(terminal, link or None, device_dir, prefix)
    except (OSError, RuntimeError) as error:
        _emit({"type": "error", "message": f"Could not create the device link: {error}"})
        return 1

    def stop(_signum: int, _frame: object) -> None:
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGHUP, stop)
    _emit({"type": "ready", "device": device, "terminal": terminal})
    try:
        while True:
            readable, _, _ = select.select([stdin, master], [], [], PACKET_REPORT_INTERVAL_S)
            if master in readable:
                try:
                    data = os.read(master, 4096)
                except BlockingIOError:
                    data = b""
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    data = b""
                reply = server.bus.feed(data) if data else b""
                if reply:
                    try:
                        os.write(master, reply)
                    except BlockingIOError:
                        pass
            if stdin in readable:
                data = os.read(stdin, 65536)
                if not data:
                    break
                pending.extend(data)
                _host_lines(server, pending)
            report = server.report(time.monotonic())
            if report is not None:
                os.write(stdout, (json.dumps(report) + "\n").encode())
    finally:
        # The slave stays open until here so a client closing the port never hangs up the master.
        if os.path.islink(device) and os.readlink(device) == terminal:
            os.unlink(device)
        os.close(slave)
        os.close(master)
        _emit({"type": "closed", "device": device})
    return 0
