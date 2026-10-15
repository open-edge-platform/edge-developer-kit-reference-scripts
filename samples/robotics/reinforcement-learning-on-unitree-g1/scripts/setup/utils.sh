#!/usr/bin/env bash
set -euo pipefail

SETUP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="$(cd -- "$SETUP_DIR/.." && pwd)"
APP_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
THIRD_PARTY_DIR="$APP_ROOT/third_party"
PATCH_DIR="$SETUP_DIR/patches"

die() {
	printf 'error: %s\n' "$*" >&2
	exit 1
}

clone_at_ref() {
	local url="$1" revision="$2" path="$3" branch="${4:-}"
	if [[ -d "$path/.git" ]]; then
		local actual
		actual="$(git -C "$path" rev-parse HEAD)"
		[[ "$actual" == "$revision"* ]] || die "$path is at $actual, expected $revision; refusing to reset it"
	elif [[ -e "$path" ]]; then
		die "$path exists but is not a Git checkout"
	else
		mkdir -p "$(dirname -- "$path")"
		git clone --filter=blob:none --no-checkout "$url" "$path"
		git -C "$path" fetch --depth 1 origin "$revision"
		if [[ -n "$branch" ]]; then
			git -C "$path" checkout -b "$branch" FETCH_HEAD
		else
			git -C "$path" checkout --detach FETCH_HEAD
		fi
		local actual
		actual="$(git -C "$path" rev-parse HEAD)"
		[[ "$actual" == "$revision"* ]] || die "$url $revision resolved to $actual, expected $revision"
	fi
}

apply_patch_once() {
	local repo="$1" patch="$2"
	[[ -f "$patch" ]] || die "required patch not found: $patch"
	if git -C "$repo" apply --reverse --check "$patch" >/dev/null 2>&1; then
		return
	fi
	git -C "$repo" apply --check "$patch" || die "patch does not apply cleanly: $patch"
	git -C "$repo" apply "$patch"
}