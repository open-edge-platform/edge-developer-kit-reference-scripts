# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

from torch.amp import GradScaler
from accelerate import Accelerator
from lerobot.utils.utils import get_safe_torch_device
from lerobot.configs.default import DatasetConfig
from lerobot.configs.train import TrainPipelineConfig
from lerobot.configs.policies import PreTrainedConfig
from lerobot.policies.act.configuration_act import ACTConfig
from lerobot.policies.factory import make_policy, make_pre_post_processors
from lerobot.optim.factory import make_optimizer_and_scheduler
from lerobot.datasets.factory import make_dataset
from lerobot.datasets.utils import cycle
from lerobot.utils.train_utils import (
    get_step_checkpoint_dir,
    load_training_state,
    save_checkpoint,
    update_last_checkpoint,
)
from lerobot.utils.logging_utils import AverageMeter, MetricsTracker
from lerobot.scripts.lerobot_train import update_policy
from typing import AsyncGenerator
from pathlib import Path
from pprint import pformat
import json
import threading
import torch
import queue
import time
import asyncio
import draccus

HF_LEROBOT_DIR = "./data/datasets"


@draccus.encode.register(torch.device)
def encode_torch_device(obj: torch.device):
    return str(obj)


class LeRobotModelFineTuneModule(threading.Thread):
    def __init__(
        self,
        session_id,
        repo_id,
        policy_type="act",
        episodes=[],
        accelerator=None,
        steps=100000,
        logFreq=10000,
        saveFreq=10000,
    ):
        super().__init__()

        self.queue = queue.Queue()
        self.is_training_stopped = threading.Event()

        self.repo_id = repo_id
        self.episodes = episodes if len(episodes) > 0 else None
        print(f"Data root: {HF_LEROBOT_DIR}/{repo_id}")
        self.dataset_cfg = DatasetConfig(
            repo_id=repo_id,
            root=f"{HF_LEROBOT_DIR}/{repo_id}",
            episodes=self.episodes,
            video_backend="pyav",
        )
        self.output_dir = Path(f"./output/{session_id}/{repo_id}")
        self.session_id = session_id
        self.steps = steps

        if accelerator is None:
            from accelerate.utils import DistributedDataParallelKwargs

            ddp_kwargs = DistributedDataParallelKwargs(find_unused_parameters=True)
            self.accelerator = Accelerator(
                step_scheduler_with_optimizer=False, kwargs_handlers=[ddp_kwargs]
            )

        is_main_process = self.accelerator.is_main_process
        self.device = self.accelerator.device

        # default policy
        if policy_type == "act":
            # Map device to 'cpu' for SafeTensors compatibility
            self.policy_cfg = ACTConfig(
                repo_id="local_policy", device="cpu", push_to_hub=False
            )

        self.config_path = None
        self.resume = False

        if Path(
            self.output_dir / "checkpoints/last/pretrained_model/train_config.json"
        ).exists():
            self.config_path = str(
                Path(
                    self.output_dir
                    / "checkpoints/last/pretrained_model/train_config.json"
                )
            )
            self.resume = True

        self.train_cfg = TrainPipelineConfig(
            self.dataset_cfg,
            policy=self.policy_cfg,
            output_dir=self.output_dir,
            job_name=self.session_id,
            resume=self.resume,
            steps=self.steps,
            eval_freq=20000,
            log_freq=logFreq,
            save_freq=saveFreq,
        )
        self.train_cfg.batch_size = 16
        self.train_cfg.policy.chunk_size = 50
        self.train_cfg.policy.n_action_steps = 5

        if self.resume:
            policy_path = Path(self.config_path).parent
            self.train_cfg.policy.pretrained_path = policy_path
            self.train_cfg.checkpoint_path = policy_path.parent

        self.train_cfg.optimizer = self.policy_cfg.get_optimizer_preset()
        self.train_cfg.scheduler = self.policy_cfg.get_scheduler_preset()

        if is_main_process:
            self.dataset = make_dataset(self.train_cfg)

        self.accelerator.wait_for_everyone()
        if not is_main_process:
            self.dataset = make_dataset(self.train_cfg)

        self.policy = make_policy(
            cfg=self.train_cfg.policy,
            ds_meta=self.dataset.meta,
            rename_map=self.train_cfg.rename_map,
        )

        # Move policy to actual XPU device after loading
        if str(self.device).startswith('xpu'):
            self.policy = self.policy.to(self.device)
        
        self.accelerator.wait_for_everyone()

        processor_kwargs = {}
        postprocessor_kwargs = {}
        if (
            self.train_cfg.policy.pretrained_path and not self.train_cfg.resume
        ) or not self.train_cfg.policy.pretrained_path:
            # Only provide dataset_stats when not resuming from saved processor state
            processor_kwargs["dataset_stats"] = self.dataset.meta.stats

        if self.train_cfg.policy.pretrained_path is not None:
            processor_kwargs["preprocessor_overrides"] = {
                "device_processor": {"device": "cpu"}, # Map device for processor compatibility
                "normalizer_processor": {
                    "stats": self.dataset.meta.stats,
                    "features": {
                        **self.policy.config.input_features,
                        **self.policy.config.output_features,
                    },
                    "norm_map": self.policy.config.normalization_mapping,
                },
            }
            processor_kwargs["preprocessor_overrides"][
                "rename_observations_processor"
            ] = {"rename_map": self.train_cfg.rename_map}
            postprocessor_kwargs["postprocessor_overrides"] = {
                "unnormalizer_processor": {
                    "stats": self.dataset.meta.stats,
                    "features": self.policy.config.output_features,
                    "norm_map": self.policy.config.normalization_mapping,
                },
            }
        self.preprocessor, self.postprocessor = make_pre_post_processors(
            policy_cfg=self.train_cfg.policy,
            pretrained_path=self.train_cfg.policy.pretrained_path,
            **processor_kwargs,
            **postprocessor_kwargs,
        )

        self.step = 0
        self.optimizer, self.lr_scheduler = make_optimizer_and_scheduler(
            self.train_cfg, self.policy
        )

        if self.train_cfg.resume:
            self.step, self.optimizer, self.lr_scheduler = load_training_state(
                self.train_cfg.checkpoint_path, self.optimizer, self.lr_scheduler
            )
            print(f"Resuming from {self.step}")

        print(f"Training configuration: {pformat(self.train_cfg)}")

    def run(self):
        num_learnable_params = sum(
            p.numel() for p in self.policy.parameters() if p.requires_grad
        )
        num_total_params = sum(p.numel() for p in self.policy.parameters())

        # Shuffle batches unless streaming mode is enabled
        shuffle = not getattr(self.train_cfg.dataset, "streaming", False)
        sampler = None
        dataloader = torch.utils.data.DataLoader(
            self.dataset,
            num_workers=self.train_cfg.num_workers,
            batch_size=self.train_cfg.batch_size,
            shuffle=shuffle,
            sampler=sampler,
            pin_memory=self.device.type == "xpu",
            drop_last=False,
            prefetch_factor=2,
        )
        dl_iter = cycle(dataloader)
        self.accelerator.wait_for_everyone()

        self.policy.train()

        train_metrics = {
            "loss": AverageMeter("loss", ":.3f"),
            "grad_norm": AverageMeter("grdn", ":.3f"),
            "lr": AverageMeter("lr", ":0.1e"),
            "update_s": AverageMeter("updt_s", ":.3f"),
            "dataloading_s": AverageMeter("data_s", ":.3f"),
        }

        train_tracker = MetricsTracker(
            self.train_cfg.batch_size,
            self.dataset.num_frames,
            self.dataset.num_episodes,
            train_metrics,
            initial_step=self.step,
        )

        # Comprehensive device transfer for all tensor types
        def move_to_device(obj, device):
            if isinstance(obj, torch.Tensor):
                return obj.to(device, non_blocking=True)
            elif isinstance(obj, dict):
                return {k: move_to_device(v, device) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [move_to_device(item, device) for item in obj]
            elif isinstance(obj, tuple):
                return tuple(move_to_device(item, device) for item in obj)
            return obj

        for _ in range(self.step, self.train_cfg.steps):
            if self.is_training_stopped.is_set():
                break

            start_time = time.perf_counter()
            batch = next(dl_iter)
            batch = self.preprocessor(batch)
            batch = move_to_device(batch, self.device)
            train_tracker.dataloading_s = time.perf_counter() - start_time

            train_tracker, output_dict = update_policy(
                train_tracker,
                self.policy,
                batch,
                self.optimizer,
                self.train_cfg.optimizer.grad_clip_norm,
                accelerator=self.accelerator,
                lr_scheduler=self.lr_scheduler,
            )

            self.step += 1
            train_tracker.step()
            is_log_step = (
                self.train_cfg.log_freq > 0 and self.step % self.train_cfg.log_freq == 0
            )
            is_saving_step = (
                self.step % self.train_cfg.save_freq == 0
                or self.step == self.train_cfg.steps
            )
            is_eval_step = (
                self.train_cfg.eval_freq > 0
                and self.step % self.train_cfg.eval_freq == 0
            )

            if is_log_step:
                train_metrics = train_tracker.to_dict()
                train_steps = train_metrics["steps"]
                train_loss = train_metrics["loss"]
                train_episodes = train_metrics["episodes"]
                train_gradnorm = train_metrics["grad_norm"]
                self.queue.put_nowait(
                    {
                        "steps": train_steps,
                        "status": f"[Step {train_steps}] Episode: {train_episodes:.2f}, Loss: {train_loss:.2f}, Gradient Norm: {train_gradnorm:.2f}",
                    }
                )
                train_tracker.reset_averages()

            if self.train_cfg.save_checkpoint and is_saving_step:
                checkpoint_dir = get_step_checkpoint_dir(
                    self.train_cfg.output_dir, self.train_cfg.steps, self.step
                )
                save_checkpoint(
                    checkpoint_dir=checkpoint_dir,
                    step=self.step,
                    cfg=self.train_cfg,
                    policy=self.accelerator.unwrap_model(self.policy),
                    optimizer=self.optimizer,
                    scheduler=self.lr_scheduler,
                    preprocessor=self.preprocessor,
                    postprocessor=self.postprocessor,
                )
                update_last_checkpoint(checkpoint_dir)

        self.is_training_stopped.set()

    def train(self):
        self.start()

    def stop(self):
        self.is_training_stopped.set()

    async def monitor_training(self) -> AsyncGenerator[str, None]:
        yield f"event: status\ndata: {json.dumps({'status': 'TRAINING STARTED'})}\n\n"

        while not self.is_training_stopped.is_set():
            try:
                data = self.queue.get(timeout=1)
                steps = data["steps"]
                status = data["status"]
                yield f"event: metric_update\ndata: {json.dumps({ 'status': status, 'steps': steps })}\n\n"
            except queue.Empty:
                await asyncio.sleep(0.05)

        yield f"event: status\ndata: {json.dumps({'status': 'TRAINING COMPLETED'})}\n\n"
        yield f"event: end\ndata: {json.dumps({'status': 'TRAINING ENDED'})}\n\n"
