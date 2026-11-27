// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { integrationPath } from '@/lib/teleoperation/sessionManager';

/** Agent skills served as MCP prompts; each is a SKILL.md beside the shipped Python skills. */
export const MCP_SKILLS = {
  replicate_scene: {
    file: 'replicate-scene',
    title: 'Replicate a scene from photos',
    description:
      'Build and check a scene that matches photos of a real robot workspace for a task, using the scene-builder tools.',
    photosArgument: 'Which attached photos to match, and anything they do not show.',
    missingInput: 'Ask the user for the photo(s) and the task before starting.',
  },
  replicate_from_dataset: {
    file: 'replicate-from-dataset',
    title: 'Replicate a scene from a robot recording',
    description:
      'Rebuild the workspace of a real robot recording (a shared LeRobot v3 dataset) in simulation: cameras, layout, objects, and start pose, scored against the recorded frames.',
    photosArgument: 'Anything the recording does not show, such as object sizes or the table size.',
    missingInput:
      'Call list_datasets; if no dataset is shared, ask the user to share the recording zip in the MCP dialog.',
  },
} as const;

export type McpSkillName = keyof typeof MCP_SKILLS;

/** Skill instructions without YAML front matter or the source license header. */
export async function readSkill(name: McpSkillName, root = integrationPath()): Promise<string> {
  const file = path.join(root, 'examples', 'skills', MCP_SKILLS[name].file, 'SKILL.md');
  const text = await readFile(/* turbopackIgnore: true */ file, 'utf8');
  return text
    .replace(/^---\n[\s\S]*?\n---\n+/, '')
    .replace(
      /^<!--\nCopyright \(C\) 2026 Intel Corporation\nSPDX-License-Identifier: Apache-2\.0\n-->\n+/,
      '',
    )
    .trim();
}

/** The prompt text: the skill, then the user's task and notes when given. */
export function skillPrompt(
  skill: string,
  task?: string,
  photos?: string,
  missingInput: string = MCP_SKILLS.replicate_scene.missingInput,
): string {
  const trimmedTask = task?.trim();
  const trimmedPhotos = photos?.trim();
  const request = [
    trimmedTask && `Task: ${trimmedTask}`,
    trimmedPhotos && `Photos: ${trimmedPhotos}`,
  ].filter(Boolean);
  return request.length
    ? `${skill}\n\n## This request\n\n${request.join('\n')}`
    : `${skill}\n\n## This request\n\n${missingInput}`;
}
