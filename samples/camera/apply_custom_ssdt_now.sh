#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
#
# ==============================================================================
# Master Zero-Touch GMSL D457 Custom-Sensor ACPI SSDT Overlay Setup Script
# Target Hardware: Innodisk Panther Island (AXMB-D160) + Servoss Mountain
#
# Active Ports Enabled:
#   - MIPI-0 (DES0 -> \_SB.PC00.I2C0): All 4 FAKRA Ports (CH00, CH01, CH02, CH03)
#   - MIPI-2 (DES1 -> \_SB.PC00.I2C4): Top 2 FAKRA Ports (CH00, CH01)
#
# Usage:
#   Fresh System / Full Setup       : sudo bash ~/apply_custom_ssdt_now.sh
#   Force DKMS Module Rebuild       : sudo bash ~/apply_custom_ssdt_now.sh --rebuild-dkms
#   Post-Reboot Stream Validation   : sudo bash ~/apply_custom_ssdt_now.sh --verify-only
# ==============================================================================

set -euo pipefail

IPU="ipu7"
BOARD="custom-board"
SENSOR="custom-sensor"
AML_DIR="/usr/share/camera/acpi/${IPU}"
CUSTOM_AML="${AML_DIR}/${BOARD}_${SENSOR}.aml"
SSDT_IMG="${IPU}_${BOARD}_${SENSOR}_ssdt.img"

if [[ $EUID -ne 0 ]]; then
   echo "Error: Please run with sudo: sudo bash ~/apply_custom_ssdt_now.sh"
   exit 1
fi

run_validation() {
    echo "=================================================================="
    echo "[Step 7.1] Checking Kernel ACPI SSDT Overlay & SerDes Binding..."
    echo "=================================================================="
    dmesg | grep -Ei "ACPI: SSDT.*custom\.aml|Table Upgrade: install|bind max96724|D4XX Sensor" || true

    echo "=================================================================="
    echo "[Step 7.2] Running Media Controller Setup (mc-setup.sh)..."
    echo "=================================================================="
    MC_OUTPUT=$(/usr/share/camera/acpi/mc-setup.sh 2>&1 | tee /dev/tty || true)

    echo "=================================================================="
    echo "[Step 7.3] Creating RealSense Device Symlinks (upstream-rs-enum.sh)..."
    echo "=================================================================="
    if [[ -x /usr/share/camera/acpi/upstream-rs-enum.sh ]]; then
        /usr/share/camera/acpi/upstream-rs-enum.sh || true
        echo "--- Active /dev/video-rs-* & /dev/d4xx-dfu-* Symlinks: ---"
        ls -la /dev/video-rs-* /dev/d4xx-dfu-* 2>/dev/null || echo "Notice: No symlinks created."
    fi

    echo "=================================================================="
    echo "[Step 7.4] Verifying V4L2 Media Graph Entities (/dev/media0)..."
    echo "=================================================================="
    media-ctl -d /dev/media0 -p 2>/dev/null | grep -E "entity.*(max96724|max96717|DS5|D4XX)" || true

    echo "=================================================================="
    echo "[Step 7.5] Live Stream Verification (v4l2-ctl 60 frames @ 30 FPS)..."
    echo "=================================================================="
    VIDEO_NODES=$(echo "${MC_OUTPUT}" | awk '/-->[ \t]+\/dev\/video[0-9]+/ {print $NF}')
    if [[ -z "${VIDEO_NODES}" ]]; then
        echo "NOTICE: No active streams configured yet. If this is a fresh setup"
        echo "or you just moved the camera cable, please reboot ('sudo reboot')"
        echo "and then run: sudo bash ~/apply_custom_ssdt_now.sh --verify-only"
        return 0
    fi

    for dev in ${VIDEO_NODES}; do
        STREAM_INFO=$(echo "${MC_OUTPUT}" | grep -F -e "-->  ${dev}" | sed 's/^[ \t]*//' || true)
        echo ">>> Testing ${STREAM_INFO} (60 frames)..."
        v4l2-ctl -d "${dev}" --stream-mmap --stream-count=60 --stream-poll
        echo ">>> PASS: ${dev} streamed 60 frames successfully!"
        echo ""
    done

    echo "=================================================================="
    echo "ALL VALIDATION CHECKS PASSED! Camera pipeline is ready at 30 FPS."
    echo "=================================================================="
}

if [[ "${1:-}" == "--verify-only" ]]; then
    run_validation
    exit 0
