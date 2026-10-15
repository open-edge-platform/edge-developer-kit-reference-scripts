# Patch Scope

- **Warp** adds a Linux SYCL device/runtime, USM allocation, kernel compilation
	and code generation, plus queue interop and tile support. The version-locked
	`warp/linux-sycl.patch` applies these changes to the pinned Warp v1.12.0
	checkout before its native library is built.
- **mujoco-warp** dispatches two solver operations to barrier-free SYCL kernels:
	JTDAJ assembly and the small dense Cholesky solve. The existing tiled CUDA
	implementations remain the dispatch path on CUDA.
- **mjlab** separates the Torch environment device from the Warp simulation
	device, supports XPU-backed environment/state tensors and raycast outputs,
	and captures/replays step, forward, reset, and eligible sensing graphs on
	SYCL. The existing CUDA graph and simulation paths remain available.
- **Unitree** initializes Warp SYCL and XPU Torch through those native APIs and
	exposes `--sim-backend` / `--env-device`; it no longer installs or imports a
	`mjlab_sycl` runtime monkey-patch.

This follows the NVIDIA flow at the same abstraction boundaries: Unitree still
constructs the `mjlab` environment, `mjlab` still calls the `mujoco-warp`
simulation API, and the solver still selects device-specific kernels. SYCL
adds explicit queue synchronization and uses a separate flattened kernel path
where Warp's CUDA tiled implementation is not supported. It is therefore
broader than the PyTorch3D patch, which adds one XPU dispatch/build/kernel path
to a Torch C++ extension without introducing a new device runtime.

The resulting Unitree environment supports `--sim-backend sycl` and
`--env-device xpu`. `scripts/install.sh` checks that `sycl-ls` can enumerate an
Intel Level Zero GPU before setup begins. It does not install the host GPU
driver, oneAPI/SYCL runtime, or compiler; those must be installed separately.
