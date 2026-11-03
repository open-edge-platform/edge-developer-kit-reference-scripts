#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

APP_NAME="pallet-defect-detection"
SAMPLE_APP="pallet-defect-detection"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SUITE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
SETUP_SCRIPT="$SUITE_ROOT/setup.sh"
SUITE_DIR="$SCRIPT_DIR/src"
COMPOSE_FILE="$SUITE_DIR/docker-compose.yml"
ENV_FILE="$SUITE_DIR/.env"
ENV_TEMPLATE="$SUITE_DIR/.env_${SAMPLE_APP}"
# Upstream nginx config, never modified in place.
NGINX_CONF="$SUITE_DIR/apps/${SAMPLE_APP}/configs/nginx/nginx.conf"
# Patched copy, kept outside the cloned src/ and mounted by the compose override.
PATCHED_NGINX_CONF="$SCRIPT_DIR/nginx.conf"
# Upstream DL Streamer pipeline config, never modified in place.
PS_CONFIG="$SUITE_DIR/apps/${SAMPLE_APP}/configs/pipeline-server-config.json"
# Patched (looped) copy, likewise outside src/ and mounted by the override.
PATCHED_PS_CONFIG="$SCRIPT_DIR/pipeline-server-config.json"
SETUP_SENTINEL="$SUITE_DIR/.demo-studio-${SAMPLE_APP}-ready"
# Where upstream's apps/<app>/setup.sh downloads the model and clip (its ../../resources/<app>).
MODEL_DIR="$SUITE_DIR/resources/$SAMPLE_APP/models/$SAMPLE_APP"
VIDEO_DIR="$SUITE_DIR/resources/$SAMPLE_APP/videos"
VIDEO_FILE="$VIDEO_DIR/warehouse.avi"

# Port / device overrides
PDD_HTTP_PORT="${PDD_HTTP_PORT:-80}"
PDD_HTTPS_PORT="${PDD_HTTPS_PORT:-443}"
PDD_COTURN_PORT="${PDD_COTURN_PORT:-3478}"
PDD_S3_PORT="${PDD_S3_PORT:-8000}"
PDD_DEVICE="${PDD_DEVICE:-CPU}"
# Loop the finite warehouse.avi clip so the WebRTC demo runs continuously. Disable with --no-loop
# or PDD_LOOP=false.
PDD_LOOP="${PDD_LOOP:-true}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --http-port)   PDD_HTTP_PORT="$2";   shift 2 ;;
    --https-port)  PDD_HTTPS_PORT="$2";  shift 2 ;;
    --coturn-port) PDD_COTURN_PORT="$2"; shift 2 ;;
    --s3-port)     PDD_S3_PORT="$2";     shift 2 ;;
    --device)      PDD_DEVICE="$2";      shift 2 ;;
    --loop)        PDD_LOOP="true";       shift ;;
    --no-loop)     PDD_LOOP="false";      shift ;;
    *) shift ;;
  esac
done

OVERRIDE_FILE="$SCRIPT_DIR/compose.override.yml"

log() { echo "[$APP_NAME] $*"; }

# Checked before anything starts: step 7 builds the launch payload with jq.
if ! command -v jq >/dev/null 2>&1; then
  log "ERROR: jq is required to launch the pipeline. Install jq and rerun."
  exit 1
fi

detect_host_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | awk '/src/ {for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')" || true
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')" || true
  fi
  [ -n "$ip" ] || ip="127.0.0.1"
  echo "$ip"
}

# PDD_DEVICE (+ loop) -> pipeline name. CPU loops with the upstream `_mlops` pipeline (multifilesrc
# loop=TRUE); GPU/NPU have no looping variant, so prepare_pipeline_config injects the loop.
select_pipeline() {
  local d
  d="$(echo "$PDD_DEVICE" | tr '[:upper:]' '[:lower:]')"
  case "$d" in
    gpu|gpu.*) echo "pallet_defect_detection_gpu" ;;
    npu)       echo "pallet_defect_detection_npu" ;;
    *)
      if [ "$PDD_LOOP" = "true" ]; then
        echo "pallet_defect_detection_mlops"
      else
        echo "pallet_defect_detection"
      fi
      ;;
  esac
}

# Step 1: clone upstream src
log "Running suite setup ($SETUP_SCRIPT $APP_NAME)"
bash "$SETUP_SCRIPT" "$APP_NAME"

if [ ! -f "$COMPOSE_FILE" ]; then
  log "ERROR: docker-compose.yml not found at $COMPOSE_FILE"
  exit 1
