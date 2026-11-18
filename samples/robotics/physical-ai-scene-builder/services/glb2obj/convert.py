# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import argparse
from pathlib import Path

import trimesh
from trimesh.exchange.obj import export_obj


def convert_glb_to_obj(
    input_glb_path: str, output_obj_path: str, simulation_ready: bool = False
) -> None:
    source = Path(input_glb_path)
    if not source.is_file():
        raise FileNotFoundError(f"Could not find '{source}'")

    scene = trimesh.load_scene(source)
    if not scene.geometry or any(
        not isinstance(mesh, trimesh.Trimesh) or not len(mesh.faces)
        for mesh in scene.geometry.values()
    ):
        raise ValueError("The generated GLB must contain triangle meshes.")
    if simulation_ready:
        faces = sum(len(scene.geometry[scene.graph[node][1]].faces) for node in scene.graph.nodes_geometry)
        if faces > 5_000:
            raise ValueError(
                f"Generated mesh has {faces} triangles; the simulation limit is 5000. "
                "Update and restart TRELLIS.2 to enable simulation-ready export."
            )
    for index, mesh in enumerate(scene.geometry.values()):
        if isinstance(mesh.visual, trimesh.visual.texture.TextureVisuals):
            image = mesh.visual.material.to_simple().image
            if simulation_ready and image is not None and max(image.size) > 512:
                raise ValueError("Generated textures exceed the simulation limit of 512 pixels.")
            # obj2mjcf deletes material_0* as temporary artifacts, including source textures.
            mesh.visual.material.name = f"generated_{index}"

    output = Path(output_obj_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    material_name = output.with_suffix(".mtl").name
    # The scene exporter bakes every node transform and preserves mesh instances and UVs.
    text, artifacts = export_obj(scene, return_texture=True, mtl_name=material_name)
    if material_name not in artifacts:
        text = f"mtllib {material_name}\nusemtl untextured\n{text}"
        artifacts[material_name] = b"newmtl untextured\nKd 0.8 0.8 0.8\n"
    for filename, contents in artifacts.items():
        if Path(filename).name != filename:
            raise ValueError(f"Unexpected exported filename: {filename}")
        (output.parent / filename).write_bytes(contents)
    output.write_text(text, encoding="utf-8")
    print(f"Done: {output.name}, {material_name}, {len(artifacts) - 1} texture(s)")
    if simulation_ready:
        print(f"Compact simulation profile: {faces} visual triangles, textures at most 512 x 512")


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert a GLB mesh to OBJ + MTL + textures.")
    parser.add_argument("input_glb", help="Path to the source GLB file")
    parser.add_argument("output_obj", help="Path to write the OBJ file and sibling assets")
    parser.add_argument("--simulation-ready", action="store_true", help="Validate the editor mesh and texture budgets.")
    args = parser.parse_args()
    convert_glb_to_obj(args.input_glb, args.output_obj, args.simulation_ready)


if __name__ == "__main__":
    main()
