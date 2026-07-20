#!/bin/bash

set -euo pipefail

echo "Setup autonomous-mobile-robot / collaborative-visual-slam"
echo -e "1\n1" | ./setup.sh

echo "Setup autonomous-mobile-robot / wandering-app-simulation"
echo -e "1\n2" | ./setup.sh

echo "Setup humanoid-imitation-learning / act-sample"
echo -e "2\n1" | ./setup.sh

echo "Setup humanoid-imitation-learning / pi05-rtc-ov"
echo -e "2\n2" | ./setup.sh

echo "Setup stationary-robot-vision-control"
echo -e "3" | ./setup.sh

echo "All setup completed successfully."