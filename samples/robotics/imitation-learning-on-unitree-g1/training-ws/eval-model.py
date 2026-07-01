# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""
eval-model.py — Offline evaluation of a trained LeRobot ACT policy against a dataset episode.

For each frame in the chosen episode the script:
  1. Feeds the recorded observation (state + camera images) through the model.
  2. Compares the predicted action against the ground-truth action stored in the dataset.
  3. Accumulates per-step MAE and max-error, detects stuck/repeating outputs,
     and saves a per-step CSV + optional matplotlib plots.

Usage:
  python eval-model.py \
      --model-dir  ./data/outputs/training/lerobot-battery-assembly-v1/checkpoints/last/pretrained_model \
      --dataset-root ./data/outputs/lerobot-battery-assembly-v1 \
      --dataset-repo-id lerobot/twist-dataset \
      --episode 0 \
      --device cuda

The checkpoint produced by train-act.sh lives at:
  <output_dir>/checkpoints/<step>/pretrained_model   (or .../last/pretrained_model)
"""

import argparse
import csv
import logging
import os
from pathlib import Path
from datetime import datetime

import numpy as np
import torch

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ── Model loading ─────────────────────────────────────────────────────────────

def load_policy_model(model_dir: str, device: str, temporal_ensemble_coeff: float = 0.0):
    from lerobot.policies.act.modeling_act import ACTPolicy
    from lerobot.policies.factory import make_pre_post_processors

    logger.info("Loading ACT policy from %s", model_dir)
    model = ACTPolicy.from_pretrained(model_dir)
    model.to(device)
    model.eval()

    if temporal_ensemble_coeff > 0:
        logger.info("Enabling temporal ensembling (coeff=%.3f)", temporal_ensemble_coeff)
        from lerobot.policies.act.modeling_act import ACTTemporalEnsembler
        model.config.temporal_ensemble_coeff = temporal_ensemble_coeff
        model.temporal_ensembler = ACTTemporalEnsembler(
            temporal_ensemble_coeff, model.config.chunk_size
        )

    preprocess, postprocess = make_pre_post_processors(
        policy_cfg=model.config,
        pretrained_path=model_dir,
        preprocessor_overrides={"device_processor": {"device": device}},
    )
    action_dim = int(model.config.output_features["action"].shape[-1])
    logger.info("Model action dim: %d", action_dim)
    return model, preprocess, postprocess, action_dim


# ── Dataset loading ───────────────────────────────────────────────────────────

def load_episode_frames(dataset_root: str, repo_id: str, episode_index: int):
    """Return a list of frame dicts for *episode_index* from a local LeRobot dataset."""
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    logger.info(
        "Loading dataset repo_id=%s from %s (episode %d)",
        repo_id, dataset_root, episode_index,
    )
    dataset = LeRobotDataset(
        repo_id=repo_id,
        root=dataset_root,
        episodes=[episode_index],
    )
    logger.info(
        "Dataset loaded: %d frames in episode %d (total frames: %d)",
        len(dataset), episode_index, len(dataset),
    )
    return dataset


# ── Device helpers ────────────────────────────────────────────────────────────

def configure_torch_device(device: str) -> str:
    device_type = device.split(":", maxsplit=1)[0]
    if device_type == "xpu":
        if not hasattr(torch, "xpu"):
            raise RuntimeError("Torch XPU support is not available.")
        idx = int(device.split(":", 1)[1]) if ":" in device else 0
        torch.xpu.set_device(idx)
    return device_type


# ── Inference loop ────────────────────────────────────────────────────────────

def run_inference(args):
    device_type = configure_torch_device(args.device)
    model, preprocess, postprocess, action_dim = load_policy_model(
        args.model_dir,
        args.device,
        temporal_ensemble_coeff=args.temporal_ensemble_coeff,
    )
    dataset = load_episode_frames(args.dataset_root, args.dataset_repo_id, args.episode)

    model.reset()
    preprocess.reset()
    postprocess.reset()

    mae_history: list[float] = []
    max_err_history: list[float] = []
    action_history: list[np.ndarray] = []

    # Per-dim prediction and GT arrays for CSV / plot
    pred_rows: list[np.ndarray] = []
    gt_rows: list[np.ndarray] = []

    logger.info("Starting inference over %d frames …", len(dataset))
    for t_step, frame in enumerate(dataset):
        # ── Build observation dict ──────────────────────────────────────────
        # Only feed keys the model was trained on (observation.state + observation.images.*)
        obs: dict[str, torch.Tensor] = {}

        state = frame["observation.state"]
        if not isinstance(state, torch.Tensor):
            state = torch.tensor(state, dtype=torch.float32)
        obs["observation.state"] = state.unsqueeze(0).to(args.device)

        image_keys = [k for k in frame if k.startswith("observation.images.")]
        if not image_keys:
            raise RuntimeError(
                "No image keys found in dataset frame. "
                "Expected keys like 'observation.images.top' or similar."
            )
        for img_key in image_keys:
            img = frame[img_key]   # Tensor [C, H, W], float32 in [0, 1]
            if not isinstance(img, torch.Tensor):
                img = torch.tensor(img, dtype=torch.float32)
            obs[img_key] = img.unsqueeze(0).to(args.device)

        preprocessed_obs = preprocess(obs)

        # ── Model forward ───────────────────────────────────────────────────
        with torch.no_grad():
            use_autocast = device_type in {"cuda", "xpu"}
            with torch.autocast(
                device_type=device_type,
                dtype=torch.bfloat16,
                enabled=use_autocast,
            ):
                action_tensor = model.select_action(preprocessed_obs)

        pred = postprocess(action_tensor).float().squeeze(0).cpu().numpy()  # [action_dim]

        # ── Ground-truth action ─────────────────────────────────────────────
        gt = frame["action"]
        if isinstance(gt, torch.Tensor):
            gt = gt.cpu().numpy()
        else:
            gt = np.asarray(gt, dtype=np.float32)
        gt = gt.flatten()

        # ── Error metrics ───────────────────────────────────────────────────
        if pred.shape == gt.shape:
            diff = pred - gt
            mae = float(np.abs(diff).mean())
            max_err = float(np.abs(diff).max())
        else:
            diff = np.full_like(pred, np.nan)
            mae = float("nan")
            max_err = float("nan")
            if t_step == 0:
                logger.warning(
                    "pred shape %s != gt shape %s — MAE cannot be computed. "
                    "Model action_dim=%d; check that --dataset-repo-id matches the training dataset.",
                    pred.shape, gt.shape, action_dim,
                )

        mae_history.append(mae)
        max_err_history.append(max_err)
        action_history.append(pred.copy())
        pred_rows.append(pred.copy())
        gt_rows.append(gt.copy())

        if t_step % 50 == 0 or t_step == len(dataset) - 1:
            logger.info(
                "Step %03d | MAE=%.4f | max_err=%.4f | pred[:4]=%s | gt[:4]=%s",
                t_step, mae, max_err,
                np.round(pred[:4], 4).tolist(),
                np.round(gt[:4], 4).tolist(),
            )

        # Stuck-output detection every 100 steps
        if (t_step + 1) % 100 == 0:
            window = np.stack(action_history[-100:])
            std_per_dim = window.std(axis=0)
            mean_std = float(std_per_dim.mean())
            max_std = float(std_per_dim.max())
            if max_std < 1e-5:
                logger.warning(
                    "Step %03d | Model output appears STUCK/REPEATING over last 100 steps "
                    "(mean_std=%.6f, max_std=%.6f)",
                    t_step, mean_std, max_std,
                )
            elif mean_std < 1e-3:
                logger.info(
                    "Step %03d | Low output variance (mean_std=%.6f, max_std=%.6f) — "
                    "possibly temporal ensembling smoothing or static phase.",
                    t_step, mean_std, max_std,
                )

    # ── Summary statistics ──────────────────────────────────────────────────
    valid_mae = [v for v in mae_history if not np.isnan(v)]
    logger.info("=" * 60)
    if valid_mae:
        logger.info("Episode %d | frames=%d | mean MAE=%.4f | max MAE=%.4f | mean max_err=%.4f",
                    args.episode,
                    len(mae_history),
                    float(np.mean(valid_mae)),
                    float(np.max(valid_mae)),
                    float(np.nanmean(max_err_history)))
    else:
        logger.warning("No valid MAE values computed (shape mismatch throughout).")
    logger.info("=" * 60)

    # ── Save CSV ────────────────────────────────────────────────────────────
    save_dir = Path("data", "outputs", "eval").resolve()
    save_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    episode_sanitized = Path(str(args.episode)).name
    csv_path = save_dir / f"eval_ep{episode_sanitized}_{timestamp}.csv"

    with open(csv_path, "w", newline="") as fh:
        writer = csv.writer(fh)
        n_dims = max((r.shape[0] for r in pred_rows), default=0)
        header = (
            ["step"]
            + [f"pred_{i}" for i in range(n_dims)]
            + [f"gt_{i}"   for i in range(n_dims)]
            + [f"diff_{i}" for i in range(n_dims)]
            + ["mae", "max_err"]
        )
        writer.writerow(header)
        for t, (pred, gt_r) in enumerate(zip(pred_rows, gt_rows)):
            diff_row = pred - gt_r if pred.shape == gt_r.shape else np.full_like(pred, np.nan)
            row = (
                [t]
                + pred.tolist()
                + gt_r.tolist()
                + diff_row.tolist()
                + [mae_history[t], max_err_history[t]]
            )
            writer.writerow(row)
    logger.info("Per-step results saved to: %s", csv_path)

    # ── Optional plots ──────────────────────────────────────────────────────
    if args.plot and pred_rows:
        _plot_results(pred_rows, gt_rows, mae_history, args.episode, save_dir, timestamp)

    return mae_history, max_err_history


# ── Plotting ──────────────────────────────────────────────────────────────────

def _plot_results(
    pred_rows: list[np.ndarray],
    gt_rows: list[np.ndarray],
    mae_history: list[float],
    episode_index: int,
    save_dir: str,
    timestamp: str,
):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        logger.warning("matplotlib not installed — skipping plots.")
        return

    pred_arr = np.array(pred_rows)   # (T, D)
    gt_arr   = np.array(gt_rows)     # (T, D)
    T, D = pred_arr.shape

    # ── MAE over time ──
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(mae_history, label="MAE (pred vs GT)", color="steelblue")
    ax.set_xlabel("Step")
    ax.set_ylabel("MAE (rad / normalised)")
    ax.set_title(f"Episode {episode_index} — per-step MAE")
    ax.legend()
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    mae_path = os.path.join(save_dir, f"mae_ep{episode_index}_{timestamp}.png")
    fig.savefig(mae_path, dpi=100)
    plt.close(fig)
    logger.info("MAE plot saved to: %s", mae_path)

    # ── Per-dim comparison (up to 8 dims for readability) ──
    n_plot = min(D, 8)
    fig, axes = plt.subplots(n_plot, 1, figsize=(12, 2.5 * n_plot), sharex=True)
    if n_plot == 1:
        axes = [axes]
    for i, ax in enumerate(axes):
        ax.plot(pred_arr[:, i], label="pred", color="steelblue", linewidth=1)
        ax.plot(gt_arr[:, i],   label="GT",   color="orange",    linewidth=1, linestyle="--")
        ax.set_ylabel(f"dim {i}")
        ax.legend(loc="upper right", fontsize=7)
        ax.grid(True, alpha=0.3)
    axes[-1].set_xlabel("Step")
    fig.suptitle(f"Episode {episode_index} — pred vs GT (first {n_plot} action dims)", y=1.01)
    fig.tight_layout()
    traj_path = os.path.join(save_dir, f"traj_ep{episode_index}_{timestamp}.png")
    fig.savefig(traj_path, dpi=100, bbox_inches="tight")
    plt.close(fig)
    logger.info("Trajectory plot saved to: %s", traj_path)


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(
        description="Offline evaluation: compare ACT policy predictions against dataset GT."
    )
    parser.add_argument(
        "--model-dir",
        default="./data/outputs/training/bimanual_arm_battery_assembly_dataset_merged-v1/checkpoints/last/pretrained_model",
        help="Path to the pretrained_model directory (HuggingFace format).",
    )
    parser.add_argument(
        "--dataset-root",
        default="./datasets/bimanual_arm_battery_assembly_dataset/bimanual_arm_battery_assembly_dataset_merged",
        help="Local root directory of the LeRobot dataset.",
    )
    parser.add_argument(
        "--dataset-repo-id",
        default="lerobot/twist-dataset",
        help="repo_id used when the dataset was created / downloaded.",
    )
    parser.add_argument(
        "--episode",
        type=int,
        default=0,
        help="Episode index to evaluate (0-based).",
    )
    parser.add_argument(
        "--device",
        default="cuda",
        help="Torch device: cuda | cpu | xpu | xpu:0.",
    )
    parser.add_argument(
        "--temporal-ensemble-coeff",
        type=float,
        default=0.0,
        help="Temporal ensembling coefficient (0 = disabled).",
    )
    parser.add_argument(
        "--plot",
        action="store_true",
        default=False,
        help="Save matplotlib plots of MAE and per-dim trajectory comparisons.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_inference(args)
