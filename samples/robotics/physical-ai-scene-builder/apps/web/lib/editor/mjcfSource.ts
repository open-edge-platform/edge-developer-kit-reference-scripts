// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { SceneNode } from '@mujoco-studio/types';

import { ELEMENT_NAMES, SENSOR_ELEMENT_NAMES } from './document';

/**
 * Text-level helpers for the MJCF source panel: a pretty-printer for display, and a locator that
 * finds the element a scene node was built from (with the same matching rules the editor uses to
 * write attributes, so the highlighted element is the one edits change).
 */

type TokenKind = 'open' | 'close' | 'self' | 'comment' | 'declaration' | 'cdata' | 'text';

interface XmlToken {
  kind: TokenKind;
  start: number;
  end: number;
  raw: string;
  /** Tag name for open/close/self tokens. */
  name: string | null;
}

const TAG_NAME = /^<\/?\s*([^\s/>]+)/;

function tokenize(xml: string): XmlToken[] | null {
  const tokens: XmlToken[] = [];
  let index = 0;
  const push = (kind: TokenKind, start: number, end: number, name: string | null = null) => {
    tokens.push({ kind, start, end, raw: xml.slice(start, end), name });
  };
  const until = (marker: string, from: number) => {
    const found = xml.indexOf(marker, from);
    return found < 0 ? -1 : found + marker.length;
  };

  while (index < xml.length) {
    if (xml[index] !== '<') {
      const next = xml.indexOf('<', index);
      const end = next < 0 ? xml.length : next;
      push('text', index, end);
      index = end;
      continue;
    }
    let end: number;
    if (xml.startsWith('<!--', index)) {
      end = until('-->', index + 4);
      if (end < 0) return null;
      push('comment', index, end);
    } else if (xml.startsWith('<![CDATA[', index)) {
      end = until(']]>', index + 9);
      if (end < 0) return null;
      push('cdata', index, end);
    } else if (xml.startsWith('<?', index) || xml.startsWith('<!', index)) {
      end = until(xml[index + 1] === '?' ? '?>' : '>', index + 2);
      if (end < 0) return null;
      push('declaration', index, end);
    } else {
      // Element tag: `>` inside quoted attribute values doesn't end the tag.
      let cursor = index + 1;
      let quote: string | null = null;
      while (cursor < xml.length) {
        const character = xml[cursor];
        if (quote) {
          if (character === quote) quote = null;
        } else if (character === '"' || character === "'") {
          quote = character;
        } else if (character === '>') {
          break;
        }
        cursor += 1;
      }
      if (cursor >= xml.length) return null;
      end = cursor + 1;
      const raw = xml.slice(index, end);
      const name = TAG_NAME.exec(raw)?.[1] ?? null;
      if (!name) return null;
      push(raw[1] === '/' ? 'close' : raw.endsWith('/>') ? 'self' : 'open', index, end, name);
    }
    index = end;
  }
  return tokens;
}

/**
 * Re-indents MJCF with one element per line (two spaces per level). Tags and attribute text are
 * kept verbatim; whitespace-only text between elements is dropped, so a document that already uses
 * this layout comes back unchanged. Returns the input unchanged if
 * it isn't well-formed enough to format safely.
 */
export function formatMjcf(xml: string): string {
  const tokens = tokenize(xml);
  if (!tokens) return xml;
  const lines: string[] = [];
  const stack: string[] = [];
  const indent = () => '  '.repeat(stack.length);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    const afterNext = tokens[index + 2];
    switch (token.kind) {
      case 'text': {
        const text = token.raw.trim();
        if (text) lines.push(`${indent()}${text}`);
        break;
      }
      case 'open': {
        // Keep `<tag></tag>` and `<tag>text</tag>` on one line.
        if (next?.kind === 'close' && next.name === token.name) {
          lines.push(`${indent()}${token.raw}${next.raw}`);
          index += 1;
          break;
        }
        if (
          next?.kind === 'text' &&
          next.raw.trim() &&
          afterNext?.kind === 'close' &&
          afterNext.name === token.name
        ) {
          lines.push(`${indent()}${token.raw}${next.raw.trim()}${afterNext.raw}`);
          index += 2;
          break;
        }
        lines.push(`${indent()}${token.raw}`);
        stack.push(token.name!);
        break;
      }
      case 'close': {
        if (stack.pop() !== token.name) return xml;
        lines.push(`${indent()}${token.raw}`);
        break;
      }
      default:
        lines.push(`${indent()}${token.raw}`);
    }
  }
  if (stack.length) return xml;
  // Keep the document's trailing newline (or lack of one) so formatted documents round-trip.
  return `${lines.join('\n')}${/\n\s*$/.test(xml) ? '\n' : ''}`;
}

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function canonicalTag(name: string, raw: string, selfClosing: boolean): string {
  const attributes: [string, string][] = [];
  const body = raw.slice(raw.indexOf(name) + name.length);
  for (const match of body.matchAll(ATTRIBUTE)) {
    const value = (match[2] ?? match[3] ?? '').trim().replace(/\s+/g, ' ');
    attributes.push([match[1], value.replaceAll('"', '&quot;')]);
  }
  attributes.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const text = attributes.map(([key, value]) => ` ${key}="${value}"`).join('');
  return `<${name}${text}${selfClosing ? '/>' : '>'}`;
}

