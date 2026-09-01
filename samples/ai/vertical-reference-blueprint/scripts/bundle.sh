#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# Build the embedded bundle: a minimal (non-Electron) Edge AI Studio export with
# the Vertical Reference Blueprint injected as a studio sample, started by the studio as a
# hidden worker process — like the Edge AI suites.
#
# Invoked by ./build.sh (bundle args pass through), or directly. See
# docs/embedded-studio.md.
set -euo pipefail

# shellcheck source=scripts/common.sh disable=SC1091
. "$(cd "$(dirname "$0")" && pwd)/common.sh"

MODE="" OUT="" PORT="${KIOSK_BUNDLE_PORT:-8035}" INSTALL=0 SKIP_STAGE=0 ALLOW_MISSING=0
BRAND="${STUDIO_BRAND_NAME:-Vertical Reference Blueprint}"

usage() {
  cat <<EOF
Usage: scripts/bundle.sh [options]   (also reached via: ./build.sh -- [options])

Produces build/kiosk-studio/: a minimal source export of the Edge AI Studio
(no Electron) carrying only the AI services the kiosk needs, with the kiosk
injected as a studio sample. The studio starts the kiosk as a hidden child
process (workers/public-service-kiosk) and its samples gallery links to the kiosk UI.

Options:
  --mode <touch|chat|agent>  kiosk terminal mode; decides the exported services
                             (touch: text-generation+ocr+face; chat/agent: all five)
                             default: the kiosk's configured mode ($(kiosk_terminal_mode))
  --out <dir>                output directory (default: <repo>/build/kiosk-studio)
  --port <n>                 port the embedded kiosk listens on (default: 8035)
  --install                  run the bundle's own setup.sh afterwards (npm install,
                             worker venvs, frontend build — long, downloads a lot)
  --skip-stage               reuse the existing kiosk stage (tauri/src-tauri/resources)
  --allow-missing            build even if the studio checkout lacks some of the
                             mode's services (default: hard error — no silent
                             fallback to degraded/mocked kiosk features)
  --brand <name>             display name the exported studio is rebranded to
                             (default: "Vertical Reference Blueprint"; also via
                             STUDIO_BRAND_NAME)
  -h, --help                 this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) shift; MODE="${1:-}" ;;
    --out) shift; OUT="${1:-}" ;;
    --port) shift; PORT="${1:-}" ;;
    --install) INSTALL=1 ;;
    --skip-stage) SKIP_STAGE=1 ;;
    --allow-missing) ALLOW_MISSING=1 ;;
    --brand) shift; BRAND="${1:-}"; [ -n "$BRAND" ] || die "--brand needs a value" ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
  shift
done

MODE="${MODE:-$(kiosk_terminal_mode)}"
OUT="${OUT:-$REPO_ROOT/build/kiosk-studio}"
STUDIO_OUT="$OUT/studio"
TEMPLATES="$REPO_ROOT/scripts/bundle"
STAGE="$TAURI_DIR/src-tauri/resources"

case "$MODE" in
  touch) SERVICES="text-generation,ocr,face-recognition" ;;
  chat|agent) SERVICES="text-generation,ocr,face-recognition,speech-to-text,text-to-speech" ;;
  *) die "unsupported kiosk mode: $MODE" ;;
esac

require_node
studio_present || die "Edge AI Studio not found at $EDGE_AI_STUDIO_DIR (set EDGE_AI_STUDIO_DIR)"
[ -f "$EDGE_AI_STUDIO_DIR/export.sh" ] || die "$EDGE_AI_STUDIO_DIR/export.sh not found — this studio checkout has no export support"

