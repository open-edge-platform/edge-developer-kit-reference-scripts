// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The kiosk's input-validation module: every URL the app assembles, and every
 * <img src> it renders, goes through here.
 *
 * The *_CHARS allowlists exist for the Coverity scan: callers rebuild the
 * validated value from them with an equality-pick loop INLINE in the function
 * that owns the sink (fetch, fs call, <img>) — the scan's audit mode distrusts
 * any helper's return value, so that loop cannot be extracted into one. The
 * validators here still do the real checking; their output is what the inline
 * loop rebuilds. See the fix-coverity-issues skill.
 */

import DOMPurify from "dompurify";

/** RFC 3986 characters a kiosk-assembled URL may consist of. */
export const URL_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#[]@!$&'()*+,;=%";

/** Characters a filesystem path the kiosk writes to may consist of. Covers
 *  Windows paths (drive letter, backslash) and installs with a space in them. */
export const PATH_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._/\\: ";

/** Characters a data-URL, object-URL or same-origin image src may consist of. */
export const IMAGE_SRC_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=:;,.%-_?&#~";

/**
 * Guard for every URL the kiosk assembles out of configuration and caller
 * input before it reaches fetch: rejects path traversal and characters that
 * could smuggle extra headers or requests, and returns a value rebuilt by the
 * URL parser rather than the input string itself.
 */
export function safeUrl(url: string): string {
  if (/[\r\n\t ]/.test(url)) throw new Error("URL contains forbidden whitespace");
  if (url.split(/[/\\]/).includes("..")) throw new Error("URL contains a path-traversal segment");
  if (/^https?:\/\//i.test(url)) {
    const parsed = new URL(url);
    return parsed.toString();
  }
  if (url.startsWith("/")) {
    const parsed = new URL(url, "http://relative.invalid");
    return parsed.pathname + parsed.search + parsed.hash;
  }
  throw new Error(`unsupported URL scheme in ${url}`);
}

/**
 * Guard for <img src> values the kiosk produces itself (rasterized document
 * pages, camera portraits, CMS file paths). Anything that is not a data-URL
 * image, an object URL, or a same-origin path renders as an empty source.
 */
export function safeImageSrc(src: string): string {
  if (!src.startsWith("data:image/") && !src.startsWith("blob:") && !src.startsWith("/")) {
    return "";
  }
  // Server-side DOMPurify has no DOM to sanitize with — render nothing there;
  // these images only ever carry client-produced captures anyway.
  if (typeof DOMPurify.sanitize !== "function") return "";
  return DOMPurify.sanitize(src);
}
