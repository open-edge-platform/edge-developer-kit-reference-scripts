# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Small, backend-neutral PLY point-cloud / 3D Gaussian Splatting reader.

Supports ``ascii``, ``binary_little_endian`` and ``binary_big_endian`` files, plus Niantic SPZ
(versions 2 and 3: gzipped, quantized Gaussians), which is dequantized into the same 3DGS PLY
conventions (logit opacity, log scales, ``w x y z`` rotations, ``f_dc`` / ``f_rest``) with no
coordinate-system conversion, matching the editor's reader (``apps/web/lib/editor/plyReader.ts``).

Scalar elements declared before ``vertex`` are skipped; list elements (faces) are only accepted after
it, since skipping them means walking them row by row (a hostile count would spin). The header rules
match the editor's ``parsePlyHeader``: header bytes are latin-1, counts are plain decimal integers,
and unknown keywords are rejected.

Rasterization is a separate concern so this module can be used by tests and the XPU backend.
"""

from __future__ import annotations

import gzip
import re
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

import numpy as np

# 3DGS stores the degree-0 spherical-harmonics coefficient; RGB = 0.5 + C0 * f_dc.
SH_C0 = 0.28209479177387814


class PLYError(ValueError):
    """Raised when a PLY file is unsupported or malformed."""


# Higher-order SH coefficients per color channel ((d + 1)^2 - 1) -> SH degree d.
SH_REST_DEGREES = {3: 1, 8: 2, 15: 3}
_F_REST = re.compile(r"f_rest_(\d+)")


def sh_rest_count(degree: int) -> int:
    """Higher-order SH coefficients per color channel for ``degree`` (``(d + 1)^2 - 1``)."""
    return (degree + 1) ** 2 - 1


@dataclass(frozen=True)
class PLYPointCloud:
    positions: np.ndarray
    colors: np.ndarray | None = None
    scales: np.ndarray | None = None
    rotations: np.ndarray | None = None
    opacities: np.ndarray | None = None
    # Raw degree-0 coefficients ``f_dc_0..2`` (N, 3); RGB = 0.5 + SH_C0 * f_dc.
    spherical_harmonics: np.ndarray | None = None
    # Higher-order coefficients (N, K, 3), K = (d + 1)^2 - 1; ``None`` means degree 0.
    # Stored in the PLY channel-major: f_rest_{c * K + k} -> sh_rest[:, k, c].
    sh_rest: np.ndarray | None = None

    @property
    def is_gaussian_splat(self) -> bool:
        return all(
            value is not None for value in (self.colors, self.scales, self.rotations, self.opacities)
        )

    @property
    def sh_degree(self) -> int:
        if self.sh_rest is None or self.sh_rest.shape[1] == 0:
            return 0
        degree = SH_REST_DEGREES.get(int(self.sh_rest.shape[1]))
        if degree is None or self.sh_rest.shape != (len(self.positions), self.sh_rest.shape[1], 3):
            raise PLYError(f"sh_rest must have shape (N, K, 3) with K in {sorted(SH_REST_DEGREES)}.")
        return degree


_SCALARS: dict[str, str] = {
    "char": "i1",
    "int8": "i1",
    "uchar": "u1",
    "uint8": "u1",
    "short": "i2",
    "int16": "i2",
    "ushort": "u2",
    "uint16": "u2",
    "int": "i4",
    "int32": "i4",
    "uint": "u4",
    "uint32": "u4",
    "float": "f4",
    "float32": "f4",
    "double": "f8",
    "float64": "f8",
}

_FORMATS = {"ascii": None, "binary_little_endian": "<", "binary_big_endian": ">"}


@dataclass
class _Property:
    name: str
    type_name: str
    count_type: str | None = None  # set for list properties


@dataclass
class _Element:
    name: str
    count: int
    properties: list[_Property]

    @property
    def has_lists(self) -> bool:
        return any(prop.count_type is not None for prop in self.properties)


def read_ply(path: str | Path) -> PLYPointCloud:
    """Read the vertex table of an ASCII or binary (either endianness) PLY file, or an SPZ file."""
    try:
        with Path(path).open("rb") as stream:
            head = stream.read(_SPZ_HEADER.size)
            stream.seek(0)
            if head[:2] == _GZIP_MAGIC:
                return _read_spz(stream.read())
            if head[:4] == b"NGSP":  # SPZ v4+ is not a single gzip stream
                _spz_header(head)
                raise PLYError("SPZ file is not a valid SPZ version 2 or 3 file.")
            return _read_ply(stream)
    except PLYError:
        raise
    except OSError as error:
        raise PLYError(f"Could not read PLY file '{path}': {error}") from error


def _read_ply(stream: BinaryIO) -> PLYPointCloud:
    try:
        return _parse(stream)
    except PLYError:
        raise
    except (ValueError, TypeError, IndexError, KeyError, UnicodeDecodeError, OverflowError) as error:
        raise PLYError(f"PLY file is malformed: {error}") from error


def _parse_header(stream: BinaryIO) -> tuple[str, list[_Element]]:
    first = stream.readline().decode("latin-1").strip()
    if first != "ply":
        raise PLYError("PLY header must start with 'ply'.")
    format_name: str | None = None
    elements: list[_Element] = []
    while True:
        raw = stream.readline()
        if not raw:
            raise PLYError("PLY header is missing end_header.")
        line = raw.decode("latin-1").strip().split()
        if not line or line[0] in {"comment", "obj_info"}:
            continue
        keyword = line[0]
        if keyword == "format":
            if len(line) != 3:
                raise PLYError("Malformed PLY format declaration.")
            format_name = line[1]
        elif keyword == "element":
            if len(line) != 3 or not (line[2].isascii() and line[2].isdigit()):
                raise PLYError("Malformed PLY element declaration.")
            elements.append(_Element(line[1], int(line[2]), []))
        elif keyword == "property":
            if not elements:
                raise PLYError("PLY property declared before any element.")
            if len(line) == 5 and line[1] == "list":
                if line[2] not in _SCALARS or line[3] not in _SCALARS:
                    raise PLYError(f"Unsupported PLY list property types in '{' '.join(line)}'.")
                elements[-1].properties.append(_Property(line[4], line[3], line[2]))
            elif len(line) == 3 and line[1] in _SCALARS:
                elements[-1].properties.append(_Property(line[2], line[1]))
            else:
                raise PLYError(f"Unsupported PLY property declaration '{' '.join(line)}'.")
        elif keyword == "end_header":
            break
        else:
            raise PLYError(f"Unknown PLY header keyword '{keyword}'.")
    if format_name not in _FORMATS:
        raise PLYError(
            "Only ascii, binary_little_endian, and binary_big_endian PLY formats are supported."
        )
    return format_name, elements


def _parse(stream: BinaryIO) -> PLYPointCloud:
    format_name, elements = _parse_header(stream)
    vertex = next((element for element in elements if element.name == "vertex"), None)
    if vertex is None:
        raise PLYError("PLY file has no vertex element.")
    if vertex.count <= 0:
        raise PLYError("PLY vertex element must contain at least one vertex.")
    if vertex.has_lists:
        raise PLYError("PLY vertex element must only contain scalar properties.")
    if any(element.has_lists for element in elements[: elements.index(vertex)]):
        raise PLYError("PLY list elements before the vertex table are not supported.")
    names = [prop.name for prop in vertex.properties]
    if len(set(names)) != len(names):
        raise PLYError("PLY vertex element has duplicated property names.")
    missing = {"x", "y", "z"} - set(names)
    if missing:
        raise PLYError(f"PLY vertex table is missing position properties: {sorted(missing)}.")

    body = stream.read()
    if format_name == "ascii":
        table = _read_ascii(body, elements, vertex)
    else:
        table = _read_binary(body, elements, vertex, _FORMATS[format_name] or "<")
    return _point_cloud(table, vertex)


def _read_binary(body: bytes, elements: list[_Element], vertex: _Element, order: str) -> np.ndarray:
    # Only scalar elements precede the vertex table (see `_parse`); nothing after it is decoded.
    offset = 0
    for element in elements:
        dtype = np.dtype([(prop.name, order + _SCALARS[prop.type_name]) for prop in element.properties])
        needed = dtype.itemsize * element.count
        if offset + needed > len(body):
            raise PLYError(f"PLY binary element '{element.name}' is truncated.")
        if element is vertex:
            return np.frombuffer(body, dtype=dtype, count=element.count, offset=offset)
        offset += needed
    raise PLYError("PLY file has no vertex element.")  # pragma: no cover


def _read_ascii(body: bytes, elements: list[_Element], vertex: _Element) -> np.ndarray:
    tokens = body.decode("latin-1").split()
    position = 0
    for element in elements:
        if element is vertex:
            width = len(element.properties)
            needed = width * element.count
            if position + needed > len(tokens):
                raise PLYError("PLY ascii vertex table is truncated.")
            values = np.asarray(tokens[position : position + needed], dtype=np.float64).reshape(
                element.count, width
            )
            dtype = np.dtype([(prop.name, _SCALARS[prop.type_name]) for prop in element.properties])
            table = np.empty(element.count, dtype=dtype)
            for column, prop in enumerate(element.properties):
                table[prop.name] = values[:, column]
            return table
        position += len(element.properties) * element.count
    raise PLYError("PLY file has no vertex element.")  # pragma: no cover


def _columns(table: np.ndarray, names: list[str]) -> np.ndarray:
    return np.stack([np.asarray(table[name], dtype=np.float64) for name in names], axis=1)


def _point_cloud(table: np.ndarray, vertex: _Element) -> PLYPointCloud:
    available = {prop.name: prop for prop in vertex.properties}

    def field(prefix: str, count: int) -> np.ndarray | None:
        names = [f"{prefix}_{index}" for index in range(count)]
        if not set(names) <= set(available):
            return None
        return _columns(table, names).astype(np.float32)

    positions = _columns(table, ["x", "y", "z"]).astype(np.float32)
    scales = field("scale", 3)
    rotations = field("rot", 4)
    opacities = (
        np.asarray(table["opacity"], dtype=np.float64).astype(np.float32) if "opacity" in available else None
    )
    spherical_harmonics = field("f_dc", 3)
    sh_rest = _sh_rest(table, list(available))
    rgb_names = next(
        (
            candidate
            for candidate in (("red", "green", "blue"), ("r", "g", "b"))
            if set(candidate) <= set(available)
        ),
        None,
    )
    rgb: np.ndarray | None = None
    if rgb_names is not None:
        rgb = _columns(table, list(rgb_names))
        dtype = np.dtype(_SCALARS[available[rgb_names[0]].type_name])
        if dtype.kind in "iu":
            rgb = rgb / float(np.iinfo(dtype).max)
    dc_rgb = None if spherical_harmonics is None else 0.5 + SH_C0 * spherical_harmonics.astype(np.float64)
    has_gaussian_fields = scales is not None or rotations is not None
    colors_value = dc_rgb if (has_gaussian_fields and dc_rgb is not None) or rgb is None else rgb
    colors = None if colors_value is None else np.clip(colors_value, 0.0, 1.0).astype(np.float32)

    is_gaussian = all(value is not None for value in (colors, scales, rotations, opacities))
    fields = (positions, scales, rotations, opacities, colors, spherical_harmonics, sh_rest)
    if is_gaussian:
        valid = np.ones(len(positions), dtype=bool)
        for values in fields:
            if values is not None:
                valid &= np.isfinite(values).reshape(len(positions), -1).all(axis=1)
        if rotations is not None:
            valid &= np.any(rotations != 0, axis=1)
        if not valid.any():
            raise PLYError("PLY contains no valid Gaussian vertices.")
        positions, scales, rotations, opacities, colors, spherical_harmonics, sh_rest = (
            None if values is None else values[valid] for values in fields
        )
    else:
        for label, values in zip(
            ("position", "scale", "rotation", "opacity", "color", "spherical-harmonics", "f_rest"), fields
        ):
            if values is not None and not np.all(np.isfinite(values)):
                raise PLYError(f"PLY vertex {label} values must be finite.")
    return PLYPointCloud(
        positions=positions,
        colors=colors,
        scales=scales,
        rotations=rotations,
        opacities=opacities,
        spherical_harmonics=spherical_harmonics,
        sh_rest=sh_rest,
    )


_GZIP_MAGIC = b"\x1f\x8b"
_SPZ_MAGIC = 0x5053474E  # "NGSP"
_SPZ_HEADER = struct.Struct("<IIIBBBB")
_SPZ_COLOR_SCALE = 0.15
# Opacity bytes of 0 / 255 would give infinite logits; clamp to a visually identical range.
_SPZ_ALPHA_EPS = 1e-6


def _read_spz(compressed: bytes) -> PLYPointCloud:
    try:
        raw = gzip.decompress(compressed)
    except (OSError, EOFError, zlib.error) as error:
        raise PLYError(f"SPZ file is not valid gzip: {error}") from error
    version, count, sh_degree, fractional_bits = _spz_header(raw)
    rest = sh_rest_count(sh_degree)
    widths = (9, 1, 3, 3, 4 if version == 3 else 3, 3 * rest)
    if len(raw) < _SPZ_HEADER.size + count * sum(widths):
        raise PLYError("SPZ file is truncated.")
    blocks: list[np.ndarray] = []
    offset = _SPZ_HEADER.size
    for width in widths:
        blocks.append(np.frombuffer(raw, np.uint8, count * width, offset).reshape(count, width))
        offset += count * width
    packed_positions, alphas, colors, scales, packed_rotations, sh = blocks

    p = packed_positions.reshape(count, 3, 3).astype(np.int32)
    fixed = p[..., 0] | (p[..., 1] << 8) | (p[..., 2] << 16)
    fixed = np.where(fixed & 0x800000, fixed - (1 << 24), fixed)  # 24-bit two's complement
    positions = (fixed / float(1 << fractional_bits)).astype(np.float32)
    alpha = np.clip(alphas[:, 0] / 255.0, _SPZ_ALPHA_EPS, 1.0 - _SPZ_ALPHA_EPS)
    opacities = np.log(alpha / (1.0 - alpha)).astype(np.float32)
    dc = ((colors / 255.0 - 0.5) / _SPZ_COLOR_SCALE).astype(np.float32)
    log_scales = (scales / 16.0 - 10.0).astype(np.float32)
    xyzw = _spz_rotations(packed_rotations, version)
    rotations = np.ascontiguousarray(xyzw[:, [3, 0, 1, 2]]).astype(np.float32)
    # SPZ stores SH coefficient-major with RGB innermost, i.e. already (N, K, 3).
    sh_rest = None if rest == 0 else ((sh.reshape(count, rest, 3) - 128.0) / 128.0).astype(np.float32)
    return PLYPointCloud(
        positions=positions,
        colors=np.clip(0.5 + SH_C0 * dc, 0.0, 1.0).astype(np.float32),
        scales=log_scales,
        rotations=rotations,
        opacities=opacities,
        spherical_harmonics=dc,
        sh_rest=sh_rest,
    )


def _spz_header(raw: bytes) -> tuple[int, int, int, int]:
    """Validated ``(version, count, sh_degree, fractional_bits)`` from a decompressed SPZ."""
    if len(raw) < _SPZ_HEADER.size:
        raise PLYError("SPZ file is truncated.")
    magic, version, count, sh_degree, fractional_bits, _flags, _reserved = _SPZ_HEADER.unpack_from(raw)
    if magic != _SPZ_MAGIC:
        raise PLYError("Gzip file is not an SPZ splat.")
    if version not in (2, 3):
        raise PLYError(
            f"SPZ version {version} is not supported; re-export the splat as SPZ version 3 or PLY."
        )
    if count <= 0:
        raise PLYError("SPZ file contains no splats.")
    if sh_degree > 3:
        raise PLYError(f"SPZ SH degree {sh_degree} is not supported.")
    if fractional_bits > 24:  # positions are 24-bit fixed point
        raise PLYError("SPZ header is corrupt.")
    return version, count, sh_degree, fractional_bits


def _spz_rotations(packed: np.ndarray, version: int) -> np.ndarray:
    """Packed SPZ rotations -> ``(N, 4)`` unit quaternions in ``x y z w`` order."""
    count = len(packed)
    q = np.zeros((count, 4), dtype=np.float64)
    if version == 2:
        q[:, :3] = packed / 127.5 - 1.0
        q[:, 3] = np.sqrt(np.maximum(0.0, 1.0 - np.sum(q[:, :3] ** 2, axis=1)))
        return q
    # Version 3 "smallest three": top 2 bits index the largest component, then three
    # (sign bit + 9-bit magnitude) fields for the others, filled from component 3 down.
    comp = packed.astype(np.uint32)
    comp = comp[:, 0] | (comp[:, 1] << 8) | (comp[:, 2] << 16) | (comp[:, 3] << 24)
    largest = (comp >> 30).astype(np.int64)
    for component in range(3, -1, -1):
        other = largest != component
        magnitude = np.sqrt(0.5) * (comp & 511).astype(np.float64) / 511.0
        value = np.where((comp >> 9) & 1, -magnitude, magnitude)
        q[other, component] = value[other]
        comp = np.where(other, comp >> 10, comp)
    rows = np.arange(count)
    q[rows, largest] = np.sqrt(np.maximum(0.0, 1.0 - np.sum(q**2, axis=1)))
    return q


def _sh_rest(table: np.ndarray, names: list[str]) -> np.ndarray | None:
    """Decode ``f_rest_*`` (standard channel-major 3DGS layout) into an ``(N, K, 3)`` array."""
    indices = sorted(int(match.group(1)) for name in names if (match := _F_REST.fullmatch(name)))
    if not indices:
        return None
    count = len(indices)
    if indices != list(range(count)) or count % 3 or count // 3 not in SH_REST_DEGREES:
        expected = ", ".join(str(3 * k) for k in sorted(SH_REST_DEGREES))
        raise PLYError(
            f"PLY has {count} f_rest_* properties (max index {indices[-1]}); spherical harmonics "
            f"need contiguous f_rest_0..f_rest_{{n-1}} with n in {{{expected}}} (SH degree 1-3)."
        )
    per_channel = count // 3
    flat = _columns(table, [f"f_rest_{index}" for index in range(count)]).astype(np.float32)
    # Channel-major: f_rest_{c * K + k} -> [:, k, c].
    return np.ascontiguousarray(flat.reshape(len(flat), 3, per_channel).transpose(0, 2, 1))
