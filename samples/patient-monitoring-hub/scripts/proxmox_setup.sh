#!/bin/bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

# This script sets up Proxmox VE on a Debian-based system.

if [ "$EUID" -ne 0 ]; then
    echo "Error: Please run this script as root."
    exit 1
fi

# apt update and install necessary packages
echo "Updating package lists and installing necessary packages..."
apt update -y
apt install -y libnl-genl-3-200 iw wpasupplicant rfkill
echo "iptables-persistent iptables-persistent/autosave_v4 boolean true" | debconf-set-selections
DEBIAN_FRONTEND=noninteractive apt install -y iptables-persistent netfilter-persistent

# Create vmbr1 bridge for OpenWRT LAN if it does not already exist.
INTERFACES_FILE="/etc/network/interfaces"
if [ -f "$INTERFACES_FILE" ]; then
    if ! grep -q "^auto vmbr1$" "$INTERFACES_FILE"; then
        cat <<'EOF' >> "$INTERFACES_FILE"

auto vmbr1
iface vmbr1 inet manual
    bridge-ports none
    bridge-stp off
    bridge-fd 0
EOF
        echo "Added vmbr1 bridge configuration to $INTERFACES_FILE"
    else
        echo "vmbr1 bridge configuration already exists in $INTERFACES_FILE"
    fi
else
    echo "Warning: $INTERFACES_FILE not found; skipped vmbr1 configuration"
fi

# If wired ethernet is connected, create vmbr0_ethernet for WAN uplink.
# This keeps vmbr0 available for the NAT bridge network (192.168.100.0/24).
detect_wired_uplink_iface() {
    local iface

    # Prefer default route when it points to a physical wired interface.
    local default_iface
    default_iface=$(ip route show default | awk '{print $5}' | head -n 1)
    if [ -n "$default_iface" ] && [ -d "/sys/class/net/$default_iface" ]; then
        if [ ! -d "/sys/class/net/$default_iface/wireless" ] && [[ "$default_iface" != vmbr* ]] && [[ "$default_iface" != vnet* ]] && [[ "$default_iface" != tap* ]] && [ "$default_iface" != "lo" ]; then
            if [ "$(cat /sys/class/net/"$default_iface"/operstate 2>/dev/null)" = "up" ]; then
                echo "$default_iface"
                return 0
            fi
        fi
    fi

    # Fallback: first active non-wireless, non-virtual interface.
    for iface in $(ip link show | grep "^[0-9]" | awk -F: '{print $2}' | tr -d ' '); do
        if [ "$iface" = "lo" ]; then
            continue
        fi
        if [[ "$iface" == vmbr* || "$iface" == vnet* || "$iface" == tap* ]]; then
            continue
        fi
        if [ -d "/sys/class/net/$iface/wireless" ]; then
            continue
        fi
        if [ "$(cat /sys/class/net/"$iface"/operstate 2>/dev/null)" = "up" ]; then
            echo "$iface"
            return 0
        fi
    done

    return 1
}

ensure_vmbr0_ethernet_bridge() {
    if [ ! -f "$INTERFACES_FILE" ]; then
        return 1
    fi

    local wired_iface
    wired_iface=$(detect_wired_uplink_iface)
    if [ -z "$wired_iface" ]; then
        echo "No active wired uplink detected; skipping vmbr0_ethernet creation"
        return 1
    fi

    if grep -q "^auto vmbr0_ethernet$" "$INTERFACES_FILE"; then
        echo "vmbr0_ethernet bridge configuration already exists in $INTERFACES_FILE"
        return 0
    fi

    # Fresh-install migration path: move existing vmbr0 uplink config to vmbr0_ethernet.
    if grep -q "^auto vmbr0$" "$INTERFACES_FILE" || grep -q "^iface vmbr0 " "$INTERFACES_FILE"; then
        local backup_file
        backup_file="${INTERFACES_FILE}.bak.$(date +%Y%m%d%H%M%S)"
        cp "$INTERFACES_FILE" "$backup_file"

        awk -v wired_iface="$wired_iface" '
        {
            if ($0 ~ /^auto vmbr0$/) {
                print "auto vmbr0_ethernet"
                next
            }

            if ($0 ~ /^iface vmbr0 /) {
                sub(/^iface vmbr0 /, "iface vmbr0_ethernet ")
                in_vmbr0 = 1
                print
                next
            }

            if (in_vmbr0 == 1 && $0 ~ /^[[:space:]]*bridge-ports[[:space:]]+/) {
                print "    bridge-ports " wired_iface
                next
            }

            if (in_vmbr0 == 1 && ($0 ~ /^iface / || $0 ~ /^auto /)) {
                in_vmbr0 = 0
            }

            print
        }
        ' "$INTERFACES_FILE" > "${INTERFACES_FILE}.tmp" && mv "${INTERFACES_FILE}.tmp" "$INTERFACES_FILE"

        echo "Migrated vmbr0 network configuration to vmbr0_ethernet using uplink $wired_iface"
        echo "Backup saved to $backup_file"
    else
        cat <<EOF >> "$INTERFACES_FILE"

auto vmbr0_ethernet
iface vmbr0_ethernet inet manual
    bridge-ports ${wired_iface}
    bridge-stp off
    bridge-fd 0
EOF
        echo "Added vmbr0_ethernet bridge using uplink $wired_iface to $INTERFACES_FILE"
    fi

    return 0
}

