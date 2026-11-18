# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Create deterministic scene bundles and profiles for benchmark runs.

``--scene toy`` (default) writes a tiny slide-joint scene for smoke runs. ``--scene so101`` writes the
SO-101 Generate sample (robot, table, cube, container, as in the physics regression test) with two
cameras, the fixture the throughput baseline uses.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import zipfile
from pathlib import Path
from typing import Any


SCENE_XML = """<mujoco model="robotic-studio-benchmark">
  <option timestep="0.002" gravity="0 0 -9.81"/>
  <worldbody>
    <geom name="floor" type="plane" size="1 1 0.1" rgba="0.2 0.2 0.2 1"/>
    <body name="arm" pos="0 0 0.12">
      <joint name="arm_slide" type="slide" axis="1 0 0" range="-0.4 0.4" limited="true"/>
      <geom type="capsule" fromto="0 0 0 0.25 0 0" size="0.035" mass="1" rgba="0.2 0.5 0.8 1"/>
      <site name="arm_tip" pos="0.25 0 0" size="0.012"/>
    </body>
    <body name="asset_cube" pos="0.35 0 0.05">
      <freejoint name="cube_free"/>
      <geom name="cube_geom" type="box" size="0.025 0.025 0.025" mass="0.05" rgba="0.8 0.3 0.2 1"/>
    </body>
    <camera name="front" pos="0.7 -0.7 0.55" xyaxes="0.707 0.707 0 -0.3 0.3 0.9"/>
    <camera name="side" pos="-0.6 -0.5 0.45" xyaxes="0.64 -0.77 0 0.35 0.29 0.89"/>
  </worldbody>
  <actuator><position name="arm_position" joint="arm_slide" ctrlrange="-0.4 0.4" kp="80"/></actuator>
</mujoco>
"""


def build_fixture(destination: Path, *, width: int = 640, height: int = 480) -> tuple[Path, Path]:
    destination.mkdir(parents=True, exist_ok=True)
    scene_path = destination / 'benchmark.mujoco-scene'
    profile_path = destination / 'benchmark-profile.json'
    fingerprint = 'sha256:' + hashlib.sha256(SCENE_XML.encode()).hexdigest()
    manifest = {
        'version': 1,
        'sceneName': 'Native runtime benchmark fixture',
        'entrypoint': 'scene.xml',
        'files': [],
    }
    with zipfile.ZipFile(scene_path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', json.dumps(manifest))
        archive.writestr('scene.xml', SCENE_XML)
    profile = {
        'version': 1,
        'name': 'benchmark-fixture',
        'sceneId': 'benchmark-fixture',
        'sceneFingerprint': fingerprint,
        'profileId': 'benchmark-fixture',
        'inputConvention': 'raw',
        'state': [{'name': 'arm_slide.pos', 'source': {'kind': 'qpos', 'component': 'arm_slide'}}],
        'action': [{'name': 'arm_slide', 'actuator': 'arm_position', 'controlRange': [-0.4, 0.4]}],
        'cameras': [
            {'camera': 'front', 'outputName': 'front', 'width': width, 'height': height},
            {'camera': 'side', 'outputName': 'side', 'width': width, 'height': height},
        ],
        'captureRgb': True,
        'captureFps': 30,
        'physicsSteps': 4,
        'randomization': [],
    }
    profile_path.write_text(json.dumps(profile, indent=2) + '\n', encoding='utf-8')
    return scene_path, profile_path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
SO101_ROBOT_XML = REPOSITORY_ROOT / 'samples' / 'so101-environment' / 'robots' / 'so101' / 'so101_new_calib.xml'
SO101_ARM_JOINTS = ('shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper')
# Poses from the SO-101 Generate sample scene (payload/src/seed/so101.ts), as in the physics test.
SO101_ROBOT_BASE = (-0.577447, -0.092209, 0.80605)
SO101_CUBE_POSITION = (-0.305027, 0.059617, 0.830368)
SO101_CONTAINER_POSITION = (-0.310196, -0.089869, 0.807)
SO101_TIMESTEP = 0.002
SO101_CAPTURE_FPS = 30


def _so101_scene() -> tuple[str, dict[str, bytes], Any]:
    import mujoco

    spec = mujoco.MjSpec.from_file(str(SO101_ROBOT_XML))
    mesh_root = SO101_ROBOT_XML.parent / (spec.meshdir or '')
    spec.meshdir = ''
    assets: dict[str, bytes] = {}
    for mesh in spec.meshes:
        path = f'assets/{Path(mesh.file).name}'
        assets[path] = (mesh_root / mesh.file).read_bytes()
        mesh.file = path
    spec.option.timestep = SO101_TIMESTEP
    spec.body('base').pos = SO101_ROBOT_BASE
    world = spec.worldbody

    def box(parent: Any, name: str, pos: tuple[float, ...], size: tuple[float, ...], **fields: Any) -> None:
        parent.add_geom(name=name, type=mujoco.mjtGeom.mjGEOM_BOX, pos=pos, size=size, **fields)

    box(world, 'table_top', (0.0, 0.0, 0.75), (0.6, 0.8, 0.05))
    box(world, 'asset_pad_geom', (-0.305027, 0.059617, 0.810868), (0.05, 0.05, 0.007), friction=(1, 0.005, 0.0001))
    cube = world.add_body(name='asset_cube', pos=SO101_CUBE_POSITION)
    cube.add_freejoint()
    box(cube, 'asset_cube_geom', (0.0, 0.0, 0.0), (0.0125, 0.0125, 0.0125), mass=0.01, friction=(1, 0.005, 0.0001))
    container = world.add_body(name='container', pos=SO101_CONTAINER_POSITION)
    box(container, 'container_bottom', (0, 0, 0.0025), (0.0375, 0.0375, 0.0025))
    box(container, 'container_front', (0, -0.035, 0.0225), (0.0375, 0.0025, 0.0175))
    box(container, 'container_back', (0, 0.035, 0.0225), (0.0375, 0.0025, 0.0175))
    box(container, 'container_left', (-0.035, 0, 0.0225), (0.0025, 0.0325, 0.0175))
    box(container, 'container_right', (0.035, 0, 0.0225), (0.0025, 0.0325, 0.0175))
    world.add_light(name='key', pos=(0.0, 0.0, 2.0), dir=(0.0, 0.0, -1.0))
    world.add_camera(name='front', pos=(0.15, -0.45, 1.25), xyaxes=(0.83, 0.56, 0, -0.33, 0.49, 0.81))
    world.add_camera(name='side', pos=(-0.3, -0.75, 1.05), xyaxes=(1, 0, 0, 0, 0.6, 0.8))
    # Mesh paths stay relative to the robot directory, so the spec compiles from the sample files.
    model = spec.compile()
    return spec.to_xml(), assets, model


def _so101_profile(scene_xml: str, model: Any, width: int, height: int) -> dict[str, Any]:
    import mujoco

    action = []
    for name in SO101_ARM_JOINTS:
        actuator = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_ACTUATOR, name)
        action.append(
            {
                'name': name,
                'actuator': name,
                'controlRange': [float(value) for value in model.actuator_ctrlrange[actuator]],
            }
        )
    return {
        'version': 1,
        'name': 'so101-benchmark-fixture',
        'sceneId': 'so101-benchmark-fixture',
        'sceneFingerprint': 'sha256:' + hashlib.sha256(scene_xml.encode()).hexdigest(),
        'profileId': 'so101-benchmark-fixture',
        'inputConvention': 'raw',
        'state': [{'name': f'{name}.pos', 'source': {'kind': 'qpos', 'component': name}} for name in SO101_ARM_JOINTS],
        'action': action,
        'cameras': [
            {'camera': 'front', 'outputName': 'front', 'width': width, 'height': height},
            {'camera': 'side', 'outputName': 'side', 'width': width, 'height': height},
        ],
        'captureRgb': True,
        'captureFps': SO101_CAPTURE_FPS,
        # Physics steps per recorded frame at captureFps, as FrameClock schedules them in Generate.
        'physicsSteps': max(1, math.floor(1.0 / SO101_CAPTURE_FPS / SO101_TIMESTEP + 0.5)),
        'randomization': [],
    }