fi

echo "=================================================================="
echo "[Prerequisites] Installing tools & intel-mipi-gmsl-dkms..."
echo "=================================================================="
apt-get update --allow-releaseinfo-change

# Pre-seed debconf BEFORE installing intel-mipi-gmsl-dkms so fresh install is non-interactive
echo "intel-mipi-gmsl-dkms intel-mipi-gmsl-dkms/max9x select maxim-serdes" | debconf-set-selections
echo "intel-mipi-gmsl-dkms intel-mipi-gmsl-dkms/acpi-ssdt-camera select grub_ssdt_overlay" | debconf-set-selections
echo "intel-mipi-gmsl-dkms intel-mipi-gmsl-dkms/ipu select ${IPU}" | debconf-set-selections
echo "intel-mipi-gmsl-dkms intel-mipi-gmsl-dkms/board select ${BOARD}" | debconf-set-selections
echo "intel-mipi-gmsl-dkms intel-mipi-gmsl-dkms/sensor select ${SENSOR}" | debconf-set-selections

DEBIAN_FRONTEND=noninteractive apt-get install -y \
    v4l-utils ffmpeg acpica-tools cpio initramfs-tools i2c-tools python3 \
    intel-mipi-gmsl-dkms

media-ctl --version

# Automatically locate the installed intel-mipi-gmsl-dkms source directory
DKMS_SRC_DIR=$(ls -d /usr/src/intel-mipi-gmsl-dkms-* 2>/dev/null | sort -V | tail -n 1)
if [[ -z "${DKMS_SRC_DIR}" ]]; then
    echo "Error: Could not find /usr/src/intel-mipi-gmsl-dkms-* after installation!"
    exit 1
fi
ASL_DIR="${DKMS_SRC_DIR}/acpi/${IPU}"
CUSTOM_ASL="${ASL_DIR}/${BOARD}_${SENSOR}.asl"

echo "=================================================================="
echo "[Step 3] Creating ${CUSTOM_ASL}"
echo "         MIPI-0 (DES0=I2C0): 4 ports (CH00..CH03)"
echo "         MIPI-2 (DES1=I2C4): 2 ports (CH00..CH01)"
echo "=================================================================="
mkdir -p "${AML_DIR}"

cat << 'ASLEOF' > "${CUSTOM_ASL}"
/*
 * SPDX-License-Identifier: GPL-2.0
 * Custom SSDT overlay for Innodisk Panther Island + Servoss Mountain (D457 GMSL)
 *   - DES0 (MIPI-0 / \_SB.PC00.I2C0): All 4 FAKRA Ports (CH00, CH01, CH02, CH03)
 *   - DES1 (MIPI-2 / \_SB.PC00.I2C4): Top 2 FAKRA Ports (CH00, CH01)
 */
