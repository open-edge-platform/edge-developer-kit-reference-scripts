// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Files from `integrations/python/examples`, shipped under `python/`. */
export const CONTROL_EXAMPLE_FILES = [
  'AGENTS.md',
  'skills/so101-pick-and-place/SKILL.md',
  'teleoperation_joint_control.py',
  'so101/pick_and_place.py',
  'so101/generate_dataset.py',
  'so101/keyboard.py',
] as const;

/** Source-only ROS workspace inventory; never copy environments, build outputs, or external repos. */
export const ROS2_CONTROL_FILES = [
  'README.md',
  'pixi.toml',
  'pixi.lock',
  'upstream-ros-deps.repos',
  'scripts/activate.sh',
  'src/robotic_studio_interfaces/CMakeLists.txt',
  'src/robotic_studio_interfaces/package.xml',
  'src/robotic_studio_interfaces/msg/BridgeStatus.msg',
  'src/robotic_studio_interfaces/srv/SelectInitialState.srv',
  'src/robotic_studio_interfaces/srv/StartRecording.srv',
  'src/robotic_studio_interfaces/srv/StopRecording.srv',
  'src/robotic_studio_ros/package.xml',
  'src/robotic_studio_ros/setup.cfg',
  'src/robotic_studio_ros/setup.py',
  'src/robotic_studio_ros/resource/robotic_studio_ros',
  'src/robotic_studio_ros/robotic_studio_ros/__init__.py',
  'src/robotic_studio_ros/robotic_studio_ros/bridge.py',
  'src/robotic_studio_ros/robotic_studio_ros/cameras.py',
  'src/robotic_studio_ros/robotic_studio_ros/mapping.py',
  'src/robotic_studio_ros/robotic_studio_ros/node.py',
  'src/robotic_studio_ros/launch/bridge.launch.py',
  'src/robotic_studio_ros/launch/bridge-so-arm101.launch.py',
  'src/robotic_studio_ros/config/bridge.rviz',
  'src/robotic_studio_ros/config/so_arm101.rviz',
  'src/robotic_studio_rviz/CMakeLists.txt',
  'src/robotic_studio_rviz/package.xml',
  'src/robotic_studio_rviz/plugin_description.xml',
  'src/robotic_studio_rviz/include/robotic_studio_rviz/panel_state.hpp',
  'src/robotic_studio_rviz/include/robotic_studio_rviz/studio_control_panel.hpp',
  'src/robotic_studio_rviz/src/panel_state.cpp',
  'src/robotic_studio_rviz/src/studio_control_panel.cpp',
] as const;

export async function readPythonProjectSources(
  projectRoot: string,
): Promise<Record<string, string>> {
  const pendingDirectories = [projectRoot];
  const relativePaths: string[] = [];
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) continue;
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '__pycache__' || entry.name === '.venv') continue;
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        relativePaths.push(path.relative(projectRoot, absolutePath).split(path.sep).join('/'));
      }
    }
  }

  relativePaths.sort();
  const files = await Promise.all(
    relativePaths.map(
      async (relativePath) =>
        [
          `robotic_studio/${relativePath}`,
          await readFile(path.join(projectRoot, relativePath), 'utf8'),
        ] as const,
    ),
  );
  return Object.fromEntries(files);
}

export async function readControlBundle(
  integrationRoot: string,
  sceneName: string,
): Promise<Record<string, string>> {
  const examplesRoot = path.join(integrationRoot, 'examples');
  const rosRoot = path.resolve(integrationRoot, '../ros2');
  const [readme, pythonFiles, pythonSources, rosFiles] = await Promise.all([
    readFile(/* turbopackIgnore: true */ path.join(examplesRoot, 'control-README.md'), 'utf8'),
    Promise.all(
      [
        ['README.md', path.join(examplesRoot, 'README.md')],
        ['pyproject.toml', path.join(integrationRoot, 'pyproject.toml')],
        ['uv.lock', path.join(integrationRoot, 'uv.lock')],
        // Makes uv pick Python 3.13 (see the requires-python comment in pyproject.toml).
        ['.python-version', path.join(integrationRoot, '.python-version')],
        ...CONTROL_EXAMPLE_FILES.map((name) => [name, path.join(examplesRoot, name)]),
      ].map(async ([name, source]) => {
        const contents = await readFile(/* turbopackIgnore: true */ source, 'utf8');
        return [
          `python/${name}`,
          name === 'README.md' ? contents.replaceAll('{{sceneName}}', sceneName) : contents,
        ] as const;
      }),
    ),
    readPythonProjectSources(path.join(integrationRoot, 'robotic_studio')),
    Promise.all(
      ROS2_CONTROL_FILES.map(
        async (name) =>
          [
            `ros2/${name}`,
            await readFile(/* turbopackIgnore: true */ path.join(rosRoot, name), 'utf8'),
          ] as const,
      ),
    ),
  ]);
  return {
    'README.md': readme.replaceAll('{{sceneName}}', sceneName),
    ...Object.fromEntries(pythonFiles),
    ...Object.fromEntries(
      Object.entries(pythonSources).map(([name, contents]) => [`python/${name}`, contents]),
    ),
    ...Object.fromEntries(rosFiles),
  };
}
