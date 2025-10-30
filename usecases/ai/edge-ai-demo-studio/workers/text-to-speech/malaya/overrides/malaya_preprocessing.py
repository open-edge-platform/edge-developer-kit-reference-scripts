import json
import os
import logging
from malaya.preprocessing import Demoji

logger = logging.getLogger(__name__)


def _check_requests():
    """Check if requests module is available."""
    try:
        import requests

        return requests
    except ImportError:
        raise ModuleNotFoundError(
            "requests not installed. Please install it by `pip3 install requests` and try again."
        )


def _download_demoji_data(local_dir: str):
    """Download demoji data from GitHub repository."""
    requests = _check_requests()

    url = "https://raw.githubusercontent.com/huseinzol05/malay-dataset/master/dictionary/emoji/demoji.json"

    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.RequestException as e:
        raise ConnectionError(f"Failed to download demoji data from GitHub: {str(e)}")
    except (ValueError, json.JSONDecodeError) as e:
        raise ValueError(f"Invalid JSON response from GitHub: {str(e)}")

    # Ensure directory exists
    if not os.path.exists(local_dir):
        os.makedirs(local_dir, exist_ok=True)

    # Save the data
    demoji_path = os.path.join(local_dir, "demoji.json")
    try:
        with open(demoji_path, "w", encoding="utf-8") as fopen:
            json.dump(data, fopen, ensure_ascii=False, indent=2)
    except IOError as e:
        raise IOError(f"Failed to write demoji.json to {local_dir}: {str(e)}")

    return data


def demoji(local_dir: str):
    """
    Download latest emoji malay description from https://github.com/huseinzol05/malay-dataset/tree/master/dictionary/emoji

    Parameters
    ----------
    local_dir: str
        Directory path for local demoji.json file. If the file exists locally, it will be loaded from there.
        Otherwise, it will be downloaded from GitHub and cached locally.

    Returns
    -------
    result : malaya.preprocessing.Demoji class

    Raises
    ------
    ValueError
        If local demoji.json file is corrupted or invalid.
    ModuleNotFoundError
        If requests module is not installed.
    ConnectionError
        If download from GitHub fails.
    IOError
        If file operations fail.
    """
    demoji_path = os.path.join(local_dir, "demoji.json")

    # Try to load from local file first
    if os.path.exists(demoji_path):
        try:
            with open(demoji_path, "r", encoding="utf-8") as fopen:
                data = json.load(fopen)
            logger.info(f"Loaded demoji data from local file: {demoji_path}")
        except (IOError, OSError) as e:
            raise IOError(f"Unable to read demoji.json from {local_dir}: {str(e)}")
        except (ValueError, json.JSONDecodeError) as e:
            raise ValueError(f"Invalid JSON in demoji.json from {local_dir}: {str(e)}")
    else:
        logger.warning(
            f"demoji.json not found in {local_dir}, downloading from GitHub instead."
        )
        data = _download_demoji_data(local_dir)
        logger.info(f"Downloaded and cached demoji data to: {demoji_path}")

    return Demoji(dictionary=data)
