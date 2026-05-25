#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# Setup virtual environment
echo "Setting up Python virtual environment for nurse dashboard..."
sudo apt install python3-venv -y
python3 -m venv nurse_dashboard
# shellcheck disable=SC1091
source nurse_dashboard/bin/activate
echo "Virtual environment 'nurse_dashboard' created and activated."

# Install required Python packages
echo "Installing required Python packages..."
pip install --upgrade pip
pip install pytz streamlit influxdb-client pandas streamlit-autorefresh
echo "Python packages installed successfully."

echo "Nurse dashboard setup completed successfully."