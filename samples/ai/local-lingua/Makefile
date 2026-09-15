.PHONY: help prereq demo-prereq check build run stop clean demo-clean ensure-dirs

SHELL := /bin/bash

.DEFAULT_GOAL := help

# ─── make help ───────────────────────────────────────────────────────────────
help:
	@echo "=== Local Lingua — Available Commands ==="
	@echo ""
	@echo "  make prereq       One-time setup required for the app to run: installs"
	@echo "                    system packages, Docker, GPU/NPU device access, the"
	@echo "                    Python env, and downloads/exports the AI models."
	@echo "                    Requires internet. Run once on a fresh machine."
	@echo ""
	@echo "  make demo-prereq  Optional, on top of 'make prereq': downloads the demo"
	@echo "                    voice samples and generates the Mission Cues PDF"
	@echo "                    reference. Required before the in-app Demo button"
	@echo "                    (scripted conversations) is enabled. Requires internet."
	@echo "                    Skips work already done — pass FORCE=1 to refresh."
	@echo ""
	@echo "  make check        Verify all required dependencies/models are in place"
	@echo "                    and report what's missing."
	@echo ""
	@echo "  make build        (Re)build the app Docker image without starting it."
	@echo "                    Already run once by 'make prereq'; use this after"
	@echo "                    changing the Dockerfile/source."
	@echo ""
	@echo "  make run          Start the app (docker compose up). Builds only if no"
	@echo "                    image exists yet — pass REBUILD=1 to force a rebuild."
	@echo "                    Serves at http://localhost:7860"
	@echo ""
	@echo "  make stop         Stop the running app (docker compose down)."
	@echo ""
	@echo "  make clean        Remove generated artifacts — models, venv, data, .env."
	@echo "                    Does NOT uninstall Docker/drivers. Run 'make prereq'"
	@echo "                    again afterwards to set up from scratch."
	@echo ""
	@echo "  make demo-clean   Remove demo artifacts — downloaded voice samples and"
	@echo "                    the Mission Cues PDF. Run 'make demo-prereq' again"
	@echo "                    afterwards to re-enable the in-app Demo button."
	@echo ""

# ─── make prereq ─────────────────────────────────────────────────────────────
# One-time setup: install system packages, drivers, Docker, Python env, models.
# Requires internet. Run once on a fresh machine.
prereq:
	@echo "=== Local Lingua — Prerequisites Setup ==="
	@echo ""
	@echo "[1/6] Installing system packages..."
	@MISSING=""; \
	for p in python3 python3-venv python3-pip ffmpeg libsndfile1 espeak-ng \
	         curl ca-certificates gnupg lsb-release; do \
		dpkg-query -W -f='$${Status}' $$p 2>/dev/null | grep -q "ok installed" || MISSING="$$MISSING $$p"; \
	done; \
	if [ -n "$$MISSING" ]; then \
		echo "      Missing:$$MISSING"; \
		echo "      Installing (needs sudo)..."; \
		sudo apt-get update -qq; \
		sudo apt-get install -y --no-install-recommends $$MISSING; \
	else \
		echo "      All system packages already installed."; \
	fi
	@echo ""
	@echo "[2/6] Installing Docker (if not present)..."
	@if ! command -v docker &>/dev/null; then \
		echo "      Installing Docker..."; \
		curl -fsSL https://get.docker.com | sudo sh; \
		sudo usermod -aG docker $$(whoami); \
		echo "      Docker installed. You may need to log out and back in for group changes."; \
	else \
		echo "      Docker already installed: $$(docker --version)"; \
	fi
	@echo ""
	@echo "[3/6] Ensuring user has GPU/NPU device access..."
	@if [ -e /dev/dri/renderD128 ]; then \
		RENDER_GID=$$(stat -c '%g' /dev/dri/renderD128); \
		echo "      /dev/dri/renderD128 found (group $$RENDER_GID)"; \
		if ! id -nG $$(whoami) | grep -qw $$(stat -c '%G' /dev/dri/renderD128); then \
			echo "      Adding user to render group..."; \
			sudo usermod -aG $$RENDER_GID $$(whoami); \
			echo "      Added. You may need to log out and back in."; \
		fi; \
		bash scripts/set_env.sh RENDER_GROUP_ID $$RENDER_GID; \
		echo "      Wrote RENDER_GROUP_ID=$$RENDER_GID to .env"; \
	else \
		echo "      [!] No /dev/dri/renderD128 — GPU not available on this host."; \
		echo "      GPU inference will not work. CPU fallback will be used."; \
		bash scripts/set_env.sh RENDER_GROUP_ID 109; \
	fi
	@bash scripts/set_env.sh HOST_UID $$(id -u)
	@bash scripts/set_env.sh HOST_GID $$(id -g)
	@echo ""
	@echo "[4/6] Setting up Python environment..."
	@if command -v uv &>/dev/null; then \
		echo "      Using uv ($$(uv --version))"; \
		[ -d .venv ] || uv venv .venv --python 3.12; \
		. .venv/bin/activate && uv pip install -r requirements.txt; \
	else \
		echo "      uv not found — installing..."; \
		curl -LsSf https://astral.sh/uv/install.sh | sh 2>/dev/null; \
		export PATH="$$HOME/.local/bin:$$PATH"; \
		if command -v uv &>/dev/null; then \
			[ -d .venv ] || uv venv .venv --python 3.12; \
			. .venv/bin/activate && uv pip install -r requirements.txt; \
		else \
			echo "      Falling back to pip"; \
			[ -d .venv ] || python3 -m venv .venv; \
			. .venv/bin/activate && pip install --upgrade pip -q && pip install -r requirements.txt -q; \
		fi; \
	fi
	@echo ""
	@echo "[5/6] Downloading AI models (faster-whisper + OpenVINO IR)..."
	@echo "      (This downloads from HuggingFace — requires internet)"
	@$(MAKE) --no-print-directory ensure-dirs
	@. .venv/bin/activate && python3 setup/export_models.py
	@echo ""
	@echo "[6/6] Building the application Docker image..."
	@docker compose build
	@echo ""
	@echo "=== Prerequisites setup complete ==="
	@echo "Run 'make demo-prereq' to enable the in-app scripted Demo, or 'make run' to start the app."