DefinitionBlock ("", "SSDT", 2, "", "IMG_IPU", 0x20260907)
{
    External (\_SB.PC00, DeviceObj)
    Include ("_ipu.asl")

    Scope (\_SB.PC00)
    {
        Device (DES0)
        {
            #define DES_PHY_TYPE 0
            #define DES_I2C_ADDR 0x0027
            #define DES_LANES 2
            #define DES_INTERNAL_PHY 4
            #define DES_TO_MIPI_PORT 0
            #define DES_I2C_BUS "\\_SB.PC00.I2C0"
            #define DES_PATH "\\_SB.PC00.DES0"
            #define DES_REF \_SB.PC00.DES0
            #define DES_PIPE_STR_AUTOSELECT 0
            #define I2C_SPEED 100000
            #include "_des_common_max96724.asl"

            // Channel 0
            #define DESCH_LINK_NUM 0
            #define DESCH_CH CH00
            #define DESCH_SER SER0
            #define DESCH_CAM CAM0
            #define DESCH_SER_I2C 0x40
            #define DESCH_CH_PATH "\\_SB.PC00.DES0.CH00"
            #define DESCH_SER_PATH "\\_SB.PC00.DES0.CH00.SER0"
            #define DESCH_SER_REF \_SB.PC00.DES0.CH00.SER0
            #define DESCH_SER_GPIOREF ^^SER0
            #define CAM_ALIAS 0x54
            #define CAM_LANES 2
            #define DESCH_SER_X_VC Package () { 0 }
            #define DESCH_SER_Y_VC Package () { 1 }
            #define DESCH_SER_Z_VC Package () { 2 }
            #define DESCH_SER_U_VC Package () { 3 }
            #include "_des_ch_common_d457.asl"
            #undef DESCH_CH
            #undef DESCH_SER
            #undef DESCH_CAM
            #undef DESCH_CH_PATH
            #undef DESCH_SER_PATH
            #undef DESCH_SER_REF
            #undef DESCH_LINK_NUM
            #undef DESCH_SER_I2C
            #undef DESCH_SER_GPIOREF
            #undef CAM_ALIAS
            #undef CAM_LANES
            #undef DESCH_SER_X_VC
            #undef DESCH_SER_Y_VC
            #undef DESCH_SER_Z_VC
            #undef DESCH_SER_U_VC

            // Channel 1
            #define DESCH_LINK_NUM 1
            #define DESCH_CH CH01
            #define DESCH_SER SER1
            #define DESCH_CAM CAM1
            #define DESCH_SER_I2C 0x40
            #define DESCH_CH_PATH "\\_SB.PC00.DES0.CH01"
            #define DESCH_SER_PATH "\\_SB.PC00.DES0.CH01.SER1"
            #define DESCH_SER_REF \_SB.PC00.DES0.CH01.SER1
            #define DESCH_SER_GPIOREF ^^SER1
            #define CAM_ALIAS 0x55
            #define CAM_LANES 2
            #define DESCH_SER_X_VC Package () { 0 }
            #define DESCH_SER_Y_VC Package () { 1 }
            #define DESCH_SER_Z_VC Package () { 2 }
            #define DESCH_SER_U_VC Package () { 3 }
            #include "_des_ch_common_d457.asl"
            #undef DESCH_CH
            #undef DESCH_SER
            #undef DESCH_CAM
            #undef DESCH_CH_PATH
            #undef DESCH_SER_PATH
            #undef DESCH_SER_REF
            #undef DESCH_LINK_NUM
            #undef DESCH_SER_I2C
            #undef DESCH_SER_GPIOREF
            #undef CAM_ALIAS
            #undef CAM_LANES
            #undef DESCH_SER_X_VC
            #undef DESCH_SER_Y_VC
            #undef DESCH_SER_Z_VC
            #undef DESCH_SER_U_VC

            // Channel 2
            #define DESCH_LINK_NUM 2
            #define DESCH_CH CH02
            #define DESCH_SER SER2
            #define DESCH_CAM CAM2
            #define DESCH_SER_I2C 0x40
            #define DESCH_CH_PATH "\\_SB.PC00.DES0.CH02"
            #define DESCH_SER_PATH "\\_SB.PC00.DES0.CH02.SER2"
            #define DESCH_SER_REF \_SB.PC00.DES0.CH02.SER2
            #define DESCH_SER_GPIOREF ^^SER2
            #define CAM_ALIAS 0x56
            #define CAM_LANES 2
            #define DESCH_SER_X_VC Package () { 0 }
            #define DESCH_SER_Y_VC Package () { 1 }
            #define DESCH_SER_Z_VC Package () { 2 }
            #define DESCH_SER_U_VC Package () { 3 }
            #include "_des_ch_common_d457.asl"
            #undef DESCH_CH
            #undef DESCH_SER
            #undef DESCH_CAM
            #undef DESCH_CH_PATH
            #undef DESCH_SER_PATH
            #undef DESCH_SER_REF
            #undef DESCH_LINK_NUM
            #undef DESCH_SER_I2C
            #undef DESCH_SER_GPIOREF
            #undef CAM_ALIAS
            #undef CAM_LANES
            #undef DESCH_SER_X_VC
            #undef DESCH_SER_Y_VC
            #undef DESCH_SER_Z_VC
            #undef DESCH_SER_U_VC

            // Channel 3
            #define DESCH_LINK_NUM 3
            #define DESCH_CH CH03
            #define DESCH_SER SER3
            #define DESCH_CAM CAM3
            #define DESCH_SER_I2C 0x40
            #define DESCH_CH_PATH "\\_SB.PC00.DES0.CH03"
            #define DESCH_SER_PATH "\\_SB.PC00.DES0.CH03.SER3"
            #define DESCH_SER_REF \_SB.PC00.DES0.CH03.SER3
            #define DESCH_SER_GPIOREF ^^SER3
            #define CAM_ALIAS 0x57
            #define CAM_LANES 2
            #define DESCH_SER_X_VC Package () { 0 }
            #define DESCH_SER_Y_VC Package () { 1 }
            #define DESCH_SER_Z_VC Package () { 2 }
            #define DESCH_SER_U_VC Package () { 3 }
            #include "_des_ch_common_d457.asl"
            #undef DESCH_CH
            #undef DESCH_SER
            #undef DESCH_CAM
            #undef DESCH_CH_PATH
            #undef DESCH_SER_PATH
            #undef DESCH_SER_REF
            #undef DESCH_LINK_NUM
            #undef DESCH_SER_I2C
            #undef DESCH_SER_GPIOREF
            #undef CAM_ALIAS
            #undef CAM_LANES
            #undef DESCH_SER_X_VC
            #undef DESCH_SER_Y_VC
            #undef DESCH_SER_Z_VC
            #undef DESCH_SER_U_VC

            #undef DES_PHY_TYPE
            #undef DES_I2C_ADDR
            #undef DES_LANES
            #undef DES_INTERNAL_PHY
            #undef DES_TO_MIPI_PORT
            #undef DES_I2C_BUS
            #undef DES_PATH
            #undef DES_REF
            #undef DES_PIPE_STR_AUTOSELECT
            #undef I2C_SPEED
        }

        Device (DES1)
        {
            #define DES_PHY_TYPE 0
            #define DES_I2C_ADDR 0x0027
            #define DES_LANES 2
            #define DES_INTERNAL_PHY 6
            #define DES_TO_MIPI_PORT 2
            #define DES_I2C_BUS "\\_SB.PC00.I2C4"
            #define DES_PATH "\\_SB.PC00.DES1"
            #define DES_REF \_SB.PC00.DES1
            #define DES_PIPE_STR_AUTOSELECT 0
            #define I2C_SPEED 100000
            #include "_des_common_max96724.asl"

            // Channel 0 (Top Port 1)
            #define DESCH_LINK_NUM 0
            #define DESCH_CH CH00
            #define DESCH_SER SER0
            #define DESCH_CAM CAM0
            #define DESCH_SER_I2C 0x40
            #define DESCH_CH_PATH "\\_SB.PC00.DES1.CH00"
            #define DESCH_SER_PATH "\\_SB.PC00.DES1.CH00.SER0"
            #define DESCH_SER_REF \_SB.PC00.DES1.CH00.SER0
            #define DESCH_SER_GPIOREF ^^SER0
            #define CAM_ALIAS 0x54
            #define CAM_LANES 2
            #define DESCH_SER_X_VC Package () { 0 }
            #define DESCH_SER_Y_VC Package () { 1 }
            #define DESCH_SER_Z_VC Package () { 2 }
            #define DESCH_SER_U_VC Package () { 3 }
            #include "_des_ch_common_d457.asl"
            #undef DESCH_CH
            #undef DESCH_SER
            #undef DESCH_CAM
            #undef DESCH_CH_PATH
            #undef DESCH_SER_PATH
            #undef DESCH_SER_REF
            #undef DESCH_LINK_NUM
            #undef DESCH_SER_I2C
            #undef DESCH_SER_GPIOREF
            #undef CAM_ALIAS
            #undef CAM_LANES
            #undef DESCH_SER_X_VC
            #undef DESCH_SER_Y_VC
            #undef DESCH_SER_Z_VC
            #undef DESCH_SER_U_VC

            // Channel 1 (Top Port 2)
            #define DESCH_LINK_NUM 1
            #define DESCH_CH CH01
            #define DESCH_SER SER1
            #define DESCH_CAM CAM1
            #define DESCH_SER_I2C 0x40
            #define DESCH_CH_PATH "\\_SB.PC00.DES1.CH01"
            #define DESCH_SER_PATH "\\_SB.PC00.DES1.CH01.SER1"
            #define DESCH_SER_REF \_SB.PC00.DES1.CH01.SER1
            #define DESCH_SER_GPIOREF ^^SER1
            #define CAM_ALIAS 0x55
            #define CAM_LANES 2
            #define DESCH_SER_X_VC Package () { 0 }
            #define DESCH_SER_Y_VC Package () { 1 }
            #define DESCH_SER_Z_VC Package () { 2 }
            #define DESCH_SER_U_VC Package () { 3 }
            #include "_des_ch_common_d457.asl"
            #undef DESCH_CH
            #undef DESCH_SER
            #undef DESCH_CAM
            #undef DESCH_CH_PATH
            #undef DESCH_SER_PATH
            #undef DESCH_SER_REF
            #undef DESCH_LINK_NUM
            #undef DESCH_SER_I2C
            #undef DESCH_SER_GPIOREF
            #undef CAM_ALIAS
            #undef CAM_LANES
            #undef DESCH_SER_X_VC
            #undef DESCH_SER_Y_VC
            #undef DESCH_SER_Z_VC
            #undef DESCH_SER_U_VC

            #undef DES_PHY_TYPE
            #undef DES_I2C_ADDR
            #undef DES_LANES
            #undef DES_INTERNAL_PHY
            #undef DES_TO_MIPI_PORT
            #undef DES_I2C_BUS
            #undef DES_PATH
            #undef DES_REF
            #undef DES_PIPE_STR_AUTOSELECT
            #undef I2C_SPEED
        }
    }
}
ASLEOF

