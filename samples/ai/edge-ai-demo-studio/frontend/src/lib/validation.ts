// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Validation for values that reach a fetch, a file path, a link or a media `src`. Isomorphic.
// Coverity treats a helper's return value as tainted (consts are clean), so at the sink rebuild the
// validated string inline, picking each character by equality from the matching charset const and
// throwing on a miss. In render code fail closed (empty string) instead of throwing.

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** Characters allowed in a fetched URL (RFC 3986 unreserved + reserved + `%`). */
export const URL_CHARS = `${ALNUM}-._~:/?#[]@!$&'()*+,;=%`

/** Characters allowed in an in-app link (`/services/ocr?tab=docs#top`). */
export const HREF_CHARS = `${ALNUM}-._~/?#&=%+,:@!$'()*;`

/** Characters allowed in an `<img>`/`<audio>`/`<video>` src (blob:, data:, http). */
export const MEDIA_SRC_CHARS = `${ALNUM}-._~:/?#[]@!$&'()*+,;=%`

/** Characters allowed in a downloaded URL (data:, blob: or same-origin). */
export const DOWNLOAD_CHARS = `${ALNUM}-._~:/?#[]@!$&'()*+,;=%`

/** Characters allowed in a file-system path, POSIX or Windows. */
export const PATH_CHARS = `${ALNUM}-._~/\\: @+,=()[]`

const URL_SCHEMES = ['http:', 'https:', 'ws:', 'wss:'] as const
const MEDIA_SCHEMES = ['blob:', 'http:', 'https:'] as const
const MEDIA_DATA_PREFIXES = [
  'data:image/',
  'data:audio/',
  'data:video/',
] as const

function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function hasTraversal(path: string): boolean {
  return path.split(/[/\\]/).some((segment) => segment === '..')
}

function schemeOf(value: string): string | undefined {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value)
  return match ? `${match[1].toLowerCase()}:` : undefined
}

/** `url` if a same-origin path or http(s)/ws(s) URL without control chars or `..`; throws otherwise. */
export function safeUrl(url: string): string {
  if (!url || hasControlChars(url)) throw new Error('Invalid URL')
  const scheme = schemeOf(url)
  if (scheme === undefined) {
    if (!url.startsWith('/') || url.startsWith('//')) {
      throw new Error('Invalid URL')
    }
  } else if (!URL_SCHEMES.some((allowed) => allowed === scheme)) {
    throw new Error('Invalid URL scheme')
  }
  const pathPart = url.split(/[?#]/)[0]
  if (hasTraversal(pathPart)) throw new Error('Invalid URL path')
  return url
}

/** `href` if an in-app path; anything else (`//host`, `javascript:`) becomes `/`. */
export function safeHref(href: string): string {
  if (!href || hasControlChars(href)) return '/'
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) {
    return '/'
  }
  return href
}

/** `src` if blob:, http(s):, a same-origin path or an image/audio/video data: URL; else `''`. */
export function safeMediaSrc(src: string | null | undefined): string {
  if (!src || hasControlChars(src)) return ''
  if (src.startsWith('/') && !src.startsWith('//')) return src
  const lower = src.slice(0, 16).toLowerCase()
  if (MEDIA_DATA_PREFIXES.some((prefix) => lower.startsWith(prefix))) return src
  const scheme = schemeOf(src)
  return MEDIA_SCHEMES.some((allowed) => allowed === scheme) ? src : ''
}

/** `href` if a data: or blob: URL, a same-origin path or an absolute URL on this origin; throws otherwise. */
export function safeDownloadUrl(href: string): string {
  if (!href || hasControlChars(href)) throw new Error('Invalid download URL')
  if (href.startsWith('/') && !href.startsWith('//')) {
    if (href.includes('\\')) throw new Error('Invalid download URL')
    return href
  }
  const scheme = schemeOf(href)
  if (scheme === 'data:' || scheme === 'blob:') return href
  if (
    (scheme === 'http:' || scheme === 'https:') &&
    typeof location !== 'undefined' &&
    href.startsWith(`${location.origin}/`)
  ) {
    return href
  }
  throw new Error('Invalid download URL')
}

/** Returns `path` when it has no control characters or `..` segments; throws otherwise. */
export function safeFilePath(path: string): string {
  if (!path || hasControlChars(path) || hasTraversal(path)) {
    throw new Error('Invalid file path')
  }
  return path
}
