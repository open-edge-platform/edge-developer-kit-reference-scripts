#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "Error: Please run this script as root."
  exit 1
fi

VM_ID=201
VM_NAME="openwrt-vm"
IMAGE_DIR="/var/lib/vz/template/iso"
OPENWRT_VERSION="25.12.2"
OPENWRT_ARCHIVE="openwrt-${OPENWRT_VERSION}-x86-64-generic-ext4-combined-efi.img.gz"
OPENWRT_IMAGE="${OPENWRT_ARCHIVE%.gz}"
OPENWRT_URL="https://downloads.openwrt.org/releases/${OPENWRT_VERSION}/targets/x86/64/${OPENWRT_ARCHIVE}"
UCI_DEFAULTS_FILE="/tmp/99-patient-monitoring"

echo "Installing required host tools..."
apt update -y
apt install -y wget gzip libguestfs-tools

echo "Preparing OpenWRT image..."
mkdir -p "$IMAGE_DIR"
cd "$IMAGE_DIR"

if [ ! -f "$OPENWRT_ARCHIVE" ] && [ ! -f "$OPENWRT_IMAGE" ]; then
  wget -O "$OPENWRT_ARCHIVE" "$OPENWRT_URL"
fi

if [ -f "$OPENWRT_ARCHIVE" ] && [ ! -f "$OPENWRT_IMAGE" ]; then
  gunzip -f "$OPENWRT_ARCHIVE"
fi

echo "Creating injected first-boot script (${UCI_DEFAULTS_FILE})..."
cat > "$UCI_DEFAULTS_FILE" <<'EOF'
#!/bin/sh

set -e

LOG_FILE="/root/openwrt-firstboot.log"
exec >>"$LOG_FILE" 2>&1

echo "===== OpenWRT first-boot start: $(date) ====="
trap 'rc=$?; echo "[ERROR] first-boot failed at line $LINENO (rc=$rc) on $(date)"; exit $rc' ERR

# Network layout:
# - WAN on eth0 (connected to vmbr0 NAT bridge 192.168.100.0/24)
# - LAN bridge on eth1 (connected to vmbr1)
cat > /etc/config/network <<'NETWORK_EOF'
config interface 'loopback'
  option device 'lo'
  option proto 'static'
  option ipaddr '127.0.0.1'
  option netmask '255.0.0.0'

config device
  option name 'br-lan'
  option type 'bridge'
  list ports 'eth1'

config interface 'lan'
  option device 'br-lan'
  option proto 'static'
  option ipaddr '10.0.0.1'
  option netmask '255.255.255.0'

config interface 'wan'
  option device 'eth0'
  option proto 'static'
  option ipaddr '192.168.100.50'
  option netmask '255.255.255.0'
  option gateway '192.168.100.1'
  option peerdns '0'
  list dns '8.8.8.8'
  list dns '8.8.4.4'
NETWORK_EOF

# Bring network up before package installation.
echo "[STEP] Restarting network"
/etc/init.d/network restart || true
echo "[STEP] Waiting 30s for network to settle"
sleep 30

# Enable WAN masquerading, MSS clamping, and allow OpenWRT UI access on WAN.
WAN_ZONE_INDEX=$(uci show firewall | sed -n "s/^firewall\.@zone\[\([0-9]\+\)\]\.name='wan'$/\1/p" | head -n1)
if [ -n "$WAN_ZONE_INDEX" ]; then
  uci set firewall.@zone[$WAN_ZONE_INDEX].masq='1'

fi

if ! uci -q show firewall | grep -q "name='Allow-HTTP-WAN'"; then
  uci add firewall rule
  uci set firewall.@rule[-1].name='Allow-HTTP-WAN'
  uci set firewall.@rule[-1].src='wan'
  uci set firewall.@rule[-1].proto='tcp'
  uci set firewall.@rule[-1].dest_port='80'
  uci set firewall.@rule[-1].target='ACCEPT'
fi
uci commit firewall
echo "[STEP] Waiting 15s for firewall to settle"
sleep 15
echo "[STEP] Starting firewall"
/etc/init.d/firewall start || true

# Configure DHCP pool on LAN.
uci set dhcp.lan.interface='lan'
uci set dhcp.lan.ignore='0'
uci set dhcp.lan.dhcpv4='server'
uci set dhcp.lan.start='100'
uci set dhcp.lan.limit='51'
uci set dhcp.lan.leasetime='12h'
uci add_list dhcp.lan.dhcp_option='3,10.0.0.1'
uci add_list dhcp.lan.dhcp_option='6,8.8.8.8'
uci commit dhcp
echo "[STEP] Restarting dnsmasq to pick up new DHCP config"
/etc/init.d/dnsmasq restart || true

