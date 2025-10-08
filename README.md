
# Edge Developer Kit Reference Scripts


**Transform your Intel® hardware into a powerful AI and edge computing platform in minutes, not hours.**


Whether you're an ODM/OEM developer, AI/ML engineer, university student, or hardware enthusiast, this repository provides everything you need to unlock the full potential of Intel® latest processors and GPUs.


This repository provides simplified developer kit reference setup scripts for various Intel® platforms and GPUs.

> **⚡ Quick Start:** Get running in 5 minutes with our [one-line installer](#-5-minute-quick-start)

> **🚧 Note:** The main branch contains the latest development version of the project. It may include experimental features, work in progress, or unstable code.

## 🎯 Who Is This For?

| **Your Background** | **What You'll Get** | **Start Here** |
|-------------------|-------------------|----------------|
| 🏭 **ODM/OEM Developer** | Production-ready platform setup with validated hardware configurations | [Hardware Setup Guide](#-validated-hardware--configurations) |
| 🤖 **AI/ML Developer** | Ready-to-use AI workloads: LLMs, computer vision, speech processing | [AI Use Cases](#-ai--ml-use-cases) |
| 🎓 **Student/Researcher** | Learning-oriented tutorials with step-by-step explanations | [Learning Path](./docs/getting-started/README.md) |
| 🔧 **Hardware Enthusiast** | Experiment with cutting-edge Intel* hardware and software | [Quick Start](#-5-minute-quick-start) |
| 🏆 **ESQ Users** | System validation and certification for hardware qualification | [ESQ Overview](https://www.intel.com/content/www/us/en/developer/articles/guide/edge-software-device-qualification.html)|


## 🚀 5-Minute Quick Start

**Just bought an Intel developer kit?** Get up and running immediately:

```bash
# One command to rule them all
sudo bash -c "$(wget -qLO - https://raw.githubusercontent.com/intel/edge-developer-kit-reference-scripts/refs/heads/main/main_installer.sh)"
```

> **First time?** → Follow our [detailed setup guide](./docs/getting-started.md) for a guided experience.

### 🚀 **Next Steps**

1. **Explore all use cases** from [our gallery](./docs/use-cases.md)
2. **Discover more ingredients** in [Open Edge Platform Software Catalog](https://edgesoftwarecatalog.intel.com/) and [Open Edge Platform GitHub](https://github.com/open-edge-platform) 
2. **Join the community** on [GitHub Discussions](https://github.com/intel/edge-developer-kit-reference-scripts/discussions)
3. **Share your projects** and help others learn!

## 📋 Table of Contents

- [🎯 Who Is This For?](#-who-is-this-for)
- [🚀 5-Minute Quick Start](#-5-minute-quick-start)
- [💻 Validated Hardware & Configurations](#-validated-hardware--configurations)
- [🤖 AI & ML Use Cases](./docs/use-cases.md)
- [❓ Need Help?](#-need-help)
- [⚠️ Important Notes](#️-important-notes)

## 💻 Validated Hardware & Configurations

| Product Collection | Code Name | Support | Validated Hardware |
|--------------|--------------|-------------------|--------------------|
| Intel® Arc™ Pro B-Series Graphics | Products formerly Battlemage | ✅ Supported | [Intel Arc Pro B60 Creator 24GB](https://www.asrock.com/Graphics-Card/Intel/Intel%20Arc%20Pro%20B60%20Creator%2024GB/) |
| Intel® Arc™ B-Series Graphics | Products formerly Battlemage | ✅ Supported  | |
| Intel® Arc™ A-Series Graphics | Products formerly Alchemist | ✅ Supported  | |
| Intel® Core™ Ultra Processors (Series 2) | Products formerly Arrow Lake | ✅ Supported | [Innodisk Intel® Core™ Ultra Series 2 Reference Kit](https://www.innodisk.com/en/blog/intel-core-ultra-series2-reference-kit)<br>[IEI TANK-XM813](https://www.ieiworld.com/tw/product/model.php?II=1099)<br>[AAEON UP Xtreme ARL](https://up-board.org/up-xtreme-arl/)<br>[ASRock Industrial NUC BOX-255H](https://www.asrockind.com/en-gb/NUC%20BOX-255H) |
| Intel® Core™ Ultra processors (Series 1) | Products formerly Meteor Lake | ✅ Supported | [Seavo* PIR-1014A AIoT Developer Kit](https://www.seavo.com/en/pir_devkit/)<br>[AAEON* UP Xtreme i14](https://up-board.org/up-xtreme-i14/)<br>[ASRock Industrial* NUC BOX-155H](https://www.asrockind.com/en-gb/NUC%20BOX-155H)<br>[Asus* NUC 14 Pro](https://www.asus.com/displays-desktops/nucs/nuc-mini-pcs/asus-nuc-14-pro/) |
| Intel® Core™ processors (Series 2) | Products formerly Bartlett Lake | ✅ Supported | [ASRock Industrial* iEPF-100000S Series](https://www.asrockind.com/en-gb/iEPF-10000S%20Series) |
| Intel® 14th Gen Core™ processors | Products formerly Raptor Lake | ✅ Supported | [ASRock Industrial* iEPF-9030S-EW4](https://www.asrockind.com/en-gb/iEPF-9030S-EW4)|
| Intel® Core™ Processor N-series | Products formerly Twin Lake | ✅ Supported | AAEON RS-UPN-ADLN355-A10-0864 |

## Edge Design Combinations Matrix

The following table lists the validated hardware combinations using Developer Kit Reference Scripts.

| CPU | GPU Configuration | Support |
|--------------|-------------------|---------|
| **Arrow Lake (ARL)** | Arc B60 (dGPU) | ✅ Supported |
| **Arrow Lake (ARL)** | Arc B580 (dGPU) | ✅ Supported |
| **Arrow Lake (ARL)** | Arc A770 (dGPU) | ✅ Supported |
| **Bartlett Lake (BTL)** | Arc B60 (dGPU) | ✅ Supported |
| **Bartlett Lake (BTL)** | 2 x Arc B60 (dGPU) | ✅ Supported |
| **Raptor Lake (RPL)** | Arc B60 (dGPU) | ✅ Supported |


## ❓ Need Help?


### 🚑 **Quick Solutions**
- **Installation Issues?** → [Troubleshooting Guide](./docs/troubleshooting.md)
- **Common Questions?** → [FAQ](./docs/faq.md)
- **Community Support?** → [GitHub* Discussions](https://github.com/intel/edge-developer-kit-reference-scripts/discussions)

### 📞 **Get Support**
| Issue Type | Where to Go |
|------------|-------------|
| **Bug Reports** | [GitHub* Issues](https://github.com/intel/edge-developer-kit-reference-scripts/issues) |
| **Feature Requests** | [GitHub* Discussions](https://github.com/intel/edge-developer-kit-reference-scripts/discussions) |
| **General Questions** | [Community Forum](https://community.intel.com/) |


---

## ⚠️ Important Notes


### 🛡️ **Development Status**
This repository contains pre-production code and is intended for testing and evaluation purposes only. The code and features provided here are in development and may be incomplete, unstable, or subject to change without notice. Use this repository at your own risk.

The reference scripts provided in this repository have been validated and tested on the hardware listed in the documentation. While we strive to ensure compatibility and performance, these scripts may not function as expected on other hardware configurations. Users may encounter issues or unexpected behavior when running the scripts on untested hardware. If you encounter any issues or have suggestions for improvements, we welcome you to open an issue.

### 📄 **License Notes**

- **GStreamer*:** LGPL licensed - you're responsible for additional licenses if needed → [Learn more](https://gstreamer.freedesktop.org/documentation/frequently-asked-questions/licensing.html)
- **Intel* Components:** Check individual component licenses in installation logs

### 🤝 **Contributing**
We welcome contributions! Check our [Contributing Guide](./CONTRIBUTING.md) to get started.

---


**🎉 Ready to start building amazing AI applications with Intel* hardware? Let's go!** → [Choose your first project](./docs/use-cases.md)

---