ensure_vmbr0_nat_bridge() {
    if [ ! -f "$INTERFACES_FILE" ]; then
        return 1
    fi

    # Ensure vmbr0 exists as NAT bridge gateway for OpenWRT WAN (192.168.100.0/24).
    if ! grep -q "^auto vmbr0$" "$INTERFACES_FILE"; then
        cat <<'EOF' >> "$INTERFACES_FILE"

auto vmbr0
iface vmbr0 inet static
    address 192.168.100.1/24
    bridge-ports none
    bridge-stp off
    bridge-fd 0
EOF
        echo "Added vmbr0 NAT bridge gateway configuration to $INTERFACES_FILE"
        return 0
    fi

    # If vmbr0 exists but is manual, convert to static gateway mode.
    if grep -q "^iface vmbr0 inet manual$" "$INTERFACES_FILE"; then
        sed -i 's/^iface vmbr0 inet manual$/iface vmbr0 inet static/' "$INTERFACES_FILE"
    fi

    # Add vmbr0 address if missing.
    if ! awk '
        BEGIN {in_vmbr0=0; found_addr=0}
        /^iface vmbr0 / {in_vmbr0=1; next}
        in_vmbr0==1 && /^iface / {in_vmbr0=0}
        in_vmbr0==1 && /^[[:space:]]*address[[:space:]]+192\.168\.100\.1\/24$/ {found_addr=1}
        END {exit(found_addr ? 0 : 1)}
    ' "$INTERFACES_FILE"; then
        awk '
        {
            print
            if ($0 ~ /^iface vmbr0 /) {
                print "    address 192.168.100.1/24"
            }
        }
        ' "$INTERFACES_FILE" > "${INTERFACES_FILE}.tmp" && mv "${INTERFACES_FILE}.tmp" "$INTERFACES_FILE"
    fi

    return 0
}

ensure_vmbr0_ethernet_bridge
ensure_vmbr0_nat_bridge

# Persist IPv4 forwarding in sysctl.d so systemd-sysctl applies it at boot.
SYSCTL_FORWARD_FILE="/etc/sysctl.d/99-openwrt-forwarding.conf"
cat > "$SYSCTL_FORWARD_FILE" <<'EOF'
net.ipv4.ip_forward=1
net.ipv4.conf.all.forwarding=1
net.ipv4.conf.default.forwarding=1
EOF
sysctl -w net.ipv4.ip_forward=1 >/dev/null
sysctl -w net.ipv4.conf.all.forwarding=1 >/dev/null
sysctl -w net.ipv4.conf.default.forwarding=1 >/dev/null
sysctl --system >/dev/null
echo "Configured IPv4 forwarding via $SYSCTL_FORWARD_FILE"

# Auto-detect WAN interface for NAT forwarding.
# Preferred topology:
# - vmbr0_ethernet: host WAN uplink (ethernet)
# - vmbr0: reserved for NAT bridge 192.168.100.0/24
# - vmbr1: OpenWRT LAN bridge
detect_wan_interface() {
    # First, check if vmbr0_ethernet exists and is active.
    if [ -d "/sys/class/net/vmbr0_ethernet" ] || \
       { [ -f "$INTERFACES_FILE" ] && grep -q "^auto vmbr0_ethernet$" "$INTERFACES_FILE"; }; then
        echo "vmbr0_ethernet"
        return 0
    fi

    # Next, use default route interface if it is not a reserved LAN/NAT bridge.
    local default_iface
    default_iface=$(ip route show default | awk '{print $5}' | head -n 1)
    
    if [ -n "$default_iface" ]; then
        if [ "$default_iface" != "vmbr0" ] && [ "$default_iface" != "vmbr1" ]; then
            echo "$default_iface"
            return 0
        fi
    fi
    
    # Fallback: check for connected WiFi interfaces
    local wifi_iface
    wifi_iface=$(iw dev 2>/dev/null | grep -A 5 "Interface" | grep "Interface" | awk '{print $2}' | head -n 1)
    if [ -n "$wifi_iface" ]; then
        if iw dev "$wifi_iface" link 2>/dev/null | grep -q "Connected"; then
            echo "$wifi_iface"
            return 0
        fi
    fi
    
    # Fallback: check for active physical ethernet interfaces
    for iface in $(ip link show | grep "^[0-9]" | awk -F: '{print $2}' | tr -d ' '); do
        # Skip loopback and common virtual/bridge interfaces.
        if [[ "$iface" != "lo" && "$iface" != vmbr* && "$iface" != vnet* && "$iface" != tap* ]]; then
            local state
            state=$(cat "/sys/class/net/$iface/operstate" 2>/dev/null)
            if [ "$state" = "up" ]; then
                echo "$iface"
                return 0
            fi
        fi
    done
    
    # If no interface found, return empty
    return 1
}