# Avoid restarting dnsmasq during early first boot; it can race with ubus/init.
# Force direct resolvers for package installation instead of relying on local dnsmasq.
echo "[STEP] Configuring resolv.conf for apk"
cat > /etc/resolv.conf <<'RESOLV_EOF'
nameserver 8.8.8.8
nameserver 8.8.4.4
RESOLV_EOF

# Install web UI and commonly used tools for initial management.
# Install drivers for MT7612U WiFi adapter (if present) to enable wireless connectivity option for patient device.
echo "[STEP] Running apk update"
apk update
echo "[STEP] Installing LuCI and WiFi packages"
apk add luci luci-ssl wpad iwinfo wifi-scripts usbutils kmod-mt76x2u kmod-mt76 kmod-mt76x2 kmod-mt76-usb kmod-cfg80211 kmod-mac80211


# Configure WiFi AP and bind it to LAN.
echo "[STEP] Waiting for WiFi phy to appear"
for i in $(seq 1 20); do
  [ -e /sys/class/ieee80211/phy0 ] && break
  sleep 1
done

# Configure WiFi AP on radio0 and bind it to LAN.
# so the binding stays correct across driver reloads / USB re-enumerations.
PHY_PATH=$(readlink -f /sys/class/ieee80211/phy0/device 2>/dev/null | sed 's|^/sys/devices/||')
echo "[STEP] phy0 path = ${PHY_PATH}"

cat > /etc/config/wireless <<WIRELESS_EOF
config wifi-device 'radio0'
  option type 'mac80211'
  option path '${PHY_PATH}'
  option band '2g'
  option channel '6'
  option htmode 'HT20'
  option country 'US'
  option disabled '0'

config wifi-iface 'ap_lan'
  option device 'radio0'
  option mode 'ap'
  option ssid 'PROVIDE_YOUR_SSID_HERE'
  option encryption 'psk2'
  option key 'PROVIDE_YOUR_PASSWORD_HERE'
  option network 'lan'
WIRELESS_EOF

# Bring up WiFi and print interface status.
uci commit wireless
echo "[STEP] Reloading wifi"
wifi reload
iwinfo || true

# Final dnsmasq restart to guarantee DHCP server picks up committed config.
echo "[STEP] Scheduling final dnsmasq restart and reboot"
(
  sleep 5
  /etc/init.d/dnsmasq restart || true
  sleep 5
  reboot
) &
echo "===== OpenWRT first-boot complete: $(date) ====="
exit 0
EOF

chmod 0755 "$UCI_DEFAULTS_FILE"

echo "Injecting /etc/uci-defaults/99-patient-monitoring into OpenWRT image..."
virt-customize \
  -a "$IMAGE_DIR/$OPENWRT_IMAGE" \
  --upload "$UCI_DEFAULTS_FILE:/etc/uci-defaults/99-patient-monitoring" \
  --run-command 'chmod 0755 /etc/uci-defaults/99-patient-monitoring'

echo "Creating OpenWRT VM ${VM_ID}..."
if qm status "$VM_ID" >/dev/null 2>&1; then
  echo "Error: VM ID ${VM_ID} already exists. Remove it or change VM_ID in this script."
  exit 1
fi

qm create "$VM_ID" \
  --name "$VM_NAME" \
  --memory 512 \
  --cores 2 \
  --cpu host \
  --net0 virtio,bridge=vmbr0 \
  --net1 virtio,bridge=vmbr1 \
  --ostype l26 \
  --bios ovmf \
  --machine q35 \
  --serial0 socket \
  --vga serial0 \
  --onboot 1

echo "Importing OpenWRT image into VM storage..."
qm importdisk "$VM_ID" "$IMAGE_DIR/$OPENWRT_IMAGE" local-lvm

echo "Attaching disk and setting boot order..."
qm set "$VM_ID" --scsihw virtio-scsi-pci
qm set "$VM_ID" --scsi0 local-lvm:vm-${VM_ID}-disk-0
qm set "$VM_ID" --boot order=scsi0
qm set "$VM_ID" --efidisk0 local-lvm:0,size=4M

if lsusb | grep -qi '0e8d:7612'; then
  echo "Adding USB passthrough adapter 0e8d:7612..."
  qm set "$VM_ID" --usb0 host=0e8d:7612
else
  echo "USB adapter 0e8d:7612 not detected; skipping passthrough"
fi

echo "Starting OpenWRT VM..."
qm start "$VM_ID"

echo
echo "OpenWRT VM setup complete."
echo "Injected first-boot script: /etc/uci-defaults/99-patient-monitoring"
echo "Please wait for 5 minutes for the setup to complete, then proceed to validation step in documentation."