# The studio's service roster changes across branches (face-recognition lives
# on a feature branch until it merges). Never degrade silently: a service the
# kiosk mode needs but the checkout lacks is a hard error — the fix is to
# check out the studio branch that has it. --allow-missing is the explicit
# opt-in to build a reduced bundle anyway.
MISSING_SERVICES=""
AVAILABLE=""
for s in ${SERVICES//,/ }; do
  if [ -f "$EDGE_AI_STUDIO_DIR/frontend/src/services/$s/data.ts" ]; then
    AVAILABLE="$AVAILABLE,$s"
  else
    MISSING_SERVICES="$MISSING_SERVICES $s"
  fi
done
if [ -n "$MISSING_SERVICES" ]; then
  if [ "$ALLOW_MISSING" -eq 1 ]; then
    warn "building WITHOUT$MISSING_SERVICES (--allow-missing) — those kiosk features will be degraded"
    SERVICES="${AVAILABLE#,}"
    [ -n "$SERVICES" ] || die "none of the kiosk's services exist in this studio checkout"
  else
    die "this studio checkout ($EDGE_AI_STUDIO_DIR) is missing:$MISSING_SERVICES
'$MODE' mode needs them. Check out the studio branch that provides them
(git -C \"\$EDGE_AI_STUDIO_DIR\" branch -a), or pass --allow-missing to
knowingly build a reduced bundle without them."
  fi
fi

info "Embedded bundle: mode=$MODE, services=$SERVICES, kiosk port=$PORT"
info "Output: $OUT"

# 1. Stage the kiosk's standalone server (server + assets + primed db + config)
if [ "$SKIP_STAGE" -eq 1 ] && [ -d "$STAGE/server" ]; then
  info "Reusing existing kiosk stage ($STAGE)"
  if [ -n "$(find "$FRONTEND_DIR/src" "$FRONTEND_DIR/package.json" -newer "$STAGE/config.yaml" -print -quit 2>/dev/null)" ]; then
    warn "the reused stage is OLDER than the current frontend sources — a stale"
    warn "stage can crash the embedded kiosk (module mismatches); drop --skip-stage to rebuild it"
  fi
else
  info "Staging the kiosk server (tauri stage, mode=$MODE, live AI)"
  (cd "$TAURI_DIR" && npm run stage -- --mode="$MODE" --live)
fi
[ -d "$STAGE/server" ] || die "kiosk stage failed — $STAGE/server missing"

# 2. Register the kiosk in the studio checkout, temporarily, so the studio's
# own samples-driven exporter can resolve it: `--samples=public-service-kiosk` exports the
# kiosk sample plus exactly the services its dependency list names (required:
# text-generation + ocr; optional: face/STT/TTS — dropped by --no-optional in
# touch mode). The exporter only copies git-visible files, so the injected
# files are made visible with `git add -N` (intent-to-add — nothing is staged
# or committed) and removed again right after the export, success or failure.
SRC_SVC="$EDGE_AI_STUDIO_DIR/frontend/src/services/public-service-kiosk"
SRC_SMP="$EDGE_AI_STUDIO_DIR/frontend/src/samples/public-service-kiosk"
SRC_WRK="$EDGE_AI_STUDIO_DIR/workers/public-service-kiosk"
for d in "$SRC_SVC" "$SRC_SMP" "$SRC_WRK"; do
  [ ! -e "$d" ] || die "$d already exists in the studio checkout — remove it first (a previous bundle run may have been interrupted)"
done
git -C "$EDGE_AI_STUDIO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || die "$EDGE_AI_STUDIO_DIR is not a git checkout — the studio exporter needs one"

cleanup_studio_injection() {
  git -C "$EDGE_AI_STUDIO_DIR" reset -q -- \
    frontend/src/services/public-service-kiosk frontend/src/samples/public-service-kiosk workers/public-service-kiosk 2>/dev/null || true
  rm -rf "$SRC_SVC" "$SRC_SMP" "$SRC_WRK"
}
trap cleanup_studio_injection EXIT

info "Registering the kiosk sample in the studio checkout (temporary, via git add -N)"
mkdir -p "$SRC_SVC" "$SRC_SMP" "$SRC_WRK"
sed "s/__KIOSK_PORT__/$PORT/g" "$TEMPLATES/service-data.ts" >"$SRC_SVC/data.ts"
sed "s/__KIOSK_PORT__/$PORT/g" "$TEMPLATES/sample-data.ts" >"$SRC_SMP/data.ts"
# Drop dependency lines for services this studio version doesn't have — the
# exporter resolves deps from these literal lines and crashes on unknown ids.
for s in $MISSING_SERVICES; do
  sed -i "/serviceId: '$s'/d" "$SRC_SMP/data.ts"
done
sed "s/__KIOSK_PORT__/$PORT/g" "$TEMPLATES/worker-start.sh" >"$SRC_WRK/start.sh"
chmod +x "$SRC_WRK/start.sh"
git -C "$EDGE_AI_STUDIO_DIR" add -N \
  frontend/src/services/public-service-kiosk frontend/src/samples/public-service-kiosk workers/public-service-kiosk

# 3. Export the minimal studio (source tree; no Electron, no models)
info "Exporting the minimal studio via --samples=public-service-kiosk ($SERVICES)"
rm -rf "$STUDIO_OUT"
mkdir -p "$OUT"
EXPORT_FLAGS=(--samples=public-service-kiosk --out="$STUDIO_OUT")
[ "$MODE" = "touch" ] && EXPORT_FLAGS+=(--no-optional)
(cd "$EDGE_AI_STUDIO_DIR" && bash ./export.sh "${EXPORT_FLAGS[@]}")
cleanup_studio_injection
trap - EXIT
[ -d "$STUDIO_OUT/frontend/src" ] || die "studio export failed — $STUDIO_OUT/frontend/src missing"
[ -f "$STUDIO_OUT/frontend/src/samples/public-service-kiosk/data.ts" ] \
  || die "export did not carry the kiosk sample — check the exporter output above"

# 3a. Drop the kiosk's server payload into the exported worker
info "Copying the staged kiosk server into workers/public-service-kiosk/bundle"
WORKER="$STUDIO_OUT/workers/public-service-kiosk"
[ -f "$WORKER/start.sh" ] || die "export did not carry workers/public-service-kiosk/start.sh"
chmod +x "$WORKER/start.sh"
mkdir -p "$WORKER/bundle"
cp -r "$STAGE/server" "$WORKER/bundle/server"
cp -r "$STAGE/assets" "$WORKER/bundle/assets"
cp -r "$STAGE/database" "$WORKER/bundle/database"
cp "$STAGE/config.yaml" "$WORKER/bundle/config.yaml"

# 3b. Rebrand the exported studio: overwrite its display name everywhere in
# the frontend source (it is a hardcoded string, not a constant) before the
# frontend build bakes it into the UI, page titles and sidebar.
info "Rebranding the studio as \"$BRAND\""
BRAND_ESC="$(printf '%s' "$BRAND" | sed 's/[&/\\]/\\&/g')"
{ grep -rlE 'Edge AI Demo Studio|Demo Studio' \
    --include='*.ts' --include='*.tsx' "$STUDIO_OUT/frontend/src" 2>/dev/null || true; } \
  | while read -r f; do
      sed -i -e "s/Edge AI Demo Studio/$BRAND_ESC/g" -e "s/Demo Studio/$BRAND_ESC/g" "$f"
    done
if [ -f "$STUDIO_OUT/README.md" ]; then
  sed -i -e "s/Edge AI Demo Studio/$BRAND_ESC/g" -e "s/Demo Studio/$BRAND_ESC/g" "$STUDIO_OUT/README.md"
fi

# 4. Widen the generated registries' key types: the kiosk's id is not in the
# studio's baked Payload type union (the exporter already widens serviceMap;
# these two are the remaining union-typed spots in codegen).
CODEGEN="$STUDIO_OUT/frontend/scripts/generate-registries.mjs"
sed -i \
  -e 's/Partial<Record<Service\["type"\], WorkerConfig>>/Partial<Record<string, WorkerConfig>>/' \
  -e 's/type: Service\["type"\],/type: string,/' \
  "$CODEGEN"

# 5. Re-run codegen so the injected service + sample enter the registries
info "Regenerating studio registries"
(cd "$STUDIO_OUT/frontend" && node scripts/generate-registries.mjs)
grep -q "public-service-kiosk" "$STUDIO_OUT/frontend/src/services/_generated/meta.ts" \
  || die "codegen did not pick up the kiosk service"
grep -q "public-service-kiosk" "$STUDIO_OUT/frontend/src/samples/_generated/samples.ts" \
  || die "codegen did not pick up the kiosk sample"

# 6. Pre-seed the bundled runtimes from the studio checkout when present, so
# the bundle's setup doesn't have to download them again (it still can).
if [ -d "$EDGE_AI_STUDIO_DIR/thirdparty/node" ] && [ ! -d "$STUDIO_OUT/thirdparty/node" ]; then
  info "Seeding bundled runtimes (thirdparty/) from the studio checkout"
  mkdir -p "$STUDIO_OUT/thirdparty"
  cp -a "$EDGE_AI_STUDIO_DIR/thirdparty/node" "$STUDIO_OUT/thirdparty/node"
  [ -d "$EDGE_AI_STUDIO_DIR/thirdparty/ffmpeg" ] && cp -a "$EDGE_AI_STUDIO_DIR/thirdparty/ffmpeg" "$STUDIO_OUT/thirdparty/ffmpeg"
fi

# 7. Deployment presets: the mode's profile + auto-start for the embedded kiosk.
# (The exporter does not carry deployment.json, so the bundle gets its own.)
info "Writing bundle deployment.json ($MODE profile + public-service-kiosk autostart)"
if [ -n "${STUDIO_DEPLOYMENT_FILE:-}" ]; then
  PROFILE="$STUDIO_DEPLOYMENT_FILE"
else
  case "$MODE" in
    touch) PROFILE="$REPO_ROOT/scripts/studio-deployment.touch.json" ;;
    *) PROFILE="$REPO_ROOT/scripts/studio-deployment.chat.json" ;;
  esac