fi
if [ ! -f "$ENV_TEMPLATE" ]; then
  log "ERROR: .env template not found at $ENV_TEMPLATE"
  exit 1
fi

# Step 2: generate .env from the template
HOST_IP="${HOST_IP:-$(detect_host_ip)}"
# The SeaweedFS S3 store's credentials; upstream's setup.sh also makes them
# the login of nginx's /storage/ page.
S3_USER_VAL="${S3_STORAGE_USERNAME:-intel1234}"
S3_PASS_VAL="${S3_STORAGE_PASSWORD:-intel1234}"
MTX_USER_VAL="${MTX_WEBRTCICESERVERS2_0_USERNAME:-intel1234}"
MTX_PASS_VAL="${MTX_WEBRTCICESERVERS2_0_PASSWORD:-intel1234}"

upsert_env() {
  local key="$1" value="$2" file="$3"
  if grep -q -E "^${key}=" "$file" 2>/dev/null; then
    # escape | for sed delimiter
    local escaped
    escaped="$(printf '%s' "$value" | sed -e 's|[\\&|]|\\&|g')"
    sed -i -E "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    # Some upstream templates lack a final newline; add one so the key isn't glued to the last entry.
    if [ -s "$file" ] && [ -n "$(tail -c1 "$file")" ]; then
      printf '\n' >> "$file"
    fi
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

log "Generating $ENV_FILE from template"
cp "$ENV_TEMPLATE" "$ENV_FILE"

upsert_env HOST_IP                          "$HOST_IP"             "$ENV_FILE"
upsert_env S3_STORAGE_USERNAME              "$S3_USER_VAL"         "$ENV_FILE"
upsert_env S3_STORAGE_PASSWORD              "$S3_PASS_VAL"         "$ENV_FILE"
upsert_env MTX_WEBRTCICESERVERS2_0_USERNAME "$MTX_USER_VAL"        "$ENV_FILE"
upsert_env MTX_WEBRTCICESERVERS2_0_PASSWORD "$MTX_PASS_VAL"        "$ENV_FILE"
upsert_env NGINX_HTTP_PORT                  "$PDD_HTTP_PORT"       "$ENV_FILE"
upsert_env NGINX_HTTPS_PORT                 "$PDD_HTTPS_PORT"      "$ENV_FILE"
upsert_env COTURN_UDP_PORT                  "$PDD_COTURN_PORT"     "$ENV_FILE"
upsert_env S3_STORAGE_HOST_PORT             "$PDD_S3_PORT"         "$ENV_FILE"
upsert_env SAMPLE_APP                       "$SAMPLE_APP"          "$ENV_FILE"
upsert_env APP_DIR                          "$SUITE_DIR/apps/$SAMPLE_APP" "$ENV_FILE"

# Proxy passthrough
for var in http_proxy https_proxy no_proxy HTTP_PROXY HTTPS_PROXY NO_PROXY; do
  if [ -n "${!var:-}" ]; then
    upsert_env "$var" "${!var}" "$ENV_FILE"
  fi
done

# Step 3: patch nginx.conf for an HTTP healthcheck into $PATCHED_NGINX_CONF, mounted over
# /etc/nginx/nginx.conf by the compose override (step 5).
prepare_nginx_conf() {
  if [ ! -f "$NGINX_CONF" ]; then
    log "ERROR: Nginx config not found at $NGINX_CONF"
    return 1
  fi

  log "Writing patched nginx.conf with HTTP /nginx_healthz endpoint to $PATCHED_NGINX_CONF"

  # Add an exact-match /nginx_healthz location, and move the HTTPS redirect into `location /`: a
  # server-level `return 301` runs in the rewrite phase, before location matching, and would
  # swallow the probe. skip_health drops a health block already in the source (idempotent re-runs).
  if ! awk '
    /Demo Studio polls this endpoint over HTTP/ { skip_health = 1; next }
    skip_health && /^[[:space:]]*location[[:space:]]*=[[:space:]]*\/nginx_healthz[[:space:]]*\{/ { next }
    skip_health && /^[[:space:]]*return[[:space:]]+200[[:space:]]+"ok\\n";/ { next }
    skip_health && /^[[:space:]]*add_header[[:space:]]+Content-Type[[:space:]]+text\/plain;/ { next }
    skip_health && /^[[:space:]]*\}/ { skip_health = 0; next }
    !inserted && $0 ~ /^[[:space:]]*listen[[:space:]]+80;/ {
      print
      print ""
      print "        # Demo Studio polls this endpoint over HTTP before enabling the sample."
      print "        location = /nginx_healthz {"
      print "            return 200 \"ok\\n\";"
      print "            add_header Content-Type text/plain;"
      print "        }"
      print ""
      inserted = 1
      next
    }
    inserted && !redirected && $0 ~ /^[[:space:]]*return[[:space:]]+301[[:space:]]+https:\/\/\$host\$request_uri;/ {
      print "        # Demo Studio redirects remaining HTTP requests to HTTPS."
      print "        location / {"
      print "            return 301 https://$host$request_uri;"
      print "        }"
      redirected = 1
      next
    }
    { print }
    END { if (!inserted || !redirected) exit 42 }
  ' "$NGINX_CONF" > "$PATCHED_NGINX_CONF"; then
    rm -f "$PATCHED_NGINX_CONF"
    log "ERROR: Failed to inject HTTP health endpoint into nginx.conf"
    return 1
  fi
}

prepare_nginx_conf

# Step 4: run upstream setup.sh (downloads model + video)
# Upstream exits 0 when a download fails (curl without -f, errors unchecked) and takes a videos/
# folder left by a failed download as done, so the files themselves are checked.
model_ready() { [ -n "$(find "$MODEL_DIR" -name '*.xml' -print -quit 2>/dev/null)" ]; }
# An AVI starts with RIFF; a failed download leaves nothing or an error page.
video_ready() { [ "$(head -c 4 "$VIDEO_FILE" 2>/dev/null)" = "RIFF" ]; }

remove_partial() {
  if ! rm -rf "$1"; then
    log "ERROR: could not remove the partial download $1 — run: sudo rm -rf $1"
    exit 1
  fi
}

ensure_artifacts() {
  if [ -f "$SETUP_SENTINEL" ] && model_ready && video_ready; then
    log "Sample artifacts already downloaded (sentinel: $SETUP_SENTINEL)"
    return
  fi

  rm -f "$SETUP_SENTINEL"
  model_ready || remove_partial "$MODEL_DIR"
  video_ready || remove_partial "$VIDEO_DIR"

  log "Running upstream setup.sh — downloads model + video for $SAMPLE_APP"
  chmod +x "$SUITE_DIR/setup.sh" 2>/dev/null || true
  (cd "$SUITE_DIR" && bash ./setup.sh)

  if ! model_ready; then
    log "ERROR: the model did not download to $MODEL_DIR (see upstream setup.sh output above)"
    exit 1
  fi
  if ! video_ready; then
    log "ERROR: warehouse.avi did not download to $VIDEO_FILE (see upstream setup.sh output above)"
    exit 1
  fi

  touch "$SETUP_SENTINEL"
  log "Sample artifact setup complete"
}

ensure_artifacts

# Step 4b: patch the pipeline config for looped playback
# The stock pipelines' `{auto_source}` plays warehouse.avi once, ending the WebRTC stream. CPU loops
# via `_mlops` (see select_pipeline); GPU/NPU get `multifilesrc loop=TRUE` injected here.
prepare_pipeline_config() {
  local pipeline
  pipeline="$(select_pipeline)"

  if [ "$PDD_LOOP" != "true" ]; then
    rm -f "$PATCHED_PS_CONFIG"
    log "Looped playback disabled (PDD_LOOP=$PDD_LOOP) — using stock pipeline config"
    return 0
  fi
  if [ "$pipeline" = "pallet_defect_detection_mlops" ]; then
    rm -f "$PATCHED_PS_CONFIG"
    log "Looped playback via upstream-native '$pipeline' pipeline (no config injection)"
    return 0
  fi
  if [ ! -f "$PS_CONFIG" ]; then
    log "ERROR: pipeline-server-config.json not found at $PS_CONFIG"
    return 1
  fi

  # Container-side video path taken from the launch payload's source uri.
  local payload_file="$SUITE_DIR/apps/$SAMPLE_APP/payload.json" video_uri video_path
  video_uri="$(jq -r '[.[].payload.source.uri] | map(select(. != null)) | .[0] // empty' "$payload_file" 2>/dev/null)" || video_uri=""
  video_path="${video_uri#file://}"
  [ -n "$video_path" ] || video_path="/home/pipeline-server/resources/videos/warehouse.avi"

  log "Enabling looped playback for '$pipeline' (multifilesrc loop=TRUE, source=$video_path) — patched config at $PATCHED_PS_CONFIG"
  jq --arg vid "$video_path" '
    .config.pipelines |= map(
      if (.pipeline | type) == "string"
      then .pipeline |= gsub("\\{auto_source\\} name=source ! decodebin3";
             "multifilesrc loop=TRUE location=" + $vid + " name=source ! h264parse ! decodebin3")
      else . end)
  ' "$PS_CONFIG" > "$PATCHED_PS_CONFIG"
}

prepare_pipeline_config

# Step 5: generate the compose override (patched configs, proxy env)
generate_override() {
  local http_p="${http_proxy:-${HTTP_PROXY:-}}"
  local https_p="${https_proxy:-${HTTPS_PROXY:-}}"
  local has_proxy=false
  [[ -n "$http_p" || -n "$https_p" ]] && has_proxy=true

  local no_p=""
  if $has_proxy; then
    no_p="${no_proxy:-${NO_PROXY:-}}"
    for cidr in localhost 127.0.0.1 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 "$HOST_IP"; do
      [[ "$no_p" == *"$cidr"* ]] || no_p="${no_p:+$no_p,}$cidr"
    done
    for svc in dlstreamer-pipeline-server mediamtx mediamtx-server coturn mqtt-broker nginx seaweedfs-master seaweedfs-volume seaweedfs-filer seaweedfs-s3 prometheus otel-collector; do
      [[ "$no_p" == *"$svc"* ]] || no_p="${no_p:+$no_p,}$svc"
    done
  fi

  log "Generating compose override (proxy detected: $has_proxy)"

  emit_proxy_env() {
    local indent="$1"
    printf '%s- http_proxy=%s\n%s- https_proxy=%s\n%s- HTTP_PROXY=%s\n%s- HTTPS_PROXY=%s\n%s- no_proxy=%s\n%s- NO_PROXY=%s\n' \
      "$indent" "$http_p" "$indent" "$https_p" "$indent" "$http_p" "$indent" "$https_p" "$indent" "$no_p" "$indent" "$no_p"
  }

  {
    cat <<'HEADER'
# Auto-generated by start.sh — do not edit manually.
services:
HEADER

    # Volumes merge by container path, so this replaces only the nginx.conf mount; the base ssl
    # mount and depends_on stay.
    printf '  nginx:\n'
    printf '    volumes:\n      - "%s:/etc/nginx/nginx.conf:ro"\n' "$PATCHED_NGINX_CONF"
    if $has_proxy; then
      printf '    environment:\n'
      emit_proxy_env "      "
    fi

    # Looped pipeline config (when enabled) and/or proxy env; replaces only the config.json mount.
    if [ -f "$PATCHED_PS_CONFIG" ] || $has_proxy; then
      printf '  dlstreamer-pipeline-server:\n'
      if [ -f "$PATCHED_PS_CONFIG" ]; then
        printf '    volumes:\n      - "%s:/home/pipeline-server/config.json"\n' "$PATCHED_PS_CONFIG"
      fi
      if $has_proxy; then
        printf '    environment:\n'
        emit_proxy_env "      "
      fi
    fi

    if $has_proxy; then
      for service in mediamtx coturn mqtt-broker prometheus otel-collector; do
        printf '  %s:\n    environment:\n' "$service"
        emit_proxy_env "      "
      done
    fi
  } > "$OVERRIDE_FILE"
}

generate_override

# Docker creates a missing bind-mount source as root. Pre-create the nested CA
# directory too; creating only ssl/ still lets Docker own CAs/.
mkdir -p "$SUITE_DIR/apps/$SAMPLE_APP/Certificates/ssl/CAs"

# Step 6: bring up the docker compose stack
COMPOSE_ARGS=(--env-file "$ENV_FILE" -f "$COMPOSE_FILE")
if [ -f "$OVERRIDE_FILE" ] && [ -s "$OVERRIDE_FILE" ] && ! grep -q '^{}$' "$OVERRIDE_FILE"; then
  COMPOSE_ARGS+=(-f "$OVERRIDE_FILE")
fi

existing_containers="$(cd "$SUITE_DIR" && docker compose "${COMPOSE_ARGS[@]}" ps -q 2>/dev/null)" || existing_containers=""
if [ -n "$existing_containers" ]; then
  log "Stack is already running — bringing it down before restart"
  (cd "$SUITE_DIR" && docker compose "${COMPOSE_ARGS[@]}" down) || true
fi

wait_for_healthy() {
  local timeout_seconds="${1:-600}"
  local poll_interval_seconds=5
  local elapsed_seconds=0

  log "Waiting for all containers to become healthy (timeout: ${timeout_seconds}s)..."

  while [ "$elapsed_seconds" -lt "$timeout_seconds" ]; do
    local starting=0
    local containers
    containers=$(cd "$SUITE_DIR" && docker compose "${COMPOSE_ARGS[@]}" ps -q 2>/dev/null)

    if [ -z "$containers" ]; then
      log "ERROR: No containers found after start"
      return 1
    fi

    while IFS= read -r cid; do
      local name state health
      name=$(docker inspect --format '{{.Name}}' "$cid" 2>/dev/null | sed 's|^/||')
      state=$(docker inspect --format '{{.State.Status}}' "$cid" 2>/dev/null)
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null)

      if [ "$state" = "exited" ] || [ "$state" = "dead" ]; then
        log "ERROR: Container $name stopped unexpectedly (state: $state)"
        return 1
      fi
      if [ "$health" = "starting" ]; then
        starting=$((starting + 1))
      elif [ "$health" = "none" ] && [ "$state" != "running" ]; then
        starting=$((starting + 1))
      fi
    done <<< "$containers"

    if [ "$starting" -eq 0 ]; then
      log "All containers are healthy"
      return 0
    fi

    sleep "$poll_interval_seconds"
    elapsed_seconds=$((elapsed_seconds + poll_interval_seconds))
    log "Waiting for $starting container(s) to become healthy... (${elapsed_seconds}/${timeout_seconds}s)"
  done

  log "ERROR: Timed out after ${timeout_seconds}s — some containers are still not healthy"
  return 1
}

