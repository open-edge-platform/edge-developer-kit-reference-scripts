# Frequently Asked Questions (FAQ)

Quick answers to common questions about Intel® Edge Developer Kits.

## Table of Contents

- [Getting Started](#getting-started)
- [Hardware Compatibility](#hardware-compatibility)
- [Installation Issues](#installation-issues)
- [Performance & Optimization](#performance--optimization)
- [Use Cases & Applications](#use-cases--applications)
- [Troubleshooting](#troubleshooting)

## Getting Started

### **Q: I'm new to AI development. Where should I start?**
**A:** Follow this learning path:
1. Complete our [Getting Started Guide](getting-started/README.md)
2. Try the [OpenWebUI + Ollama](../usecases/ai/openwebui-ollama/README.md) use case (10 minutes)
3. Read [AI Development Basics](guides/ai-development-basics.md) for concepts
4. Join our [community discussions](https://github.com/intel/edge-developer-kit-reference-scripts/discussions) to ask questions

### **Q: Do I need to buy specific hardware?**
**A:** The scripts work with many Intel® platforms, but we recommend:
- **Students/Beginners:** Any Intel® Core™ Ultra system with integrated graphics
- **Professionals:** Intel® Core™ Ultra + Intel® Arc™ GPU (B580 or better)
- **Researchers:** High-end CPU + Intel® Arc™ B60 Pro for maximum performance

Check our [Hardware Selection Guide](getting-started/hardware-selection.md) for detailed recommendations.

### **Q: How long does installation take?**
**A:** 
- **Quick install:** 15-30 minutes (automatic)
- **With reboot:** Add 5-10 minutes for system restart
- **Full validation:** 45-60 minutes including use case testing

## Hardware Compatibility

### **Q: Is my Intel® hardware supported?**
**A:** Check the [compatibility matrix](../README.md#-validated-hardware--configurations). Supported platforms include:
- Intel® Core™ Ultra (Series 1 & 2)
- Intel® Arc™ Graphics (A-Series, B-Series)
- Intel® 14th Gen Core™ processors
- Intel® Core™ N-series


### **Q: What about older Intel® hardware?**
**A:** Older hardware may work with reduced functionality:
- **10th-12th Gen Intel® CPUs:** Basic functionality, no NPU features
- **Older Intel® GPUs:** Limited AI acceleration
- **Very old systems:** May require manual driver installation

For best results, use hardware from our [validated list](../README.md#-validated-hardware--configurations).

## Installation Issues

### **Q: The installer says "unsupported kernel version"**
**A:** You need the HWE (Hardware Enablement) kernel:
```bash
sudo apt install linux-generic-hwe-24.04
sudo reboot
# Then rerun the installer
```

### **Q: Installation fails with permission errors**
**A:** Make sure you're running with sudo:
```bash
sudo ./main_installer.sh
```
Not just `./main_installer.sh`

### **Q: GPU not detected after installation**
**A:** Try these steps:
1. Reboot your system
2. Enable Resizable BAR in BIOS (for Arc GPUs)
3. Run the GPU installer separately: `sudo ./gpu_installer.sh`
4. Check detection: `lspci | grep -i vga`

### **Q: Docker permission denied errors**
**A:** Add your user to the docker group:
```bash
sudo usermod -aG docker $USER
# Log out and log back in
```

## Performance & Optimization

### **Q: AI models are running slowly. How can I speed them up?**
**A:** Check these optimization steps:
1. **GPU Memory:** Ensure you have enough VRAM for your model
2. **Resizable BAR:** Enable in BIOS for Intel Arc GPUs
3. **Model Size:** Try smaller model variants for faster inference
4. **Device Selection:** Verify workloads are using GPU, not CPU

### **Q: How do I check if NPU is being used?**
**A:** NPU usage depends on the application:
- **Check detection:** `ls /dev/intel-npu*`
- **Monitor usage:** Some apps show device utilization in logs
- **Configure manually:** Set environment variables like `STT_DEVICE=NPU` in docker-compose files

### **Q: Can I run multiple AI models simultaneously?**
**A:** Yes, but consider:
- **Memory limits:** Each model needs GPU/system memory
- **Performance impact:** Multiple models compete for resources
- **Multi-GPU setups:** Distribute models across different GPUs

## Use Cases & Applications

### **Q: Which use case should I try first?**
**A:** Based on your interests:
- **AI Beginner:** [OpenWebUI + Ollama](../usecases/ai/openwebui-ollama/README.md) - Like ChatGPT but local
- **Computer Vision:** [AI Video Analytics](../usecases/ai/ai-video-analytics/README.md) - Analyze video content
- **Enterprise AI:** [RAG Toolkit](../usecases/ai/rag-toolkit/README.md) - Build knowledge systems

### **Q: Can I modify the use cases for my needs?**
**A:** Absolutely! The use cases are starting points:
- **Code:** All source code is available and modifiable  
- **Models:** Swap AI models for different capabilities
- **Configuration:** Adjust settings via environment variables
- **Integration:** Use as components in larger applications

### **Q: How do I deploy to production?**
**A:** Consider these steps:
1. **Security:** Review and harden configurations
2. **Monitoring:** Add logging and health checks
3. **Scaling:** Use Kubernetes or similar orchestration
4. **Updates:** Establish model and software update processes

## Troubleshooting

### **Q: Where can I find detailed error logs?**
**A:** Check these locations:
- **Installer logs:** Terminal output during installation
- **System logs:** `/var/log/` directory
- **Docker logs:** `docker logs [container_name]`
- **Application logs:** Usually in the use case directory

### **Q: Use case containers won't start**
**A:** Common fixes:
1. **Check ports:** Ensure required ports aren't in use
2. **Docker status:** Verify Docker is running: `systemctl status docker`
3. **Permissions:** Check file permissions in the use case directory
4. **Resources:** Ensure enough disk space and memory

### **Q: Models won't download or load**
**A:** Try these solutions:
- **Internet connection:** Verify network connectivity
- **Disk space:** Ensure enough space for model files (often several GB)
- **Permissions:** Check that Docker can write to volume mounts
- **Alternative sources:** Some models have mirror download locations

### **Q: Performance is worse than expected**
**A:** Optimization checklist:
- ✅ Latest drivers installed
- ✅ Resizable BAR enabled (Intel Arc GPUs)
- ✅ Adequate cooling (check for thermal throttling)
- ✅ Power settings optimized for performance
- ✅ Models running on GPU, not CPU fallback

## Still Need Help?

### **Found a Bug?**
- **Report it:** [GitHub Issues](https://github.com/intel/edge-developer-kit-reference-scripts/issues)
- **Include:** System info, error messages, steps to reproduce

### **Have a Question?**
- **Community:** [GitHub Discussions](https://github.com/intel/edge-developer-kit-reference-scripts/discussions)
- **Documentation:** [Troubleshooting Guide](troubleshooting.md)

### **Want to Contribute?**
- **Improvements:** Submit pull requests with fixes or enhancements
- **Documentation:** Help improve guides and examples
- **Use Cases:** Share your custom implementations

---

**Didn't find your answer?** Ask in our [community discussions](https://github.com/intel/edge-developer-kit-reference-scripts/discussions) - we're here to help!
