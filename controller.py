#!/usr/bin/env python3
"""
Raspberry Pi Bandwidth Controller
PPPoE Compatible - Device based rate limiting
"""

import subprocess
import json
import time
from pathlib import Path

# ================== CONFIG ==================
LAN_INTERFACE = "eth1"          # Archer C6 যেদিকে কানেক্ট (LAN)
WAN_INTERFACE = "ppp0"          # PPPoE ইন্টারফেস (সাধারণত ppp0)
DB_FILE = "/opt/bandwidth/devices.json"

class BandwidthController:

    def __init__(self):
        self.devices = self.load_devices()

    def load_devices(self):
        if Path(DB_FILE).exists():
            with open(DB_FILE) as f:
                return json.load(f)
        return {}

    def save_devices(self):
        Path(DB_FILE).parent.mkdir(parents=True, exist_ok=True)
        with open(DB_FILE, "w") as f:
            json.dump(self.devices, f, indent=2)

    def run(self, cmd):
        subprocess.run(cmd, shell=True, check=False)

    def clear_all_limits(self):
        """সব পুরনো লিমিট মুছে ফেলে"""
        self.run(f"tc qdisc del dev {LAN_INTERFACE} root 2>/dev/null || true")
        self.run(f"tc qdisc add dev {LAN_INTERFACE} root handle 1: htb default 999")
        self.run(f"tc class add dev {LAN_INTERFACE} parent 1: classid 1:999 htb rate 1000mbit")

    def set_device_limit(self, ip: str, download_kbps: int, upload_kbps: int = None):
        """
        নির্দিষ্ট IP-তে Download লিমিট দেয়
        download_kbps = 3072 মানে 3 Mbps
        """
        if upload_kbps is None:
            upload_kbps = max(download_kbps // 2, 512)

        class_id = abs(hash(ip)) % 9000 + 100

        # Download limit (LAN interface)
        self.run(f"tc class add dev {LAN_INTERFACE} parent 1: classid 1:{class_id} htb rate {download_kbps}kbit ceil {download_kbps}kbit")
        self.run(f"tc filter add dev {LAN_INTERFACE} parent 1: protocol ip prio 1 u32 match ip dst {ip}/32 flowid 1:{class_id}")

        print(f"[+] Limit set → {ip} | Download: {download_kbps} kbps | Upload: {upload_kbps} kbps")

    def block_device(self, ip: str):
        self.run(f"iptables -I FORWARD -s {ip} -j DROP")
        self.run(f"iptables -I FORWARD -d {ip} -j DROP")
        print(f"[!] Blocked → {ip}")

    def unblock_device(self, ip: str):
        self.run(f"iptables -D FORWARD -s {ip} -j DROP 2>/dev/null || true")
        self.run(f"iptables -D FORWARD -d {ip} -j DROP 2>/dev/null || true")
        print(f"[+] Unblocked → {ip}")

    def get_connected_devices(self):
        """ARP টেবিল থেকে কানেক্টেড ডিভাইস বের করে"""
        try:
            result = subprocess.check_output("arp -n | grep -v incomplete", shell=True).decode()
            devices = []
            for line in result.strip().split("\n"):
                parts = line.split()
                if len(parts) >= 3:
                    devices.append({
                        "ip": parts[0],
                        "mac": parts[2],
                    })
            return devices
        except:
            return []


if __name__ == "__main__":
    bc = BandwidthController()
    bc.clear_all_limits()

    # উদাহরণ
    # bc.set_device_limit("192.168.1.50", download_kbps=3072)
    # bc.block_device("192.168.1.60")

    print("Connected Devices:")
    for d in bc.get_connected_devices():
        print(d)
