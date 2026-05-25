# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Run as non-root user (AVD-DS-0002)
RUN useradd --no-create-home --shell /bin/false appuser
USER appuser

# Health check: verify the bridge process is still running (AVD-DS-0026)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD pgrep -f "python.*app.py" || exit 1

CMD ["python", "-u", "app.py"]