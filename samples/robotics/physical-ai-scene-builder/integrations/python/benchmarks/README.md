<!--
Copyright (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Native runtime benchmarks

Development-only throughput benchmarks for Generate and Evaluate (roadmap item 11). They run
against a scene bundle and profile and do not need a running app. Run them from
`physical-ai-scene-builder/`.

## Fixtures

```sh
uv run --project integrations/python --extra teleoperation \
  python integrations/python/benchmarks/build_fixture.py --scene so101
```

`--scene so101` writes the SO-101 Generate sample (robot, table, cube, and container, as in the
physics regression test) with two cameras (`--resolution`, default `640x480`) and
`physicsSteps` 17 to `fixtures/so101.mujoco-scene` and `fixtures/so101-profile.json`. The default
`--scene toy` writes a tiny slide-joint scene (`fixtures/benchmark.mujoco-scene` and
`fixtures/benchmark-profile.json`) for smoke runs. `--output-dir` changes the destination.

## Generate

```sh
uv run --project integrations/python --extra teleoperation \
  python integrations/python/benchmarks/bench_generate.py \
  --scene-bundle integrations/python/benchmarks/fixtures/so101.mujoco-scene \
  --profile integrations/python/benchmarks/fixtures/so101-profile.json \
  --mode in-process --workers 8 --episodes 2 --writer
```

| Option                    | Meaning                                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--mode in-process`       | Step a `NativeEnvironment` directly (default).                                                                                                                                   |
| `--mode zeromq`           | Run a `TeleoperationServer` in this process with a WebSocket stream client connected, and record each episode through the `Teleoperation` client, to measure transport overhead. |
| `--workers N`             | In-process only: N spawn processes, each running `--episodes`; reports aggregate recorded frames per second. `--mode zeromq` with more than one worker is an error.              |
| `--episodes`, `--frames`  | Episodes per process and recorded frames per episode (default 2 and 219).                                                                                                        |
| `--cameras profile\|none` | Render the profile's cameras or none.                                                                                                                                            |
| `--resolution WxH`        | Override every camera resolution.                                                                                                                                                |
| `--writer`                | Include writing recorded RGB frames as AV1.                                                                                                                                      |
| `--profile-cpu`           | Print a cProfile cumulative-time summary.                                                                                                                                        |
| `--no-save`               | Print the result without appending it to `results/`.                                                                                                                             |

## Scripted demonstrations

```sh
uv run --project integrations/python --extra teleoperation \
  python integrations/python/benchmarks/bench_scripted.py \
  --scene-bundle integrations/python/benchmarks/fixtures/so101.mujoco-scene \
  --profile integrations/python/benchmarks/fixtures/so101-profile.json \
  --states 100 --x-cm 10 --y-cm 10 --yaw-deg 45 --workers 8
```

Adds `--states` randomized states (object x/y and yaw, no robot joint offsets) to a temporary
collection, records them with the batch Generate runner, and prints the scripted success rate, the
rate over states with a feasible grasp (`feasibleSuccessRate`: states failing `unreachable` or
`grasp_blocked` are left out), and failure reasons; the result is appended to `results/` (`--no-save` skips it, `--keep DIR` keeps
the collection and its report for inspection).

## Evaluate

```sh
uv run --project integrations/python --extra teleoperation \
  python integrations/python/benchmarks/bench_evaluate.py \
  --scene-bundle integrations/python/benchmarks/fixtures/so101.mujoco-scene \
  --profile integrations/python/benchmarks/fixtures/so101-profile.json \
  --num-envs 8 --policy random
```

The sequential path times reset, physics, rendering, and observation serialization per step.
`--vector` (implied by `--num-envs` greater than 1) uses the vectorized evaluation path with
`SubprocessVectorEnvironment`; `--policy-batching batched|per-env` and `--egl-devices 0 1` apply to
it. `--policy zero|random` drives the environment without a checkpoint. Both paths report the same
metrics: `envSteps`, `setupSeconds`, `loopSeconds`, and `envStepsPerSecond`
(`envSteps / loopSeconds`).

## Results

Each run appends one JSON line with its configuration, timings, and machine information (CPU, EGL
renderer when available, Python, MuJoCo) to `results/<host>.jsonl`. The `fixtures/` and `results/`
directories are Git-ignored.

No reference numbers are recorded yet. The baselines planned in [roadmap.md](../../../internal/docs/roadmap.md)
(scale-out follow-ups) are the Intel Xeon w5-3435X with Arc Pro B70 reference machine and an Intel Core Ultra
laptop (iGPU), with the SO-101 fixture and two 640x480 cameras. Runs in the development container
are smoke tests only. Record the scene, worker or environment count, and software versions with any
numbers added here.
