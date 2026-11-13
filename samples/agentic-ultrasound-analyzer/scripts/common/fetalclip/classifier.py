# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
FetalCLIP classifier for fetal ultrasound detection and anatomical plane classification.

Uses FetalCLIP (a CLIP-based vision-language model trained on 210K fetal ultrasound images)
for zero-shot classification of ultrasound images.

Two-stage classification:
1. Is this a fetal ultrasound? (fetal vs. general ultrasound)
2. If fetal, which anatomical plane? (abdomen, brain, heart, spine, etc.)

References:
- Paper: https://arxiv.org/abs/2502.14807
- Code: https://github.com/BioMedIA-MBZUAI/FetalCLIP
- Weights: https://huggingface.co/numansaeed/fetalclip-model
"""

import os
import json
import math
import torch
import open_clip
from PIL import Image
from pathlib import Path


# Text prompts for Stage 1: Fetal vs. Non-Fetal detection
FETAL_DETECTION_PROMPTS = {
    "fetal": [
        "Fetal ultrasound image showing prenatal anatomy.",
        "Ultrasound image of a developing fetus.",
        "Prenatal ultrasound scan showing fetal structures.",
    ],
    "non_fetal": [
        "Ultrasound image of an adult liver.",
        "Ultrasound image of a kidney.",
        "Ultrasound image of a thyroid gland.",
        "Ultrasound image of a gallbladder.",
        "Ultrasound image of a breast.",
        "Cardiac echocardiogram of an adult heart.",
        "Musculoskeletal ultrasound image.",
    ],
}

# Text prompts for Stage 2: Fetal anatomical plane classification
# Based on standard fetal ultrasound planes from the FetalCLIP paper
FETAL_PLANE_PROMPTS = {
    "Fetal Abdomen": "Ultrasound image focusing on the fetal abdominal area, highlighting structural development.",
    "Fetal Brain (Transventricular)": "Fetal ultrasound image showing a transventricular view of the brain, highlighting the lateral ventricles.",
    "Fetal Brain (Transcerebellar)": "Fetal ultrasound image showing a transcerebellar view, highlighting the cerebellum and posterior fossa.",
    "Fetal Brain (Transthalamic)": "Fetal ultrasound image showing a transthalamic view of the brain, highlighting the thalami and cavum septum pellucidum.",
    "Fetal Femur": "Fetal ultrasound image showing the femur bone for biometry measurement.",
    "Fetal Four-Chamber Heart": "Fetal ultrasound image focusing on the heart, highlighting the four-chamber view with cardiac structures.",
    "Fetal Three-Vessel View": "Fetal ultrasound image showing the three-vessel view of the fetal heart and great vessels.",
    "Fetal Spine": "Fetal ultrasound image showing the spine in longitudinal or coronal view.",
    "Fetal Face (Profile)": "Fetal ultrasound image showing the fetal face in profile view.",
    "Fetal Lips": "Fetal ultrasound image focusing on the fetal lips and palate.",
    "Fetal Kidneys": "Fetal ultrasound image showing the fetal kidneys.",
    "Maternal Cervix": "Ultrasound image showing the maternal cervix for cervical length measurement.",
    "Placenta": "Ultrasound image showing the placenta and its position.",
}

# Clinical context for enriching EchoVLM prompts based on detected plane
PLANE_CLINICAL_CONTEXT = {
    "Fetal Abdomen": "Focus on abdominal circumference, stomach bubble, umbilical vein, and any signs of ascites or organomegaly.",
    "Fetal Brain (Transventricular)": "Evaluate lateral ventricles for ventriculomegaly (>10mm atrium), assess choroid plexus symmetry.",
    "Fetal Brain (Transcerebellar)": "Measure transcerebellar diameter, evaluate cisterna magna (<10mm normal), assess cerebellar morphology.",
    "Fetal Brain (Transthalamic)": "Evaluate biparietal diameter, head circumference, cavum septum pellucidum, and midline structures.",
    "Fetal Femur": "Measure femur length for gestational age estimation, assess bone echogenicity and curvature.",
    "Fetal Four-Chamber Heart": "Evaluate cardiac axis, chamber symmetry, interventricular septum, foramen ovale, and valve function. Screen for congenital heart defects.",
    "Fetal Three-Vessel View": "Evaluate size and arrangement of pulmonary artery, aorta, and superior vena cava. Screen for great vessel anomalies.",
    "Fetal Spine": "Evaluate vertebral alignment, skin covering, and posterior elements. Screen for neural tube defects.",
    "Fetal Face (Profile)": "Evaluate nasal bone presence, frontal bossing, micrognathia, and facial profile markers.",
    "Fetal Lips": "Evaluate for cleft lip and palate abnormalities.",
    "Fetal Kidneys": "Evaluate renal pelvis diameter, cortical echogenicity, and rule out hydronephrosis or renal agenesis.",
    "Maternal Cervix": "Measure cervical length, evaluate for funneling or shortening as preterm birth risk indicator.",
    "Placenta": "Evaluate placental location, grade, thickness, and rule out previa or accreta spectrum.",
}


class FetalCLIPClassifier:
    """
    FetalCLIP-based classifier for fetal ultrasound detection and plane classification.
    
    Loads the FetalCLIP model (open_clip architecture) and provides:
    - is_fetal(): determines if an image is a fetal ultrasound
    - classify_plane(): identifies the anatomical plane of a fetal ultrasound
    - classify(): full pipeline (detection + plane classification)
    """

    def __init__(
        self,
        config_path: str = None,
        weights_path: str = None,
        ov_model_path: str = None,
        device: str = "cpu",
        fetal_threshold: float = 0.6,
    ):
        """
        Initialize FetalCLIP classifier.
        
        Args:
            config_path: Path to FetalCLIP_config.json
            weights_path: Path to FetalCLIP_weights.pt
            device: 'cpu' or 'cuda' (ignored if OpenVINO IR is available)
            fetal_threshold: Minimum confidence to classify as fetal (0-1)
        """
        requested = str(device or "cpu").strip().lower()
        # Keep PyTorch fallback on a valid torch device while OpenVINO uses an explicit mapping.
        torch_device = "cuda" if requested == "cuda" and torch.cuda.is_available() else "cpu"
        self.device = torch.device(torch_device)
        self._requested_device = requested
        self.fetal_threshold = fetal_threshold
        self._model = None
        self._preprocess = None
        self._tokenizer = None
        self._ov_compiled = None  # OpenVINO compiled model (GPU)
        self._use_openvino = False

        # Resolve paths
        base_dir = Path(__file__).parent
        self._config_path = config_path or str(base_dir / "FetalCLIP_config.json")
        self._weights_path = weights_path or str(base_dir / "FetalCLIP_weights.pt")
        self._ov_model_path = ov_model_path or str(base_dir / "fetalclip_image_encoder.xml")
        self._text_features_path = str(base_dir / "fetalclip_text_features.pt")

        # Pre-computed text features (loaded from file or computed at load time)
        self._fetal_text_features = None
        self._nonfetal_text_features = None
        self._plane_text_features = None
        self._plane_labels = None

        # Legacy token storage (only used in PyTorch fallback mode)
        self._fetal_tokens = None
        self._nonfetal_tokens = None
        self._plane_tokens = None

    def _resolve_openvino_device(self) -> str:
        """Map user-facing device hints to OpenVINO device names."""
        if self._requested_device in {"cpu"}:
            return "CPU"
        if self._requested_device in {"gpu", "igpu", "cuda"}:
            return "GPU"
        if self._requested_device in {"npu"}:
            return "NPU"
        # Unknown values default to GPU for best latency on Intel iGPU systems.
        return "GPU"

    @property
    def loaded(self) -> bool:
        return self._model is not None or self._ov_compiled is not None

    def load(self):
        """Load model. Prefers OpenVINO IR on GPU if available, else PyTorch on CPU."""
        if self.loaded:
            return

        base_dir = Path(__file__).parent

        # Try OpenVINO path first (much faster — GPU inference)
        if os.path.exists(self._ov_model_path) and os.path.exists(self._text_features_path):
            self._load_openvino()
        else:
            self._load_pytorch()

    def _load_openvino(self):
        """Load using OpenVINO IR on requested device with pre-computed text features."""
        import openvino as ov

        ov_device = self._resolve_openvino_device()
        print(f"Loading FetalCLIP (OpenVINO model on {ov_device} )...")

        # Load pre-computed text features
        text_data = torch.load(self._text_features_path, map_location="cpu", weights_only=True)
        self._fetal_text_features = text_data["fetal"].numpy()
        self._nonfetal_text_features = text_data["nonfetal"].numpy()
        self._plane_text_features = text_data["plane"].numpy()
        self._plane_labels = text_data["plane_labels"]

        # Load and compile OpenVINO model on selected device
        core = ov.Core()
        model = core.read_model(self._ov_model_path)
        try:
            self._ov_compiled = core.compile_model(model, ov_device)
        except Exception as exc:
            if (ov_device != "GPU") and (ov_device != "NPU"):
                raise
            print(f"[WARN] OpenVINO GPU/NPU compile failed ({exc}); retrying on CPU")
            self._ov_compiled = core.compile_model(model, "CPU")
            ov_device = "CPU"
        self._use_openvino = True

        # Get preprocessing transform without loading the full 1.71GB model
        self._preprocess = open_clip.image_transform(224, is_train=False)

        print(f"[OK] FetalCLIP loaded on {ov_device} via OpenVINO (threshold={self.fetal_threshold})")

    def _load_pytorch(self):
        """Fallback: load using PyTorch on CPU."""
        if not os.path.exists(self._weights_path):
            raise FileNotFoundError(
                f"FetalCLIP weights not found: {self._weights_path}\n"
                "Download from: https://huggingface.co/numansaeed/fetalclip-model"
            )

        print(f"Loading FetalCLIP weights (1.71 GB) on {self.device}...")

        # Register model config with open_clip
        with open(self._config_path, "r") as f:
            config_data = json.load(f)
        open_clip.factory._MODEL_CONFIGS["FetalCLIP"] = config_data

        # Load model
        model, _, preprocess_test = open_clip.create_model_and_transforms(
            "FetalCLIP", pretrained=self._weights_path
        )
        model.eval()
        model.to(self.device)
        self._model = model
        self._preprocess = preprocess_test
        self._tokenizer = open_clip.get_tokenizer("FetalCLIP")

        # Pre-tokenize all prompts for fast inference
        self._fetal_tokens = self._tokenizer(FETAL_DETECTION_PROMPTS["fetal"]).to(self.device)
        self._nonfetal_tokens = self._tokenizer(FETAL_DETECTION_PROMPTS["non_fetal"]).to(self.device)

        self._plane_labels = list(FETAL_PLANE_PROMPTS.keys())
        self._plane_tokens = self._tokenizer(list(FETAL_PLANE_PROMPTS.values())).to(self.device)

        print(f"[OK] FetalCLIP loaded on {self.device} (threshold={self.fetal_threshold})")

    def warmup(self):
        """Run a decoy inference to warm up CPU/GPU caches and pre-allocate tensors."""
        if not self.loaded:
            self.load()
        # Create a small black 224x224 image and run full classify pipeline
        dummy = Image.new("RGB", (224, 224), color=(0, 0, 0))
        self.classify(dummy)
        print("[OK] FetalCLIP warmup complete (caches primed)")

    def _encode_image(self, image: Image.Image):
        """Preprocess and encode a single image. Returns numpy array if OpenVINO, else Tensor."""
        img_tensor = self._preprocess(image).unsqueeze(0)

        if self._use_openvino:
            import numpy as np
            result = self._ov_compiled(img_tensor.numpy())
            features = result[0]  # numpy array (1, 768)
            # L2 normalize
            norms = np.linalg.norm(features, axis=-1, keepdims=True)
            norms = np.maximum(norms, 1e-12)
            features = features / norms
            features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
            return features
        else:
            img_tensor = img_tensor.to(self.device)
            with torch.no_grad(), torch.amp.autocast(device_type=str(self.device)):
                features = self._model.encode_image(img_tensor)
                norms = features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
                features = features / norms
                features = torch.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
            return features

    def _encode_text(self, tokens: torch.Tensor) -> torch.Tensor:
        """Encode pre-tokenized text (PyTorch fallback only)."""
        with torch.no_grad(), torch.amp.autocast(device_type=str(self.device)):
            features = self._model.encode_text(tokens)
            norms = features.norm(dim=-1, keepdim=True).clamp_min(1e-12)
            features = features / norms
            features = torch.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
        return features

    def is_fetal(self, image: Image.Image) -> tuple[bool, float]:
        """
        Determine if an image is a fetal ultrasound.
        
        Args:
            image: PIL Image
            
        Returns:
            (is_fetal: bool, confidence: float)
        """
        if not self.loaded:
            self.load()

        img_features = self._encode_image(image)

        if self._use_openvino:
            import numpy as np
            # Use pre-computed text features (numpy)
            fetal_text_features = self._fetal_text_features
            nonfetal_text_features = self._nonfetal_text_features

            # Compute similarities
            all_text = np.concatenate([fetal_text_features, nonfetal_text_features], axis=0)
            logits = 100.0 * (img_features @ all_text.T)
            logits = np.nan_to_num(logits, nan=0.0, posinf=0.0, neginf=0.0)
            # Softmax
            exp_logits = np.exp(logits - logits.max(axis=-1, keepdims=True))
            denom = exp_logits.sum(axis=-1, keepdims=True)
            denom = np.maximum(denom, 1e-12)
            probs = exp_logits / denom
            probs = np.nan_to_num(probs, nan=0.0, posinf=0.0, neginf=0.0)
            probs = probs.squeeze(0)

            n_fetal = fetal_text_features.shape[0]
            fetal_prob = float(probs[:n_fetal].sum())
        else:
            # PyTorch path
            fetal_text_features = self._encode_text(self._fetal_tokens)
            nonfetal_text_features = self._encode_text(self._nonfetal_tokens)

            all_text = torch.cat([fetal_text_features, nonfetal_text_features], dim=0)
            all_sim = (100.0 * img_features @ all_text.T).softmax(dim=-1).squeeze(0)

            n_fetal = fetal_text_features.shape[0]
            fetal_prob = all_sim[:n_fetal].sum().item()

        if not math.isfinite(fetal_prob):
            fetal_prob = 0.0

        is_fetal = fetal_prob >= self.fetal_threshold
        return is_fetal, round(fetal_prob, 4)

    def classify_plane(self, image: Image.Image, img_features=None) -> tuple[str, float]:
        """
        Classify the anatomical plane of a fetal ultrasound image.
        
        Args:
            image: PIL Image (assumed to be fetal)
            img_features: Pre-computed image features (avoids re-encoding)
            
        Returns:
            (plane_label: str, confidence: float)
        """
        if not self.loaded:
            self.load()

        if img_features is None:
            img_features = self._encode_image(image)

        if self._use_openvino:
            import numpy as np
            plane_text_features = self._plane_text_features
            logits = 100.0 * (img_features @ plane_text_features.T)
            logits = np.nan_to_num(logits, nan=0.0, posinf=0.0, neginf=0.0)
            exp_logits = np.exp(logits - logits.max(axis=-1, keepdims=True))
            denom = exp_logits.sum(axis=-1, keepdims=True)
            denom = np.maximum(denom, 1e-12)
            probs = exp_logits / denom
            probs = np.nan_to_num(probs, nan=0.0, posinf=0.0, neginf=0.0)
            probs = probs.squeeze(0)

            best_idx = int(probs.argmax())
            best_label = self._plane_labels[best_idx]
            best_confidence = float(probs[best_idx])
        else:
            plane_text_features = self._encode_text(self._plane_tokens)
            sims = (100.0 * img_features @ plane_text_features.T).softmax(dim=-1).squeeze(0)
            best_idx = sims.argmax().item()
            best_label = self._plane_labels[best_idx]
            best_confidence = sims[best_idx].item()

        if not math.isfinite(best_confidence):
            best_confidence = 0.0

        return best_label, round(best_confidence, 4)

    def classify(self, image: Image.Image) -> dict:
        """
        Full classification pipeline: fetal detection + plane classification.
        Encodes the image only once for both stages.
        
        Args:
            image: PIL Image
            
        Returns:
            {
                "is_fetal": bool,
                "fetal_confidence": float,
                "plane": str or None,
                "plane_confidence": float or None,
                "clinical_context": str or None,
                "model": "FetalCLIP"
            }
        """
        if not self.loaded:
            self.load()

        # Encode image ONCE for both stages
        img_features = self._encode_image(image)

        # Stage 1: fetal detection
        if self._use_openvino:
            import numpy as np
            fetal_text_features = self._fetal_text_features
            nonfetal_text_features = self._nonfetal_text_features
            all_text = np.concatenate([fetal_text_features, nonfetal_text_features], axis=0)
            logits = 100.0 * (img_features @ all_text.T)
            logits = np.nan_to_num(logits, nan=0.0, posinf=0.0, neginf=0.0)
            exp_logits = np.exp(logits - logits.max(axis=-1, keepdims=True))
            denom = exp_logits.sum(axis=-1, keepdims=True)
            denom = np.maximum(denom, 1e-12)
            probs = exp_logits / denom
            probs = np.nan_to_num(probs, nan=0.0, posinf=0.0, neginf=0.0)
            probs = probs.squeeze(0)
            n_fetal = fetal_text_features.shape[0]
            fetal_prob = float(probs[:n_fetal].sum())
        else:
            fetal_text_features = self._encode_text(self._fetal_tokens)
            nonfetal_text_features = self._encode_text(self._nonfetal_tokens)
            all_text = torch.cat([fetal_text_features, nonfetal_text_features], dim=0)
            all_sim = (100.0 * img_features @ all_text.T).softmax(dim=-1).squeeze(0)
            n_fetal = fetal_text_features.shape[0]
            fetal_prob = all_sim[:n_fetal].sum().item()

        if not math.isfinite(fetal_prob):
            fetal_prob = 0.0

        is_fetal = fetal_prob >= self.fetal_threshold

        result = {
            "is_fetal": is_fetal,
            "fetal_confidence": round(fetal_prob, 4),
            "plane": None,
            "plane_confidence": None,
            "clinical_context": None,
            "model": "FetalCLIP",
        }

        if is_fetal:
            # Stage 2: reuse img_features (no re-encoding!)
            plane, plane_conf = self.classify_plane(image, img_features=img_features)
            result["plane"] = plane
            result["plane_confidence"] = plane_conf
            result["clinical_context"] = PLANE_CLINICAL_CONTEXT.get(plane, "")

        return result

    def get_enriched_prompt(self, classification: dict) -> str:
        """
        Generate an enriched prompt for EchoVLM based on FetalCLIP classification.
        
        Args:
            classification: Output from classify()
            
        Returns:
            Enriched prompt string to prepend/replace the default EchoVLM prompt
        """
        if not classification["is_fetal"]:
            # Non-fetal: use default generic prompt
            return (
                "Describe any abnormalities (if any) or significant findings in the "
                "provided ultrasound image. If there are any abnormalities, create a "
                "detailed medical assessment including a clear explanation of major "
                "findings, root cause, and recommended next steps. Otherwise, just "
                "mention there are no abnormalities. The report must be only in English language."
            )

        plane = classification["plane"]
        clinical_context = classification["clinical_context"]

        return (
            f"This is a fetal ultrasound image classified as: {plane}.\n\n"
            f"Clinical focus: {clinical_context}\n\n"
            f"Provide a detailed medical assessment of this {plane} view. "
            f"Describe the anatomical structures visible, identify any abnormalities "
            f"or variants, provide measurements if visible, and suggest clinical "
            f"significance. If everything appears normal, state so with supporting "
            f"observations. The report must be only in English language."
        )
