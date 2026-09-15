"""
Local Lingua — Unified launcher.

Starts the FastAPI backend which also serves the frontend static files.
Usage: python run.py
"""

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("local-lingua")


def main():
    import uvicorn

    logger.info("Starting Local Lingua...")
    logger.info("Application: http://localhost:7860")
    uvicorn.run("src.backend.app:app", host="0.0.0.0", port=7860, log_level="info")


if __name__ == "__main__":
    main()
