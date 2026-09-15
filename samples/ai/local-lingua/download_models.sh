#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -e

echo "=== Local Lingua — Model Download & Export ==="
echo ""
echo "This script downloads and exports all AI models to OpenVINO IR format."
echo "Models are stored in ./models/ and mounted into the container."
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load HF token if available
if [ -z "$HF_TOKEN" ]; then
    if grep -q "^HF=" /etc/environment 2>/dev/null; then
        export HF_TOKEN
        HF_TOKEN=$(grep "^HF=" /etc/environment | cut -d= -f2)
        echo "[*] Loaded HF token from /etc/environment"
    fi
fi

# Check if pip dependencies are available
if ! python3 -c "import optimum.intel" 2>/dev/null; then
    echo "[!] Required Python packages not found."
    echo "    Install with: pip install -r requirements.txt"
    echo "    Or run setup.sh first for a full environment setup."
    exit 1
fi

# Export models
echo ""
echo "[1/5] Exporting transcription model (Whisper)..."
python3 setup/export_models.py --model whisper

echo ""
echo "[2/5] Exporting translation model (NLLB-200)..."
python3 setup/export_models.py --model translator

echo ""
echo "[3/5] Exporting sentiment model..."
python3 setup/export_models.py --model sentiment

echo ""
echo "[4/5] Exporting text-to-speech model..."
python3 setup/export_models.py --model tts

echo ""
echo "[5/5] Exporting voice emotion model (Wav2Vec2)..."
python3 setup/export_models.py --model voice_emotion

echo ""
echo "=== Models ready ==="
echo ""
echo "Models exported to: $SCRIPT_DIR/models/"
ls -1d models/*/
echo ""
echo "You can now start the container:"
echo "  docker compose up --build"
echo ""
echo "Or run locally:"
echo "  python3 run.py"
