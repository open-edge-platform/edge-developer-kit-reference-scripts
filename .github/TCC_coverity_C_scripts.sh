#!/bin/bash

# Use Case: TCC

# Check if host system is ubuntu 24 and ensure docker is installed
if [ "$(lsb_release -rs)" != "24.04" ]; then
    echo "This script is designed to run on Ubuntu 24.04. Please update your system."
    exit 1
fi 
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install Docker and try again."
    exit 1
fi

# Build docker images
cd usecases/real-time/tcc_tutorial/docker/docker-compose
docker compose up -d
cd ../..
docker build -t rt_linux_tutorial_image -f docker/Dockerfile.rt .

# Run container with Coverity tools mounted and PATH set
# ensure the cov-analysis-linux64-2024.6.1 is install in /home/user/cov-analysis-linux64-2024.6.1 , else modify the path accordingly
COVERITY_DIR="/home/user/cov-analysis-linux64-2024.6.1"
if [ ! -d "$COVERITY_DIR" ]; then
    echo "Coverity directory $COVERITY_DIR does not exist. Please ensure it is installed."
    exit 1
fi
echo "Starting Coverity analysis container..."
    docker run -it -d \
        --name rt_tutorial \
        --privileged \
        --network docker-compose_stats \
        -v "$COVERITY_DIR:/home/rtuser/cov-analysis:ro" \
        -e PATH="/home/rtuser/cov-analysis/bin:$PATH" \
        rt_linux_tutorial_image

# Run Coverity scan
docker exec -it rt_tutorial bash -c "
    cd /home/rtuser/edge-developer-kit-reference-scripts/usecases/real-time/tcc_tutorial && \
    echo 'Current directory: \$(pwd)' && \
    cov-configure --gcc && \
    make clean && \
    echo 'Running cov-build...' && \
    cov-build --dir cov-int make && \
    echo 'Build capture completed, running cov-analyze' && \
    cov-analyze --dir cov-int --concurrency --security --rule --enable-constraint-fpp --enable-fnptr --enable-virtual
"

# Copy cov-int directory from container to localhost
echo "Copying Coverity analysis results to localhost..."
docker cp rt_tutorial:/home/rtuser/edge-developer-kit-reference-scripts/usecases/real-time/tcc_tutorial/cov-int ./cov-int

# Stop and remove ALL containers and clean up docker images
echo "Stopping ALL running containers..."
docker stop $(docker ps -q) 2>/dev/null || echo "No running containers to stop"

echo "Removing ALL containers (running and stopped)..."
docker rm $(docker ps -aq) -f 2>/dev/null || echo "No containers to remove"

echo "Cleaning up ALL docker images..."
docker rmi $(docker images -q) -f 2>/dev/null || echo "No images to remove"

echo "Complete Docker system cleanup..."
docker system prune -a -f --volumes 2>/dev/null || echo "System prune completed"

echo "Docker cleanup completed successfully!"

# Print summary
echo -e "\nCoverity analysis results:"
cat ./cov-int/output/summary.txt