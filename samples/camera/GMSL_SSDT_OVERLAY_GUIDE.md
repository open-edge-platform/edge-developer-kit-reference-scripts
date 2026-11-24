# GMSL Custom ACPI SSDT Overlay Guide (RealSense D457)

## Prerequisite

- [Ubuntu 24.04.5 LTS (Noble Numbat)](https://releases.ubuntu.com/noble/). Refer to [Ubuntu Desktop installation tutorial](https://ubuntu.com/tutorials/install-ubuntu-desktop#1-overview) if needed.  
- Kernel: 7.0.0-42-generic  

### Target Hardware
| Supported Development Kit | IPU | SerDes | Camera | Interface | Type |
|---|---|---|---|---|---|
| Innodisk Panther Island (AXMB-D160) + Servoss Mountain C-PHY GMSL Carrier Board| Intel® IPU7 (Intel® Core™ Ultra Series 3 / Panther Lake)  |  Maxim `MAX96724` (Deserializer) + `MAX96717` (Serializer) | [Intel® RealSense™ D457](https://realsenseai.com/products/d457-gmsl-fakra/) | GMSL | Depth · Color |

---

## 1. Overview

This guide documents the **zero-touch (non-interactive)** setup script (`apply_custom_ssdt_now.sh`) that automatically:
1. Pre-seeds `debconf` and installs `intel-mipi-gmsl-dkms` (`maxim-serdes` + `grub_ssdt_overlay`) without interactive prompts.
2. Generates a custom 6-channel ASL definition (`custom-board_custom-sensor.asl`) using the reference `_des_common_max96724.asl` and `_des_ch_common_d457.asl` templates.
3. Compiles the ASL to AML and patches `CSI2Bus` bit-packing descriptors for the kernel IPU7 ACPI parser.
4. Packages the CPIO early initrd image (`/boot/ipu7_custom-board_custom-sensor_ssdt.img`) and updates GRUB.
5. Configures the V4L2 media graph (`mc-setup.sh`), creates RealSense symlinks (`upstream-rs-enum.sh`), and validates live 30 FPS streaming across all active video nodes.

## 2. Hardware & ACPI Topology

The custom SSDT overlay enables **6 FAKRA ports** across two `MAX96724` quad deserializers (`DES0` and `DES1`):

* **`DES0` (`\_SB.PC00.I2C0` @ `0x27` $\rightarrow$ `MIPI-0`, 2 Lanes):** Enables all 4 FAKRA ports (`CH00`–`CH03`).
* **`DES1` (`\_SB.PC00.I2C4` @ `0x27` $\rightarrow$ `MIPI-2`, 2 Lanes):** Enables top 2 FAKRA ports (`CH00`–`CH01`).

## 3. End-to-End Setup Instructions

### Step 1: Disable BIOS Camera Configuration
Disable all camera configurations in BIOS, open the System IO menu in the BIOS and set Camera1, Camera2 and Camera3 to **Disabled**
![bios config1](assets/16.png)

### Step 2: Connect the Camera(s)
Connect the RealSense D457 FAKRA coax cable(s) to the desired active port(s) on the Servoss Mountain board:
> **Multi-Camera Port Selection Guidelines:**
> * **Single Camera:** Connect to any of the 6 enabled ports (`DES0` `CH00`–`CH03` or `DES1` `CH00`–`CH01`).
> * **Two Cameras (Sequential Port Testing via `--verify-only`):** Connect to any 2 enabled ports (e.g., two ports on `DES0`, such as `CH00` and `CH01`).
> * **Two Cameras (Simultaneous Parallel Streaming of Depth + RGB + IR + IMU):** Connect **Camera 1 to `DES0`** (e.g., `CH00`) and **Camera 2 to `DES1`** (e.g., `CH00`).

### Step 3: Run the Master Setup Script
Run `apply_custom_ssdt_now.sh` with `sudo`:

```bash
sudo bash ./apply_custom_ssdt_now.sh
```

### Step 4: Reboot the System
Reboot so GRUB loads the custom ACPI SSDT overlay into the kernel and the `max96724` driver isolates and probes the connected GMSL links:

```bash
sudo reboot
```

### Step 5: Run Post-Reboot Stream Validation
After the system boots, run the script with the `--verify-only` flag:

```bash
sudo bash ./apply_custom_ssdt_now.sh --verify-only
```

**Expected Output Summary:**
1. **`[Step 7.1]`:** Confirms `ACPI: SSDT ... custom.aml`, `bind max96724`, and `D4XX Sensor` in `dmesg`.
2. **`[Step 7.2]`:** Runs `/usr/share/camera/acpi/mc-setup.sh` and prints the discovered topology:
   ```text
   Discovered topology:
     DES0  \_SB_.PC00.DES0                    max96724 0-0027 -> Intel IPU7 CSI2 0 (capture base /dev/video0)
       SER3  \_SB_.PC00.DES0.CH03.SER3          max96717 19-0040
       CAM3  \_SB_.PC00.DES0.CH03.SER3.CAM3     DS5 mux 24-0010  (model=d4xx, hid=INTC10CD)
   ```
3. **`[Step 7.3]`:** Runs `/usr/share/camera/acpi/upstream-rs-enum.sh` and lists active `/dev/video-rs-*` and `/dev/d4xx-dfu-*` symlinks.
4. **`[Step 7.4]`:** Displays bound `max96724`, `max96717`, `DS5`, and `D4XX` entities in `/dev/media0`.
5. **`[Step 7.5]`:** Streams 60 frames @ 30 FPS on each configured `/dev/video*` node via `v4l2-ctl` and outputs:
   ```text
   ALL VALIDATION CHECKS PASSED! Camera pipeline is ready at 30 FPS.
   ```

to reconfigure dkms, run:
```bash
sudo bash ./apply_custom_ssdt_now.sh --rebuild-dkms
```
>
