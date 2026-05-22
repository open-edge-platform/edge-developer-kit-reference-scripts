import time
import base64
import logging
import requests
from openai import OpenAI

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class OpenAIClient:
    def __init__(self, api_key: str, base_url: str = "https://api.openai.com/v1"):
        self.client = OpenAI(api_key=api_key, base_url=base_url)

    def create_chat_completion(self, **kwargs):
        return self.client.chat.completions.create(**kwargs)

    def create_completion(self, **kwargs):
        return self.client.completions.create(**kwargs)


class OVMSClient:
    def __init__(self, server_url: str, model_list: list):
        self.server_url = server_url
        self.model_list = model_list

        self.client = OpenAI(
            base_url=f"{server_url}/v3",
            api_key="-"
        )

        for _ in range(5):
            try:
                if self._verify_model_is_ready(model_list):
                    logger.info("All models are ready.")
                    break
                else:
                    raise Exception("Models are not ready yet.")
            except Exception as e:
                logger.warning(f"Model verification failed: {e}")
                time.sleep(10)
        else:
            raise Exception("Models are not ready after multiple attempts.")

    def _verify_model_is_ready(self, model_list: list):
        response = requests.get(f"{self.server_url}/v1/config")
        if response.status_code != 200:
            raise Exception(f"Failed to get model info: {response.text}")
        results = response.json()
        for model_name in model_list:
            if model_name not in results:
                raise Exception(f"Model {model_name} not found in server")
            if results[model_name]['model_version_status'][0]['state'] != 'AVAILABLE':
                raise Exception(f"Model {model_name} is not available")
        return True

    def chat_completion(self, **kwargs):
        return self.client.chat.completions.create(**kwargs)

    def completion(self, **kwargs):
        return self.client.completions.create(**kwargs)


def convert_image(img_path):
    with open(img_path, 'rb') as file:
        base64_image = base64.b64encode(file.read()).decode("utf-8")
    return base64_image


def test_chat_completion():
    model_list = [
        "OpenGVLab/InternVL2-2B"
    ]
    client = OVMSClient("http://localhost:8000", model_list=model_list)
    conversation = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe what is one the picture."},
                {"type": "image_url", "image_url": {
                    "url": f"data:image/jpeg;base64,{convert_image('./data/coco_bike.jpg')}"}}
            ]
        }
    ]

    response = client.chat_completion(
        model="OpenGVLab/InternVL2-2B",
        messages=conversation,
        max_tokens=512,
        temperature=0.7,
        top_p=0.9,
        n=1,
        stop=None,
        stream=True
    )

    for chunk in response:
        if chunk.choices[0].delta.content is not None:
            print(chunk.choices[0].delta.content, end="", flush=True)
    print("\n")


def test_completion():
    model_list = [
        "OpenGVLab/InternVL2-2B"
    ]
    # Replace with your actual MCP server URL
    mcp_server_url = 'http://localhost:8080'
    client = OVMSClient("http://localhost:8000", model_list=model_list)

    response = client.chat_completion(
        model="OpenGVLab/InternVL2-2B",
        tools=[
            {
                "type": "mcp",
                "server_label": "dice_server",
                "server_url": f"{mcp_server_url}/mcp/",
                "require_approval": "never",
            },
        ],
        messages=[
            {
                "role": "user",
                "content": "Roll a few dice!"
            }
        ],
    )

    for chunk in response:
        if chunk.choices[0].text is not None:
            print(chunk.choices[0].text, end="", flush=True)
    print("\n")


if __name__ == "__main__":
    # test_chat_completion()
    test_completion()