/**
 * A layout-independent form of an MJCF document, for telling whether two documents describe the
 * same model: comments, the XML declaration, and whitespace between elements are dropped,
 * attributes are sorted with whitespace-normalized values, and empty elements are self-closed.
 * Returns the input unchanged if it isn't well-formed enough to tokenize.
 */
export function canonicalMjcf(xml: string): string {
  const tokens = tokenize(xml);
  if (!tokens) return xml;
  const parts: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === 'comment' || token.kind === 'declaration') continue;
    if (token.kind === 'text') {
      const text = token.raw.trim().replace(/\s+/g, ' ');
      if (text) parts.push(text);
      continue;
    }
    if (token.kind === 'cdata') {
      parts.push(token.raw);
      continue;
    }
    if (token.kind === 'close') {
      parts.push(`</${token.name}>`);
      continue;
    }
    // `<a></a>` (with only whitespace or comments inside) is the same element as `<a/>`.
    let next = index + 1;
    while (
      token.kind === 'open' &&
      next < tokens.length &&
      (tokens[next].kind === 'comment' ||
        (tokens[next].kind === 'text' && !tokens[next].raw.trim()))
    ) {
      next += 1;
    }
    const empty =
      token.kind === 'self' || (tokens[next]?.kind === 'close' && tokens[next].name === token.name);
    parts.push(canonicalTag(token.name!, token.raw, empty));
    if (empty && token.kind === 'open') index = next;
  }
  return parts.join('');
}

export interface MjcfElementRange {
  /** Offset of the element's opening (or self-closing) tag. */
  start: number;
  /** Offset just past the opening tag. */
  tagEnd: number;
  /** Offset just past the whole element (its closing tag, or the self-closing tag). */
  end: number;
}

interface LocatedElement extends MjcfElementRange {
  name: string;
  nameAttribute: string | null;
  parentName: string | null;
  depth: number;
}

const NAME_ATTRIBUTE = /\sname\s*=\s*(["'])([\s\S]*?)\1/;
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity);
}

function elementsOf(tokens: XmlToken[]): LocatedElement[] | null {
  const elements: LocatedElement[] = [];
  const stack: LocatedElement[] = [];
  for (const token of tokens) {
    if (token.kind === 'open' || token.kind === 'self') {
      const name = NAME_ATTRIBUTE.exec(token.raw)?.[2];
      const element: LocatedElement = {
        start: token.start,
        tagEnd: token.end,
        end: token.end,
        name: token.name!,
        nameAttribute: name === undefined ? null : decodeEntities(name),
        parentName: stack.at(-1)?.name ?? null,
        depth: stack.length,
      };
      elements.push(element);
      if (token.kind === 'open') stack.push(element);
    } else if (token.kind === 'close') {
      const element = stack.pop();
      if (!element || element.name !== token.name) return null;
      element.end = token.end;
    }
  }
  return stack.length ? null : elements;
}

/**
 * Finds the element a scene node comes from: by `name` first, then by MuJoCo index among the
 * elements of that kind in document order (mirrors `elementFor` in `document.ts`).
 */
export function locateNodeInMjcf(
  xml: string,
  node: Pick<SceneNode, 'kind' | 'name' | 'mjIndex'>,
): MjcfElementRange | null {
  const tokens = tokenize(xml);
  const elements = tokens ? elementsOf(tokens) : null;
  if (!elements) return null;

  const candidates =
    node.kind === 'sensor'
      ? elements.filter(
          (element) =>
            element.depth === 2 &&
            element.parentName === 'sensor' &&
            SENSOR_ELEMENT_NAMES.has(element.name),
        )
      : elements.filter((element) => ELEMENT_NAMES[node.kind].includes(element.name));
  if (node.kind === 'body' && node.mjIndex === 0) return null;

  const match =
    candidates.find((element) => element.nameAttribute === node.name) ??
    candidates[node.kind === 'body' ? node.mjIndex - 1 : node.mjIndex] ??
    null;
  return match ? { start: match.start, tagEnd: match.tagEnd, end: match.end } : null;
}

/** Zero-based line number of a text offset. */
export function lineAt(text: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}
