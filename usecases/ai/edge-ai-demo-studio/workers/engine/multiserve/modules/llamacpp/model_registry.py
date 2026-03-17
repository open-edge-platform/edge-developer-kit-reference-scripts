from pathlib import Path
import json


class ModelRegistry:
    def __init__(self, path: Path):
        self.registry_path = path

    def load_upload_record(self):
        try:
            with open(self.registry_path, "r") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
                return {}
        except (json.JSONDecodeError, FileNotFoundError):
            return {}

    def save(self, uploads):
        with open(self.registry_path, "w") as f:
            json.dump(uploads, f, indent=2)

    def add_user_upload_model(self, model_name: str, filename: str):
        uploads = self.load_upload_record()
        uploads[model_name] = filename
        self.save(uploads)

    def remove_user_upload_model(self, model_name: str):
        uploads = self.load_upload_record()
        if model_name in uploads:
            uploads.pop(model_name)
            self.save(uploads)