fi
python3 - "$PROFILE" "$STUDIO_OUT/deployment.json" "$SERVICES" <<'EOF'
import json, sys
profile = json.load(open(sys.argv[1]))
exported = set(sys.argv[3].split(","))
# Presets only for services this bundle actually carries.
profile["services"] = {
    k: v for k, v in profile["services"].items() if k in exported
}
profile["services"]["public-service-kiosk"] = {"status": "online"}
json.dump(profile, open(sys.argv[2], "w"), indent=2)
EOF

# 8. Bundle metadata + top-level README
cat >"$OUT/bundle.env" <<EOF
# Written by scripts/bundle.sh — read by start.sh --bundle
KIOSK_BUNDLE_MODE=$MODE
KIOSK_BUNDLE_PORT=$PORT
KIOSK_BUNDLE_BRAND="$BRAND"
EOF
cat >"$OUT/README.md" <<EOF
# Public Service Kiosk — $BRAND bundle

Minimal $BRAND (services: $SERVICES) with the Public Service Kiosk
injected as a sample. The platform starts the kiosk as a hidden worker process
and auto-starts everything per \`studio/deployment.json\`.

Built for kiosk mode: **$MODE** · kiosk port: **$PORT**

    cd studio
    sudo ./install_dependencies.sh   # once, system packages
    ./setup.sh                       # once, runtimes + worker venvs + frontend build
    ./start.sh                       # studio gateway on :8080, kiosk on :$PORT

Or from the kiosk repo: \`./start.sh --bundle\` (add \`--tauri\` for the
desktop shell). Kiosk UI: http://localhost:$PORT · studio: http://localhost:8080
EOF

ok "Bundle staged at $OUT"
if [ "$INSTALL" -eq 1 ]; then
  info "Running the bundle's setup (this installs worker environments and builds the frontend — long)"
  (cd "$STUDIO_OUT" && bash ./setup.sh)
  ok "Bundle is ready — start it with: ./start.sh --bundle"
else
  info "Next: (cd $STUDIO_OUT && bash ./setup.sh) or ./setup.sh --bundle, then ./start.sh --bundle"
fi
