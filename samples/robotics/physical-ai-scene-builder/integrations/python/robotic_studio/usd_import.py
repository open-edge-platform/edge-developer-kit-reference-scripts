# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Convert a USD/USDA/USDC/USDZ asset into a GLB the asset importer already understands.

Static visual geometry only: meshes are triangulated, every transform and the stage's
metersPerUnit are baked in, the up axis is normalised to glTF's +Y, and base-colour materials
(UsdPreviewSurface, OmniPBR-style MDL, ``displayColor``) become glTF base-colour factor/texture.
Everything else (PBR maps, instancing semantics, variants other than the authored selection,
animation, skinning, lights) is dropped. UsdPhysics mass/friction are reported, not baked.

The input is untrusted: textures are only read from the input's own directory or package.
Requires the optional ``usd`` extra (``usd-core``, ``Pillow``).
"""

from __future__ import annotations

import argparse
import io
import json
import struct
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

USD_EXTENSIONS = (".usd", ".usda", ".usdc", ".usdz")
MAX_TRIANGLES = 2_000_000
MAX_TEXTURE_SIZE = 2048
DEFAULT_COLOR = (0.8, 0.8, 0.8, 1.0)

_Z_UP_TO_Y_UP = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=np.float64)


class UsdImportError(ValueError):
    """The asset cannot be converted (unreadable, empty, or over the size budget)."""


@dataclass
class _Material:
    color: tuple[float, float, float, float] = DEFAULT_COLOR
    texture: bytes | None = None
    texture_key: str | None = None

    @property
    def key(self) -> tuple:
        return (self.color, self.texture_key)


@dataclass
class UsdConversion:
    """Result of :func:`convert_usd_to_glb`."""

    glb: bytes
    triangles: int
    bounds_min: list[float]
    bounds_max: list[float]
    source_up_axis: str
    meters_per_unit: float
    warnings: list[str] = field(default_factory=list)
    physics: dict = field(default_factory=dict)

    def info(self) -> dict:
        return {
            "triangles": self.triangles,
            "boundsMin": self.bounds_min,
            "boundsMax": self.bounds_max,
            "sourceUpAxis": self.source_up_axis,
            "metersPerUnit": self.meters_per_unit,
            "warnings": self.warnings,
            "physics": self.physics,
        }


def _import_pxr():
    try:
        from pxr import Ar, Gf, Sdf, Usd, UsdGeom, UsdPhysics, UsdShade  # noqa: F401
    except ImportError as error:  # pragma: no cover - depends on the optional extra
        raise UsdImportError(
            "USD import needs the optional 'usd' extra (usd-core). "
            "Install it with: uv sync --project integrations/python --extra usd"
        ) from error
    return Ar, Sdf, Usd, UsdGeom, UsdPhysics, UsdShade


class _TextureReader:
    def __init__(self, Ar, root: Path, warnings: list[str]):
        self._Ar = Ar
        self._root = root.resolve()
        self._cache: dict[str, bytes | None] = {}
        self._warnings = warnings

    def _allowed(self, resolved: str) -> bool:
        # Packaged assets resolve to "<package.usdz>[inner/path.png]".
        outer = resolved.split("[", 1)[0]
        try:
            Path(outer).resolve().relative_to(self._root)
        except (ValueError, OSError):
            return False
        return True

    def read(self, resolved: str) -> tuple[str, bytes] | None:
        if resolved in self._cache:
            data = self._cache[resolved]
            return (resolved, data) if data else None
        data = None
        if not resolved or not self._allowed(resolved):
            self._warnings.append(f"Texture outside the asset was ignored: {resolved or '<unresolved>'}")
        else:
            try:
                from PIL import Image, ImageFile

                # Real-world textures often carry bad ancillary-chunk CRCs (e.g. iCCP); tolerate them.
                ImageFile.LOAD_TRUNCATED_IMAGES = True
                asset = self._Ar.GetResolver().OpenAsset(self._Ar.ResolvedPath(resolved))
                if asset is None:
                    raise OSError("not found")
                image = Image.open(io.BytesIO(bytes(asset.GetBuffer())))
                image.load()
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                image.thumbnail((MAX_TEXTURE_SIZE, MAX_TEXTURE_SIZE))
                out = io.BytesIO()
                image.save(out, "PNG")
                data = out.getvalue()
            except Exception as error:  # unsupported formats (EXR, TGA variants...) are non-fatal
                self._warnings.append(f"Texture could not be read ({resolved}): {error}")
        self._cache[resolved] = data
        return (resolved, data) if data else None


def _asset_path(attr, Sdf) -> str:
    """The resolved path of an asset-valued attribute, falling back to layer-relative lookup."""
    value = attr.Get()
    if value is None:
        return ""
    if value.resolvedPath:
        return value.resolvedPath
    for spec in attr.GetPropertyStack():
        candidate = Sdf.ComputeAssetPathRelativeToLayer(spec.layer, value.path)
        if candidate and Path(candidate).exists():
            return candidate
    return ""


def _connected_shader(shader_input, UsdShade):
    sources, _invalid = shader_input.GetConnectedSources()
    if not sources:
        return None
    return UsdShade.Shader(sources[0].source.GetPrim())


def _scalar(value, size: int):
    if value is None:
        return None
    try:
        values = [float(v) for v in value]
    except TypeError:
        values = [float(value)]
    return values[:size] if len(values) >= size else None


def _material_from_prim(material_prim, Sdf, UsdShade, textures: _TextureReader, cache: dict) -> _Material:
    key = str(material_prim.GetPath())
    if key in cache:
        return cache[key]
    result = _Material()
    material = UsdShade.Material(material_prim)
    shader = None
    for contexts in ("mdl", ""):
        try:
            shader = material.ComputeSurfaceSource(contexts)
        except Exception:
            shader = None
        if isinstance(shader, tuple):
            shader = shader[0]
        if shader and shader.GetPrim().IsValid():
            break
        shader = None
    if shader is None:
        cache[key] = result
        return result

    color = list(DEFAULT_COLOR)
    texture_attr = None
    texture_scale = None

    def constant(name):
        inp = shader.GetInput(name)
        if inp and not inp.HasConnectedSource():
            return _scalar(inp.Get(), 3)
        return None

    shader_id = shader.GetIdAttr().Get()
    if shader_id == "UsdPreviewSurface":
        diffuse = shader.GetInput("diffuseColor")
        if diffuse:
            if diffuse.HasConnectedSource():
                tex_shader = _connected_shader(diffuse, UsdShade)
                if tex_shader and tex_shader.GetIdAttr().Get() == "UsdUVTexture":
                    file_input = tex_shader.GetInput("file")
                    if file_input:
                        texture_attr = file_input.GetAttr()
                    scale = tex_shader.GetInput("scale")
                    texture_scale = _scalar(scale.Get(), 3) if scale else None
            else:
                rgb = _scalar(diffuse.Get(), 3)
                if rgb:
                    color[:3] = rgb
        opacity = shader.GetInput("opacity")
        if opacity and not opacity.HasConnectedSource() and opacity.Get() is not None:
            color[3] = float(opacity.Get())
    else:
        # OmniPBR / AperturePBR style MDL: the base colour is a texture and/or a constant.
        for name in ("diffuse_texture", "albedo_texture", "base_color_texture"):
            inp = shader.GetInput(name)
            if inp and inp.Get() is not None and inp.Get().path:
                texture_attr = inp.GetAttr()
                break
        for name in ("diffuse_color_constant", "albedo_add", "base_color"):
            rgb = constant(name)
            if rgb:
                color[:3] = rgb
                break
        tint = constant("diffuse_tint")
        if tint:
            color[:3] = [c * t for c, t in zip(color[:3], tint)]
            texture_scale = tint

    if texture_attr is not None:
        loaded = textures.read(_asset_path(texture_attr, Sdf))
        if loaded:
            result.texture_key, result.texture = loaded
            color[:3] = list(texture_scale) if texture_scale else [1.0, 1.0, 1.0]
    result.color = tuple(round(float(c), 6) for c in color)
    cache[key] = result
    return result


def _display_color(mesh, UsdGeom) -> tuple[float, float, float, float] | None:
    primvar = UsdGeom.PrimvarsAPI(mesh.GetPrim()).GetPrimvar("displayColor")
    if not primvar or not primvar.HasValue():
        return None
    values = primvar.ComputeFlattened()
    if values is None or len(values) == 0:
        return None
    rgb = np.asarray(values, dtype=np.float64).reshape(-1, 3).mean(axis=0)
    return (*[round(float(c), 6) for c in rgb], 1.0)


_UV_NAMES = ("st", "st0", "st_0", "uv", "UVMap")


def _uv_corners(mesh, indices: np.ndarray, counts: np.ndarray, UsdGeom) -> np.ndarray | None:
    """Per-corner UVs (one row per entry of faceVertexIndices), or None if the mesh has none."""
    api = UsdGeom.PrimvarsAPI(mesh.GetPrim())
    candidates = [
        pv
        for pv in api.GetPrimvars()
        if pv.HasValue()
        and (pv.GetTypeName().role == "TextureCoordinate" or pv.GetPrimvarName() in _UV_NAMES)
    ]
    # Prefer the conventional names, otherwise the first texture-coordinate primvar (e.g. st_0).
    candidates.sort(key=lambda pv: 0 if pv.GetPrimvarName() in _UV_NAMES else 1)
    primvar = candidates[0] if candidates else None
    if primvar is None:
        return None
    values = primvar.ComputeFlattened()
    if values is None:
        return None
    values = np.asarray(values, dtype=np.float64).reshape(-1, 2)
    interpolation = primvar.GetInterpolation()
    if interpolation in ("vertex", "varying") and len(values) > indices.max(initial=-1):
        return values[indices]
    if len(values) == len(indices):  # faceVarying
        return values
    if interpolation == "uniform" and len(values) == len(counts):
        return np.repeat(values, counts, axis=0)
    if interpolation == "constant" and len(values) == 1:
        return np.repeat(values, len(indices), axis=0)
    return None


def _triangulate(counts: np.ndarray):
    """Fan-triangulate polygons; returns (corner0, corner1, corner2, source face) arrays."""
    triangles_per_face = np.clip(counts - 2, 0, None)
    total = int(triangles_per_face.sum())
    face = np.repeat(np.arange(len(counts)), triangles_per_face)
    starts = np.cumsum(counts) - counts
    first_tri = np.cumsum(triangles_per_face) - triangles_per_face
    k = np.arange(total) - np.repeat(first_tri, triangles_per_face)
    base = starts[face]
    return base, base + k + 1, base + k + 2, face


def _subset_materials(mesh, num_faces: int, UsdGeom, UsdShade):
    """Per-face index of the GeomSubset that owns it (-1 for none) and the subset prims."""
    owner = np.full(num_faces, -1, dtype=np.int64)
    subsets = []
    for subset in UsdShade.MaterialBindingAPI(mesh.GetPrim()).GetMaterialBindSubsets():
        faces = np.asarray(subset.GetIndicesAttr().Get() or [], dtype=np.int64)
        faces = faces[(faces >= 0) & (faces < num_faces)]
        owner[faces] = len(subsets)
        subsets.append(subset.GetPrim())
    return owner, subsets


def _collect_physics(stage, root, UsdPhysics, Usd) -> dict:
    physics: dict = {}
    masses = []
    for prim in Usd.PrimRange(root):
        if prim.HasAPI(UsdPhysics.MassAPI):
            mass = UsdPhysics.MassAPI(prim).GetMassAttr().Get()
            if mass and mass > 0:
                masses.append(float(mass))
        if prim.HasAPI(UsdPhysics.MaterialAPI):
            api = UsdPhysics.MaterialAPI(prim)
            dynamic = api.GetDynamicFrictionAttr().Get()
            static = api.GetStaticFrictionAttr().Get()
            if dynamic is not None and "dynamicFriction" not in physics:
                physics["dynamicFriction"] = round(float(dynamic), 6)
            if static is not None and "staticFriction" not in physics:
                physics["staticFriction"] = round(float(static), 6)
        if prim.HasAPI(UsdPhysics.RigidBodyAPI):
            physics["rigidBody"] = True
    if masses:
        physics["mass"] = round(float(sum(masses)), 6)
    return physics


def _pad(data: bytes, fill: bytes = b"\x00") -> bytes:
    return data + fill * (-len(data) % 4)


def _write_glb(groups: dict, materials: dict) -> bytes:
    """groups: material key -> (positions, uvs|None, triangle indices). Returns GLB bytes."""
    blob = bytearray()
    views, accessors, primitives, gltf_materials, textures, images = [], [], [], [], [], []
    image_index: dict[str, int] = {}

    def add_view(data: bytes, target: int | None = None) -> int:
        offset = len(blob)
        blob.extend(_pad(data))
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target:
            view["target"] = target
        views.append(view)
        return len(views) - 1

    def add_accessor(array: np.ndarray, component: int, kind: str, target: int, bounds=False) -> int:
        accessor = {
            "bufferView": add_view(array.tobytes(), target),
            "componentType": component,
            "count": int(len(array)),
            "type": kind,
        }
        if bounds:
            accessor["min"] = array.min(axis=0).astype(float).tolist()
            accessor["max"] = array.max(axis=0).astype(float).tolist()
        accessors.append(accessor)
        return len(accessors) - 1

    for key, (positions, uvs, tris) in groups.items():
        material = materials[key]
        pbr = {"baseColorFactor": list(material.color), "metallicFactor": 0.0, "roughnessFactor": 0.8}
        if material.texture is not None and uvs is not None:
            if material.texture_key not in image_index:
                images.append({"bufferView": add_view(material.texture), "mimeType": "image/png"})
                textures.append({"source": len(images) - 1})
                image_index[material.texture_key] = len(textures) - 1
            pbr["baseColorTexture"] = {"index": image_index[material.texture_key]}
        gltf_material = {"pbrMetallicRoughness": pbr, "doubleSided": True}
        if material.color[3] < 1.0:
            gltf_material["alphaMode"] = "BLEND"
        gltf_materials.append(gltf_material)
        attributes = {"POSITION": add_accessor(positions.astype("<f4"), 5126, "VEC3", 34962, True)}
        if uvs is not None:
            attributes["TEXCOORD_0"] = add_accessor(uvs.astype("<f4"), 5126, "VEC2", 34962)
        primitives.append(
            {
                "attributes": attributes,
                "indices": add_accessor(tris.astype("<u4").reshape(-1), 5125, "SCALAR", 34963),
                "material": len(gltf_materials) - 1,
                "mode": 4,
            }
        )

    document = {
        "asset": {"version": "2.0", "generator": "robotic_studio.usd_import"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "usd_asset"}],
        "meshes": [{"primitives": primitives}],
        "materials": gltf_materials,
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": views,
        "accessors": accessors,
    }
    if images:
        document["images"] = images
        document["textures"] = textures
    json_chunk = _pad(json.dumps(document, separators=(",", ":")).encode(), b" ")
    bin_chunk = bytes(blob)
    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    return (
        struct.pack("<III", 0x46546C67, 2, total)
        + struct.pack("<II", len(json_chunk), 0x4E4F534A)
        + json_chunk
        + struct.pack("<II", len(bin_chunk), 0x004E4942)
        + bin_chunk
    )


def convert_usd_to_glb(source: str | Path) -> UsdConversion:
    """Convert a USD asset to a Y-up, metre-scaled GLB. Raises :class:`UsdImportError`."""
    Ar, Sdf, Usd, UsdGeom, UsdPhysics, UsdShade = _import_pxr()
    path = Path(source)
    if path.suffix.lower() not in USD_EXTENSIONS or not path.is_file():
        raise UsdImportError(f"Expected a {'/'.join(USD_EXTENSIONS)} file: {path}")
    warnings: list[str] = []
    try:
        stage = Usd.Stage.Open(str(path))
    except Exception as error:
        raise UsdImportError(f"Could not open USD file: {error}") from error
    if stage is None:
        raise UsdImportError("Could not open USD file.")

    up_axis = str(UsdGeom.GetStageUpAxis(stage))
    mpu = float(UsdGeom.GetStageMetersPerUnit(stage) or 1.0)
    root = stage.GetDefaultPrim() if stage.HasDefaultPrim() else stage.GetPseudoRoot()
    if not root or not root.IsValid():
        root = stage.GetPseudoRoot()
    rotation = _Z_UP_TO_Y_UP if up_axis == "Z" else np.eye(3)

    textures = _TextureReader(Ar, path.parent, warnings)
    material_cache: dict = {}
    xforms = UsdGeom.XformCache(Usd.TimeCode.Default())
    # material key -> accumulated (positions, uvs, triangles); a mesh without UVs gets zeros.
    pieces: dict = {}
    materials: dict = {}
    triangle_count = 0

    predicate = Usd.TraverseInstanceProxies(Usd.PrimDefaultPredicate)
    for prim in Usd.PrimRange(root, predicate):
        if not prim.IsA(UsdGeom.Mesh):
            continue
        imageable = UsdGeom.Imageable(prim)
        if imageable.ComputeVisibility() == UsdGeom.Tokens.invisible:
            continue
        if imageable.ComputePurpose() not in (UsdGeom.Tokens.default_, UsdGeom.Tokens.render):
            continue
        mesh = UsdGeom.Mesh(prim)
        points = mesh.GetPointsAttr().Get()
        counts = mesh.GetFaceVertexCountsAttr().Get()
        indices = mesh.GetFaceVertexIndicesAttr().Get()
        if not points or not counts or not indices:
            continue
        points = np.asarray(points, dtype=np.float64)
        counts = np.asarray(counts, dtype=np.int64)
        indices = np.asarray(indices, dtype=np.int64)
        if indices.max() >= len(points) or indices.min() < 0 or counts.sum() != len(indices):
            warnings.append(f"Skipped malformed mesh {prim.GetPath()}")
            continue

        matrix = np.array(xforms.GetLocalToWorldTransform(prim), dtype=np.float64)
        world = points @ matrix[:3, :3] + matrix[3, :3]
        world = (world * mpu) @ rotation.T
        flip = (np.linalg.det(matrix[:3, :3]) < 0) != (mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded)

        c0, c1, c2, face = _triangulate(counts)
        if flip:
            c1, c2 = c2, c1
        uv_corner = _uv_corners(mesh, indices, counts, UsdGeom)

        owner, subset_prims = _subset_materials(mesh, len(counts), UsdGeom, UsdShade)
        bound, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
        default_material = (
            _material_from_prim(bound.GetPrim(), Sdf, UsdShade, textures, material_cache)
            if bound
            else _Material()
        )
        if not bound:
            color = _display_color(mesh, UsdGeom)
            if color:
                default_material = _Material(color=color)
        subset_materials = []
        for subset_prim in subset_prims:
            sub_bound, _ = UsdShade.MaterialBindingAPI(subset_prim).ComputeBoundMaterial()
            subset_materials.append(
                _material_from_prim(sub_bound.GetPrim(), Sdf, UsdShade, textures, material_cache)
                if sub_bound
                else default_material
            )

        tri_owner = owner[face]
        for slot in np.unique(tri_owner):
            material = default_material if slot < 0 else subset_materials[slot]
            selected = tri_owner == slot
            corners = np.stack([c0[selected], c1[selected], c2[selected]], axis=1).reshape(-1)
            vertex_ids = indices[corners]
            if uv_corner is not None:
                uv = uv_corner[corners].copy()
                uv[:, 1] = 1.0 - uv[:, 1]
                keyed = np.concatenate([vertex_ids[:, None].astype(np.float64), uv], axis=1)
            else:
                keyed = vertex_ids[:, None].astype(np.float64)
            unique, inverse = np.unique(keyed, axis=0, return_inverse=True)
            positions = world[unique[:, 0].astype(np.int64)]
            uvs = unique[:, 1:3] if uv_corner is not None else None
            tris = inverse.reshape(-1, 3)
            materials.setdefault(material.key, material)
            pieces.setdefault(material.key, []).append((positions, uvs, tris))
            triangle_count += len(tris)
        if triangle_count > MAX_TRIANGLES:
            raise UsdImportError(f"The asset exceeds the {MAX_TRIANGLES} triangle import limit.")

    if not pieces:
        raise UsdImportError("The USD file contains no visible mesh geometry.")

    groups = {}
    for key, parts in pieces.items():
        has_uv = any(uvs is not None for _, uvs, _ in parts)
        offset, positions, uvs, tris = 0, [], [], []
        for part_positions, part_uvs, part_tris in parts:
            positions.append(part_positions)
            uvs.append(part_uvs if part_uvs is not None else np.zeros((len(part_positions), 2)))
            tris.append(part_tris + offset)
            offset += len(part_positions)
        groups[key] = (np.concatenate(positions), np.concatenate(uvs) if has_uv else None, np.concatenate(tris))

    all_points = np.concatenate([g[0] for g in groups.values()])
    return UsdConversion(
        glb=_write_glb(groups, materials),
        triangles=triangle_count,
        bounds_min=[round(float(v), 6) for v in all_points.min(axis=0)],
        bounds_max=[round(float(v), 6) for v in all_points.max(axis=0)],
        source_up_axis=up_axis,
        meters_per_unit=mpu,
        warnings=sorted(set(warnings)),
        physics=_collect_physics(stage, root, UsdPhysics, Usd),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Convert a USD/USDZ asset to a Y-up, metre GLB.")
    parser.add_argument("input", help="Path to a .usd/.usda/.usdc/.usdz file")
    parser.add_argument("output", help="Path of the GLB to write")
    parser.add_argument("--info-json", help="Also write conversion metadata (bounds, physics, warnings)")
    args = parser.parse_args(argv)
    try:
        result = convert_usd_to_glb(args.input)
    except UsdImportError as error:
        print(f"usd-import: {error}", file=sys.stderr)
        return 2
    Path(args.output).write_bytes(result.glb)
    if args.info_json:
        Path(args.info_json).write_text(json.dumps(result.info(), indent=2), encoding="utf-8")
    print(json.dumps(result.info()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
