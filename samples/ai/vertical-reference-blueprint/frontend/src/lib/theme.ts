// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Class-based dark mode: `.dark` on <html> switches the token palette in
 * globals.css. Light is the default; the choice persists per device.
 *
 * The preference rides on a cookie rather than localStorage so the root
 * layout can put the class on <html> server-side, in the first byte of HTML.
 * An inline script would do the same job, but a <script> inside the React
 * tree never runs on a client re-mount, and React warns about exactly that.
 *
 * Deliberately not a "use client" module: a Server Component importing from
 * one gets a client reference back, not the string.
 */
export const THEME_COOKIE = "kiosk-theme";

/** A year: the choice is per device, and a kiosk is rarely reinstalled. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