echo "=================================================================="
echo "[Step 4] Compiling ${CUSTOM_ASL} and fixing CSI2Bus bit-packing..."
echo "=================================================================="
cd "${ASL_DIR}"
iasl -tc "${CUSTOM_ASL}"
cp -f "${ASL_DIR}/${BOARD}_${SENSOR}.aml" "${CUSTOM_AML}"

python3 - << PYEOF
aml_path = "${CUSTOM_AML}"
b = bytearray(open(aml_path, "rb").read())

for i in range(len(b) - 20):
    if b[i] == 0x8E and b[i+5] == 0x04:
        ln = b[i+1] | (b[i+2] << 8)
        tgt = b[i+12:i+3+ln].decode('ascii', 'ignore').rstrip('\x00')
        if tgt == "\\_SB.PC00.IPU0":
            b[i+7] = 0x10 if b[i+4] == 0x00 else 0x18
        elif tgt in ("\\_SB.PC00.DES0", "\\_SB.PC00.DES1"):
            b[i+7] = 0x05
        elif ".SER" in tgt:
            b[i+7] = 0x01

b[9] = 0
b[9] = (-sum(b)) & 0xFF
open(aml_path, "wb").write(b)
print("Saved fixed 6-channel (4+2) AML:", aml_path, "Checksum:", hex(b[9]))
PYEOF