# ─── make demo-prereq ────────────────────────────────────────────────────────
# Optional: downloads demo voice samples and generates the Mission Cues PDF.
# Required before the in-app Demo button is enabled. Requires internet.
# Skips work already done unless forced (e.g. `make demo-prereq FORCE=1`).
demo-prereq:
	@echo "=== Local Lingua — Demo Prerequisites Setup ==="
	@echo ""
	@if [ ! -d .venv ]; then \
		echo "[!] .venv not found — run 'make prereq' first."; \
		exit 1; \
	fi
	@if [ -z "$(FORCE)" ] && find voice_samples -name "*.wav" 2>/dev/null | grep -q .; then \
		echo "[1/2] Demo voice samples already present — skipping (use FORCE=1 to refresh)."; \
	else \
		echo "[1/2] Fetching demo voice samples..."; \
		. .venv/bin/activate && python3 fetch_voice_samples.py --cleanup --n 5; \
	fi
	@echo ""
	@if [ -z "$(FORCE)" ] && [ -f mission-cues/mission-cues.pdf ]; then \
		echo "[2/2] Mission Cues PDF already present — skipping (use FORCE=1 to refresh)."; \
	else \
		echo "[2/2] Generating Mission Cues PDF reference..."; \
		. .venv/bin/activate && python3 generate_mission_cues.py; \
	fi
	@echo ""
	@echo "=== Demo prerequisites setup complete — the in-app Demo button is now enabled ==="