def build_so101_fixture(destination: Path, *, width: int = 640, height: int = 480) -> tuple[Path, Path]:
    """Write the SO-101 sample scene with two cameras as a scene bundle plus a Generate profile."""
    destination.mkdir(parents=True, exist_ok=True)
    scene_path = destination / 'so101.mujoco-scene'
    profile_path = destination / 'so101-profile.json'
    scene_xml, assets, model = _so101_scene()
    manifest = {
        'version': 1,
        'sceneName': 'SO-101 benchmark fixture',
        'entrypoint': 'scene.xml',
        'files': [
            {'path': path, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
            for path, data in sorted(assets.items())
        ],
    }
    with zipfile.ZipFile(scene_path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', json.dumps(manifest))
        archive.writestr('scene.xml', scene_xml)
        for path, data in sorted(assets.items()):
            archive.writestr(path, data)
    profile = _so101_profile(scene_xml, model, width, height)
    profile_path.write_text(json.dumps(profile, indent=2) + '\n', encoding='utf-8')
    return scene_path, profile_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=Path('integrations/python/benchmarks/fixtures'))
    parser.add_argument('--scene', choices=('toy', 'so101'), default='toy', help='Fixture scene to write.')
    parser.add_argument('--resolution', default='640x480')
    arguments = parser.parse_args()
    width, separator, height = arguments.resolution.lower().partition('x')
    if not separator or not width.isdigit() or not height.isdigit():
        raise SystemExit('--resolution must be WIDTHxHEIGHT.')
    builder = build_so101_fixture if arguments.scene == 'so101' else build_fixture
    scene, profile = builder(arguments.output_dir, width=int(width), height=int(height))
    print(json.dumps({'sceneBundle': str(scene), 'profile': str(profile)}))


if __name__ == '__main__':
    main()
