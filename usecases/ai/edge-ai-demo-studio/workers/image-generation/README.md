# Image Generation Worker

This worker provides image generation capabilities using OpenVINO Model Server (OVMS) with Stable Diffusion models.

## Usage

### Basic Usage

```bash
python main.py --model-id OpenVINO/stable-diffusion-v1-5-int8-ov
```

### Advanced Usage

```bash
python main.py \
  --model-id OpenVINO/stable-diffusion-v1-5-int8-ov \
  --port 5006 \
  --ovms-port 5952 \
  --device GPU \
  --precision int8
```

### Parameters

- `--model-id`: Hugging Face model identifier (required)
- `--port`: Server port (default: 5006)
- `--ovms-port`: OpenVINO Model Server port (default: 5952)
- `--device`: Target device - CPU, GPU, or NPU (default: CPU)
- `--precision`: Model precision - fp32, fp16, int8, int4 (default: int8)

## API Usage

Once the worker is running, you can generate images using the OpenAI-compatible API:

### Text-to-Image Generation

```bash
curl http://localhost:5006/v3/images/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "OpenVINO/stable-diffusion-v1-5-int8-ov",
    "prompt": "A beautiful sunset over mountains, digital art",
    "size": "512x512",
    "num_inference_steps": 50
  }' | jq -r '.data[0].b64_json' | base64 --decode > output.png
```

### Python Client Example

```python
from openai import OpenAI
import base64
from io import BytesIO
from PIL import Image

client = OpenAI(
    base_url="http://localhost:5006/v3",
    api_key="unused"
)

response = client.images.generate(
    model="OpenVINO/stable-diffusion-v1-5-int8-ov",
    prompt="A beautiful sunset over mountains, digital art",
    extra_body={
        "size": "512x512",
        "num_inference_steps": 50
    }
)

# Save the generated image
base64_image = response.data[0].b64_json
image_data = base64.b64decode(base64_image)
image = Image.open(BytesIO(image_data))
image.save('generated_image.png')
```
