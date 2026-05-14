
# Edge Developer Kit Reference Scripts

This repository provides simplified developer kit reference setup scripts for various Intel® platforms and GPUs.

> **First time:** Follow our [detailed setup guide](./docs/getting-started.md) for a guided experience.

-> **Quick Start:** Get running in 5 minutes with our [one-line installer](#5-minute-quick-start).

> **Note:** The main branch contains the latest development version of the project. It may include experimental features, work in progress, or unstable code.

- Officially Supported: Ubuntu 24.04 LTS (tested on `Ubuntu 24.04.4 LTS`) with the 6.17 kernel.
- Kernel / HWE Guidance: The setup and reference scripts are validated against the Ubuntu 24.04 HWE stack (Linux 6.17). We recommend using the HWE kernel matching the tested version for best compatibility and to avoid driver/packaging mismatches.

## 🌟 Try Our Flagship Sample: Edge AI Demo Studio 🌟

> **The best way to experience what this Edge Developer Kit can do — in one step.**

[**Edge AI Demo Studio**](./usecases/ai/edge-ai-demo-studio/README.md) is a ready-to-run AI toolkit featuring a web-based UI to deploy and manage AI models on Intel® hardware.

**Includes out-of-the-box AI services:**
- Text Generation (LLM), Text-to-Speech, Speech-to-Text
- Image Generation, Embeddings, Lipsync, Wake Word Detection

**Sample use cases included:**
- Digital Avatar — conversational AI with lip sync
- RAG Chat — retrieval-augmented generation knowledge base

👉 **[Click here to Get started with Edge AI Demo Studio ](./usecases/ai/edge-ai-demo-studio/README.md)**

---

## Who Is This For?

| **Your Background** | **What You'll Get** | **Start Here** |
|-------------------|-------------------|----------------|
| 🏭 **ODM/OEM Developer** | Production-ready platform setup with validated hardware configurations | [Hardware Setup Guide](#validated-hardware--configurations) |
| 🤖 **AI/ML Developer** | Ready-to-use AI workloads: LLMs, computer vision, speech processing | [AI Use Cases](./docs/use-cases.md) |
| 🎓 **Student/Researcher** | Learning-oriented tutorials with step-by-step explanations | [Learning Path](./docs/getting-started.md) |
| 🔧 **Hardware Enthusiast** | Experiment with cutting-edge Intel® hardware and software | [Quick Start](#5-minute-quick-start) |
| 🏆 **ESQ Users** | System validation and certification for hardware qualification | [ESQ Overview](https://github.com/open-edge-platform/edge-system-qualification)|


## 5-Minute Quick Start
1) Run following command:
```bash
sudo bash -c "$(wget -qLO - https://raw.githubusercontent.com/open-edge-platform/edge-developer-kit-reference-scripts/refs/heads/main/main_installer.sh)"

```

### Next Steps

1. **Explore all use cases** from [our gallery](./docs/use-cases.md)
2. **Discover more ingredients** in [Open Edge Platform Software Catalog](https://edgesoftwarecatalog.intel.com/) and [Open Edge Platform GitHub*](https://github.com/open-edge-platform) 
3. **Join the community** on [GitHub* Discussions](https://github.com/open-edge-platform/edge-developer-kit-reference-scripts/discussions)
4. **Share your projects** and help others learn!

## Validated Hardware & Configurations

| Product Collection | Code Name | Support | Validated Hardware |
|--------------|--------------|-------------------|--------------------|
| Intel® Arc™ Pro B-Series Graphics | Products formerly Battlemage | ✅ Supported | [Intel® Arc™ Pro B70 Creator 32GB](https://www.asrock.com/Graphics-Card/Intel/Intel%20Arc%20Pro%20B70%20Creator%2032GB/index.asp) |
| Intel® Arc™ Pro B-Series Graphics | Products formerly Battlemage | ✅ Supported | [Intel® Arc™ Pro B60 Creator 24GB](https://www.asrock.com/Graphics-Card/Intel/Intel%20Arc%20Pro%20B60%20Creator%2024GB/) |
| Intel® Arc™ B-Series Graphics | Products formerly Battlemage | ✅ Supported  |[Intel® Arc™ B580 Challenger 12GB](https://www.asrock.com/Graphics-Card/Intel/Intel%20Arc%20B580%20Challenger%2012GB%20OC/) |
| Intel® Arc™ A-Series Graphics | Products formerly Alchemist | ✅ Supported  | [Intel® Arc™ A770 Challenger 16GB](https://www.asrock.com/Graphics-Card/Intel/Intel%20Arc%20A770%20Challenger%2016GB%20OC/index.us.asp)|
| Intel® Core™ Ultra Processors (Series 3) | Products formerly Panther Lake | ✅ Supported | [AAEON* UP XTREME PTL EDGE](https://www.aaeon.com/en/product/detail/up-systems-up-xtreme-ptl-edge)<br>[ASRock Industrial* NUCS BOX-358H](https://www.asrockind.com/en-gb/NUCS%20BOX-358H)|
| Intel® Core™ Ultra Processors (Series 2) | Products formerly Arrow Lake | ✅ Supported | [Innodisk Intel® Core™ Ultra Series 2 Reference Kit](https://www.innodisk.com/en/blog/intel-core-ultra-series2-reference-kit)<br>[IEI* TANK-XM813](https://www.ieiworld.com/tw/product/model.php?II=1099)<br>[AAEON* UP Xtreme ARL](https://up-board.org/up-xtreme-arl/)<br>[ASRock Industrial* NUC BOX-255H](https://www.asrockind.com/en-gb/NUC%20BOX-255H) |
| Intel® Core™ Ultra Processors (Series 1) | Products formerly Meteor Lake | ✅ Supported | [Seavo* PIR-1014A AIoT Developer Kit](https://www.seavo.com/en/pir_devkit/)<br>[AAEON* UP Xtreme i14](https://up-board.org/up-xtreme-i14/)<br>[ASRock Industrial* NUC BOX-155H](https://www.asrockind.com/en-gb/NUC%20BOX-155H)<br>[Asus* NUC 14 Pro](https://www.asus.com/displays-desktops/nucs/nuc-mini-pcs/asus-nuc-14-pro/) |
| Intel® Core™ Processors (Series 2) | Products formerly Bartlett Lake | ✅ Supported | [ASRock Industrial* iEPF-100000S Series](https://www.asrockind.com/en-gb/iEPF-10000S%20Series) |
| Intel® 14th Gen Core™ Processors | Products formerly Raptor Lake | ✅ Supported | [ASRock Industrial* iEPF-9030S-EW4](https://www.asrockind.com/en-gb/iEPF-9030S-EW4)|
| Intel® Core™ Processor N-Series | Products formerly Twin Lake | ✅ Supported | [AAEON* RS-UPN-ADLN355-A10-0864](https://www.aaeon.com/en/product/detail/up-boards-up-squared-pro-twl) |

## Edge Design Combinations Matrix

The following table lists the validated hardware combinations using Developer Kit Reference Scripts.

| CPU | GPU Configuration | Support |
|--------------|-------------------|---------|
| **Arrow Lake (ARL)** | Arc B70 (dGPU) | ✅ Supported |
| **Arrow Lake (ARL)** | 2 x Arc B70 (dGPU) | ✅ Supported |
| **Arrow Lake (ARL)** | Arc B60 (dGPU) | ✅ Supported |
| **Arrow Lake (ARL)** | Arc B580 (dGPU) | ✅ Supported |
| **Arrow Lake (ARL)** | Arc A770 (dGPU) | ✅ Supported |
| **Bartlett Lake (BTL)** | Arc B60 (dGPU) | ✅ Supported |
| **Bartlett Lake (BTL)** | 2 x Arc B60 (dGPU) | ✅ Supported |
| **Raptor Lake (RPL)** | Arc B60 (dGPU) | ✅ Supported |


## Community and Support

If you need help, want to suggest a new feature, or report a bug, use the following channels:

- **Installation Issues** → [Troubleshooting Guide](./docs/troubleshooting.md)
- **Common Questions** → [FAQ](./docs/faq.md)
- **Community Support** → [GitHub* Discussions](https://github.com/open-edge-platform/edge-developer-kit-reference-scripts/discussions)
- **Bug Reports** → [GitHub* Issues](https://github.com/open-edge-platform/edge-developer-kit-reference-scripts/issues)
- **Feature Requests** → [GitHub* Discussions](https://github.com/open-edge-platform/edge-developer-kit-reference-scripts/discussions)
- **General Questions** →[Community Forum](https://community.intel.com/)


---

## Important Notes


### Development Status
This repository contains pre-production code and is intended for testing and evaluation purposes only. The code and features provided here are in development and may be incomplete, unstable, or subject to change without notice. Use this repository at your own risk.

The reference scripts provided in this repository have been validated and tested on the hardware listed in the documentation. While we strive to ensure compatibility and performance, these scripts may not function as expected on other hardware configurations. Users may encounter issues or unexpected behavior when running the scripts on untested hardware. If you encounter any issues or have suggestions for improvements, we welcome you to open an issue.

### License Notes

The Edge Developer Kit Reference Scripts project and its components is licensed under the [APACHE 2.0](./LICENSE) license, except for the following components:

| Component | License |
|:----------|:--------|
| Real Time | BSD-3-Clause |
| GStreamer | [LGPL](https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html) |


### Contributing
We welcome contributions! Check our [Contributing Guide](./CONTRIBUTING.md) to get started.

---