WAN_IFACE=$(detect_wan_interface)
if [ -z "$WAN_IFACE" ]; then
    echo "Warning: Could not auto-detect WAN interface. Please check network connectivity."
    echo "Skipping NAT forwarding configuration."
else
    echo "Detected WAN interface: $WAN_IFACE"
    
    # Forward Proxmox host TCP/8080 on detected WAN interface to OpenWRT WAN IP TCP/80.
    if ! iptables -t nat -C PREROUTING -i "$WAN_IFACE" -p tcp --dport 8080 -j DNAT --to-destination 192.168.100.50:80 2>/dev/null; then
        iptables -t nat -A PREROUTING -i "$WAN_IFACE" -p tcp --dport 8080 -j DNAT --to-destination 192.168.100.50:80
    fi

    if ! iptables -C FORWARD -p tcp -d 192.168.100.50 --dport 80 -j ACCEPT 2>/dev/null; then
        iptables -A FORWARD -p tcp -d 192.168.100.50 --dport 80 -j ACCEPT
    fi

    if ! iptables -C FORWARD -p tcp -s 192.168.100.50 --sport 80 -j ACCEPT 2>/dev/null; then
        iptables -A FORWARD -p tcp -s 192.168.100.50 --sport 80 -j ACCEPT
    fi

    if ! iptables -t nat -C POSTROUTING -s 192.168.100.50 -o "$WAN_IFACE" -j MASQUERADE 2>/dev/null; then
        iptables -t nat -A POSTROUTING -s 192.168.100.50 -o "$WAN_IFACE" -j MASQUERADE
    fi

    # Allow general internet egress from OpenWRT WAN IP and return traffic.
    if ! iptables -C FORWARD -s 192.168.100.50 -o "$WAN_IFACE" -j ACCEPT 2>/dev/null; then
        iptables -A FORWARD -s 192.168.100.50 -o "$WAN_IFACE" -j ACCEPT
    fi

    if ! iptables -C FORWARD -d 192.168.100.50 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null; then
        iptables -A FORWARD -d 192.168.100.50 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    fi

    echo "Configured NAT forwarding: ${WAN_IFACE}:8080 -> 192.168.100.50:80"
fi

mkdir -p /etc/iptables
iptables-save > /etc/iptables/rules.v4
netfilter-persistent save >/dev/null 2>&1 || true

echo
echo "========== Proxmox Setup Summary =========="
if [ -n "$WAN_IFACE" ] && [ -d "/sys/class/net/$WAN_IFACE/wireless" ]; then
    echo "- Wireless uplink interface: $WAN_IFACE"
elif grep -q "^auto vmbr0_ethernet$" "$INTERFACES_FILE"; then
    echo "- vmbr0_ethernet: configured as WAN uplink bridge"
fi
echo "- vmbr0: reserved bridge for NAT network role (192.168.100.0/24)"
echo "- vmbr1: reserved OpenWRT LAN bridge"
if [ -n "$WAN_IFACE" ]; then
    echo "- Active WAN interface used for forwarding: $WAN_IFACE"
    echo "- Port forwarding: ${WAN_IFACE}:8080 -> 192.168.100.50:80"
else
    echo "- WAN interface auto-detection: failed (NAT forwarding rules were skipped)"
fi
echo "- Network config file: $INTERFACES_FILE"
echo "==========================================="

if [ -t 0 ]; then
    read -r -p "Reboot now to apply network bridge changes? [y/N]: " reboot_answer
    case "$reboot_answer" in
        [yY]|[yY][eE][sS])
            echo "Rebooting system..."
            reboot
            ;;
        *)
            echo "Reboot skipped. Please reboot manually when ready."
            ;;
    esac
else
    echo "Non-interactive session detected. Skipping reboot prompt."
    echo "Please reboot manually to apply bridge changes."
fi