cleanup() {
  log "Received shutdown signal — running 'docker compose down'"
  (cd "$SUITE_DIR" && docker compose "${COMPOSE_ARGS[@]}" down) || true
}
trap cleanup EXIT INT TERM

log "Starting docker compose stack (detached)"
cd "$SUITE_DIR"
docker compose "${COMPOSE_ARGS[@]}" up -d
wait_for_healthy 600

# Step 7: launch the AI pipeline
PIPELINE_NAME="$(select_pipeline)"
log "Launching DL Streamer pipeline '$PIPELINE_NAME' on device '$PDD_DEVICE'"

# Not upstream's sample_start.sh: it posts to HOST_IP, which must stay the LAN IP for WebRTC ICE,
# and a host can't always reach its own published ports via that IP (WSL2 has no hairpin route).
# POST over loopback instead.
PAYLOAD_FILE="$SUITE_DIR/apps/$SAMPLE_APP/payload.json"
if [ ! -f "$PAYLOAD_FILE" ]; then
  log "ERROR: payload file not found at $PAYLOAD_FILE"
  exit 1
fi

PIPELINE_PAYLOAD="$(jq -c --arg name "$PIPELINE_NAME" \
  'map(select(.pipeline == $name)) | .[0].payload // empty' "$PAYLOAD_FILE")"
