# Setup OpenWRT VM on Proxmox

## Overview

This guide explains how to setup OpenWRT Virtual Machine on Promox Host (Patient Monitoring Hub).

## Table of Contents

- [Before You Start](#before-you-start)
- [Run the Script](#run-the-script)
- [What the `openwrt_setup.sh` Does](#what-the-openwrt_setupsh-does)
- [Validation Step After Setup](#validation-step-after-setup)
- [Important Notes](#important-notes)
- [Next Step](#next-step)

## Before You Start

- Run commands as `root` on the Proxmox host.
- Confirm bridge layout is ready:
  - `vmbr0` for OpenWRT NAT network (`192.168.100.0/24`)
  - `vmbr1` for OpenWRT LAN side
  - `vmbr0_ethernet` (or active wireless interface) as the host WAN uplink
- Confirm VM ID `201` is available, or change `VM_ID` in the [script](../scripts/openwrt_setup.sh).
- Optional for WiFi AP mode: plug in USB Wi-Fi adapter `0e8d:7612` before running the script.

## Run the Script

1. Log in to the Proxmox host console.
2. Go to the script folder `cd edge-developer-kit-reference-scripts/samples/patient-monitoring-hub/scripts`
3. (For USB WiFi AP) Edit file `openwrt_setup.sh` and add your preferred SSID and password at this section:
	```
	config wifi-iface 'ap_lan'
	  option device 'radio0'
	  option mode 'ap'
	  option ssid 'PROVIDE_YOUR_SSID_HERE'
	  option encryption 'psk2'
	  option key 'PROVIDE_YOUR_PASSWORD_HERE'
	  option network 'lan'
  	```
4. Run:

	```bash
	bash openwrt_setup.sh
	```

## What the `openwrt_setup.sh` Does

1. Installs required host tools (`wget`, `gzip`, `libguestfs-tools`).
2. Downloads OpenWRT `25.12.2` x86-64 ext4 EFI image and decompresses it.
3. Creates a first-boot script and injects it into the OpenWRT image at `/etc/uci-defaults/99-patient-monitoring` using `virt-customize`; this script runs automatically on first boot.
4. Configures the injected script to set up:
   - Network interfaces: loopback, WAN on `eth0` (`192.168.100.50/24`), LAN on `eth1` (`br-lan`, `10.0.0.1/24`)
   - Firewall with WAN masquerading and HTTP access for web UI
   - DHCP pool on LAN (`10.0.0.100–10.0.0.150`, 12h lease)
   - Required packages (`luci`, `luci-ssl`, `wpad`, WiFi drivers for MT7612U)
   - Wireless AP on `radio0` bridged to LAN (if USB adapter detected)
5. Creates OpenWRT VM `201` with 512 MB RAM, 2 vCPU, OVMF UEFI, and q35 machine type.
6. Attaches NICs: `net0` to `vmbr0` (WAN) and `net1` to `vmbr1` (LAN).
7. Adds USB passthrough if adapter `0e8d:7612` is detected, then starts the VM.

## Validation Step After Setup

1. On the Proxmox host, verify VM is running and configured:

   ```bash
   qm status 201
   ```

   Expected: `status: running`

2. Open the OpenWRT VM console and check that the first-boot configuration completed:

   ```bash
   qm terminal 201
   tail -n 5 /root/openwrt-firstboot.log
   ip addr show eth0 
   ip addr show eth1
   iwinfo #If you have USB WiFi AP setup
   ```

   Expected: Log shows with `OpenWRT first-boot complete`, `eth0` has `192.168.100.50/24`, and `eth1` is present. If you have USB WiFi AP setup, you should be able to see the AP information.

   To exit from OpenWRT terminal, press Ctrl + O

## Important Notes

- If VM `201` already exists, the script exits and asks you to use a different VM ID.
- The injected `/etc/uci-defaults/99-patient-monitoring` is a first-boot script and is intended to run once.
- If `phy0` does not appear, confirm USB passthrough and driver detection inside OpenWRT (`lsusb`, `iw phy`, `logread`).

## Next Step

[Setup Central Monitoring System Server](./server_setup.md)