# ─── make check ──────────────────────────────────────────────────────────────
# Verify all required dependencies and resources are in place.
check:
	@echo "=== Local Lingua — Prerequisite Check ==="
	@echo ""
	@PASS=0; FAIL=0; \
	\
	printf "  %-40s" "Docker installed"; \
	if command -v docker &>/dev/null; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "Docker daemon running"; \
	if docker info &>/dev/null 2>&1; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "Python 3.12+"; \
	if python3 -c "import sys; exit(0 if sys.version_info >= (3,12) else 1)" 2>/dev/null; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "Python venv (.venv/)"; \
	if [ -d .venv ]; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "FFmpeg installed"; \
	if command -v ffmpeg &>/dev/null; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "OpenVINO Python package"; \
	if . .venv/bin/activate 2>/dev/null && python3 -c "import openvino" 2>/dev/null; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "faster-whisper Python package"; \
	if . .venv/bin/activate 2>/dev/null && python3 -c "import faster_whisper" 2>/dev/null; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "GPU device (/dev/dri/renderD128)"; \
	if [ -e /dev/dri/renderD128 ]; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗ (no GPU — CPU fallback only)\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "NPU device (/dev/accel)"; \
	if [ -d /dev/accel ]; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗ (no NPU — optional)\n"; PASS=$$((PASS+1)); fi; \
	\
	printf "  %-40s" ".env file (RENDER_GROUP_ID)"; \
	if [ -f .env ] && grep -q RENDER_GROUP_ID .env; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "espeak-ng installed (for TTS)"; \
	if command -v espeak-ng &>/dev/null; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "phonemizer Python package"; \
	if . .venv/bin/activate 2>/dev/null && python3 -c "import phonemizer" 2>/dev/null; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "huggingface_hub Python package"; \
	if . .venv/bin/activate 2>/dev/null && python3 -c "import huggingface_hub" 2>/dev/null; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "Whisper model downloaded"; \
	if ls models/whisper-*/model.bin &>/dev/null 2>&1 || ls models/whisper-*/openvino_encoder_model.xml &>/dev/null 2>&1 || find models/whisper-* -name "model.bin" 2>/dev/null | grep -q .; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "Translation model exported"; \
	if ls models/nllb-*/openvino_encoder_model.xml &>/dev/null 2>&1 || ls models/opus-*/openvino_encoder_model.xml &>/dev/null 2>&1; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "Sentiment model exported"; \
	if ls models/roberta-go-emotions/openvino_model.xml &>/dev/null 2>&1 || ls models/twitter-roberta-*/openvino_model.xml &>/dev/null 2>&1 || ls models/distilbert-*/openvino_model.xml &>/dev/null 2>&1; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "TTS model downloaded"; \
	if ls models/kokoro-82m-int8-ov/*.xml &>/dev/null 2>&1; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "Voice emotion model exported"; \
	if ls models/wav2vec2-xlsr-emotion/openvino_model.xml &>/dev/null 2>&1; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗\n"; FAIL=$$((FAIL+1)); fi; \
	\
	printf "  %-40s" "Mission Cue LLM (Qwen2.5-1.5B)"; \
	if ls models/qwen2.5-1.5b-instruct-int4-ov/openvino_model.xml &>/dev/null 2>&1 || (. .venv/bin/activate 2>/dev/null && python3 -c "from huggingface_hub import try_to_load_from_cache; assert try_to_load_from_cache('OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov', 'openvino_model.xml') is not None" 2>/dev/null); then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗ (optional — for unformatted PDF parsing)\n"; PASS=$$((PASS+1)); fi; \
	\
	printf "  %-40s" "Demo voice samples"; \
	if [ -d voice_samples ] && find voice_samples -name "*.wav" 2>/dev/null | grep -q .; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗ (optional — run fetch_voice_samples.py)\n"; PASS=$$((PASS+1)); fi; \
	\
	printf "  %-40s" "Mission Cues PDF"; \
	if [ -d mission-cues ] && find mission-cues -name "*.pdf" 2>/dev/null | grep -q .; then printf "✓\n"; PASS=$$((PASS+1)); else printf "✗ (optional — run generate_mission_cues.py)\n"; PASS=$$((PASS+1)); fi; \
	\
	echo ""; \
	echo "  ─────────────────────────────────────────────"; \
	echo "  Results: $$PASS passed, $$FAIL failed"; \
	echo ""; \
	if [ $$FAIL -gt 0 ]; then \
		echo "  Run 'make prereq' to install missing dependencies."; \
		exit 1; \
	else \
		echo "  All checks passed. Run 'make run' to start the app."; \
	fi

# ─── make build ──────────────────────────────────────────────────────────────
# (Re)build the app image without starting it. Already run once by 'make
# prereq'; use this standalone after changing the Dockerfile/source.
build:
	docker compose build

# ─── make run ────────────────────────────────────────────────────────────────
# Start the application (single container, all models loaded in-process).
# 'make prereq' already built the image, so this just starts it — fast on
# repeat runs. Pass REBUILD=1 to force a rebuild (e.g. after code changes).
run:
	@echo "=== Starting Local Lingua ==="
	@bash scripts/set_env.sh HOST_UID $$(id -u)
	@bash scripts/set_env.sh HOST_GID $$(id -g)
	@$(MAKE) --no-print-directory ensure-dirs
	@bash scripts/detect_metrics_manager.sh
	@bash scripts/generate_device_overrides.sh
	docker compose up$(if $(REBUILD), --build,) -d
	@echo ""
	@echo "App is running at: http://localhost:7860"
	@echo "Logs: docker compose logs -f"

# ─── make stop ───────────────────────────────────────────────────────────────
stop:
	docker compose down

# ─── make ensure-dirs ────────────────────────────────────────────────────────
# Docker creates a missing bind-mount source as root, which the non-root app
# container then cannot write. Create them as the invoking user first.
ensure-dirs:
	@mkdir -p data models voice_samples mission-cues

# ─── make clean ──────────────────────────────────────────────────────────────
# Remove generated artifacts (models, venv, data). Does NOT uninstall drivers.
clean:
	docker compose down --rmi local 2>/dev/null || true
	@rm -rf data/ models/ 2>/dev/null || true
	@if [ -e data ] || [ -e models ]; then \
		echo "Some files are not owned by $$(id -un) — escalating to sudo..."; \
		sudo rm -rf data/ models/; \
	fi
	rm -rf .venv .env docker-compose.override.yml
	@echo "Cleaned. Run 'make prereq' to set up again."

# ─── make demo-clean ─────────────────────────────────────────────────────────
# Remove demo artifacts (voice samples, Mission Cues PDF). Disables the in-app
# Demo button until 'make demo-prereq' is run again.
demo-clean:
	rm -rf voice_samples/ mission-cues/
	@echo "Demo artifacts removed. Run 'make demo-prereq' to re-enable the in-app Demo button."