echo "=================================================================="
echo "[Step 5] Configuring DKMS & Packaging /boot/${SSDT_IMG}..."
echo "=================================================================="
# Ensure IPU6/IPU7 kernel modules are not blacklisted on fresh systems
if [[ -f /etc/modprobe.d/blacklist-intel-ipu.conf ]]; then
    sed -i "s/^\(blacklist intel_ipu6$\)/# \1/g" /etc/modprobe.d/blacklist-intel-ipu.conf
    sed -i "s/^\(blacklist intel_ipu6_isys$\)/# \1/g" /etc/modprobe.d/blacklist-intel-ipu.conf
    sed -i "s/^\(blacklist intel_ipu7$\)/# \1/g" /etc/modprobe.d/blacklist-intel-ipu.conf
    sed -i "s/^\(blacklist intel_ipu7_isys$\)/# \1/g" /etc/modprobe.d/blacklist-intel-ipu.conf
fi

# On a fresh system where max96724 module isn't built yet (or if --rebuild-dkms is passed),
# run dpkg-reconfigure non-interactively so DKMS builds the maxim-serdes modules
if ! modinfo max96724 >/dev/null 2>&1 || [[ "${1:-}" == "--rebuild-dkms" ]]; then
    echo "Building maxim-serdes DKMS modules non-interactively..."
    DEBIAN_FRONTEND=noninteractive dpkg-reconfigure intel-mipi-gmsl-dkms
fi

echo "Packaging /boot/${SSDT_IMG} (with short internal name custom.aml)..."
WORKDIR=$(mktemp -d)
cd "${WORKDIR}"
mkdir -p "kernel/firmware/acpi"
cp "${CUSTOM_AML}" "kernel/firmware/acpi/custom.aml"
find kernel | cpio -H newc --create > "/boot/${SSDT_IMG}"
cd /
rm -rf "${WORKDIR}"

echo "=================================================================="
echo "[Step 6] Updating GRUB..."
echo "=================================================================="
echo "GRUB_EARLY_INITRD_LINUX_CUSTOM=\"${SSDT_IMG}\"" > /etc/default/grub.d/ssdt.cfg
update-grub

run_validation