if [ -z "$PIPELINE_PAYLOAD" ]; then
  # Looping pipelines like `_mlops` aren't in payload.json and bake in their source: use the base
  # entry's payload without `source`.
  PIPELINE_PAYLOAD="$(jq -c \
    'map(select(.pipeline == "pallet_defect_detection")) | .[0].payload | del(.source)' "$PAYLOAD_FILE")"
fi
if [ -z "$PIPELINE_PAYLOAD" ] || [ "$PIPELINE_PAYLOAD" = "null" ]; then
  log "ERROR: no payload for pipeline '$PIPELINE_NAME' in $PAYLOAD_FILE"
  exit 1
fi

LAUNCH_URL="https://127.0.0.1:${PDD_HTTPS_PORT}/api/pipelines/user_defined_pipelines/${PIPELINE_NAME}"

# Retry briefly: dlstreamer-pipeline-server may need a moment after compose
# reports healthy before its REST API responds.
attempt=0
max_attempts=12
while [ "$attempt" -lt "$max_attempts" ]; do
  response="$(curl -s -k --max-time 10 -o /dev/null -w '%{http_code}' \
    -X POST "$LAUNCH_URL" \
    -H 'Content-Type: application/json' \
    -d "$PIPELINE_PAYLOAD" 2>/dev/null)" || response="000"
  if [ "$response" = "200" ]; then
    log "Pipeline '$PIPELINE_NAME' started successfully"
    break
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$max_attempts" ]; then
    log "ERROR: Failed to launch pipeline '$PIPELINE_NAME' after $max_attempts attempts (last HTTP $response)"
    exit 1
  fi
  log "Pipeline launch not ready (attempt $attempt/$max_attempts, HTTP $response) — retrying in 5s"
  sleep 5
done

log "Stack is up — UI available at https://${HOST_IP}:${PDD_HTTPS_PORT}/ (WebRTC stream: https://${HOST_IP}:${PDD_HTTPS_PORT}/mediamtx/pdd/)"

# Foreground tail so the frontend sees an active PID and forwards container logs.
docker compose "${COMPOSE_ARGS[@]}" logs -f
