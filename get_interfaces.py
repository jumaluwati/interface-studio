"""
Interactive Catalyst Center interface explorer.

- Connects to any Catalyst Center (prompts for IP/user/pass, with defaults).
- Lists network devices and lets you pick one.
- Pulls every interface on that device and shows a summary table.
- Saves full detail to JSON + CSV alongside this script.

Endpoints used:
  POST /dna/system/api/v1/auth/token
  GET  /dna/intent/api/v1/network-device
  GET  /dna/intent/api/v1/interface/network-device/{deviceId}
  GET  /dna/intent/api/v1/interface/{interfaceId}

Usage:
    python3 get_interfaces.py                       # fully interactive
    python3 get_interfaces.py <deviceId>            # skip device picker
    python3 get_interfaces.py --host 10.1.2.3 ...   # see --help
"""

import argparse
import csv
import getpass
import json
import os
import sys
import time
from typing import Any, Dict, List, Optional

import requests
import urllib3
from requests.auth import HTTPBasicAuth

urllib3.disable_warnings()

# ---------------------------------------------------------------------------
# Defaults (used when the user just hits Enter at the prompts)
# ---------------------------------------------------------------------------
DEFAULT_HOST = os.environ.get("CATALYST_CENTER_HOST", os.environ.get("DNAC_HOST", ""))
DEFAULT_USER = os.environ.get("CATALYST_CENTER_USER", os.environ.get("DNAC_USER", ""))
DEFAULT_PASS = os.environ.get("CATALYST_CENTER_PASSWORD", os.environ.get("DNAC_PASS", ""))

TIMEOUT = 30
SLEEP_BETWEEN = 0.05


# ---------------------------------------------------------------------------
# DNAC client
# ---------------------------------------------------------------------------
class DNAC:
    def __init__(self, host: str, username: str, password: str, verify: bool = False):
        self.base = f"https://{host}".rstrip("/")
        self.verify = verify
        self.session = requests.Session()
        self.session.headers.update({"Accept": "application/json"})
        self._login(username, password)

    def _login(self, username: str, password: str) -> None:
        r = requests.post(
            f"{self.base}/dna/system/api/v1/auth/token",
            auth=HTTPBasicAuth(username, password),
            verify=self.verify,
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        self.session.headers["x-auth-token"] = r.json()["Token"]

    def get(self, path: str, **params: Any) -> Dict[str, Any]:
        r = self.session.get(
            f"{self.base}{path}",
            params=params or None,
            verify=self.verify,
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return r.json()

    def devices(self) -> List[Dict[str, Any]]:
        return self.get("/dna/intent/api/v1/network-device").get("response", [])

    def interfaces(self, device_id: str) -> List[Dict[str, Any]]:
        data = self.get(f"/dna/intent/api/v1/interface/network-device/{device_id}")
        resp = data.get("response", data)
        if isinstance(resp, list):
            return resp
        if isinstance(resp, dict):
            for key in ("interfaces", "items", "data"):
                if isinstance(resp.get(key), list):
                    return resp[key]
            return [resp]
        return []

    def interface(self, interface_id: str) -> Dict[str, Any]:
        return self.get(f"/dna/intent/api/v1/interface/{interface_id}").get(
            "response", {}
        )


# ---------------------------------------------------------------------------
# UI helpers
# ---------------------------------------------------------------------------
def prompt(label: str, default: Optional[str] = None, secret: bool = False) -> str:
    suffix = f" [{default}]" if default and not secret else ""
    while True:
        if secret:
            value = getpass.getpass(f"{label}: ")
        else:
            value = input(f"{label}{suffix}: ").strip()
        if not value and default is not None:
            return default
        if value:
            return value


def pick_device(devices: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not devices:
        print("No devices found on this Catalyst Center.")
        return None

    print()
    print(f"{'#':>3}  {'Hostname':<45} {'Platform':<25} {'Family':<25} {'IP':<15}")
    print("-" * 115)
    for i, d in enumerate(devices, 1):
        print(
            f"{i:>3}  "
            f"{(d.get('hostname') or '-')[:45]:<45} "
            f"{(d.get('platformId') or '-')[:25]:<25} "
            f"{(d.get('family') or '-')[:25]:<25} "
            f"{(d.get('managementIpAddress') or '-'):<15}"
        )

    while True:
        choice = input("\nPick a device # (or 'q' to quit): ").strip().lower()
        if choice in ("q", "quit", "exit"):
            return None
        if choice.isdigit() and 1 <= int(choice) <= len(devices):
            return devices[int(choice) - 1]
        print("Invalid choice.")


def show_interfaces(interfaces: List[Dict[str, Any]]) -> None:
    if not interfaces:
        print("No interfaces returned.")
        return
    print()
    header = (
        f"{'Port':<28} {'Type':<10} {'Admin':<6} {'Status':<6} "
        f"{'VLAN':<6} {'Speed':<10} {'Duplex':<14} {'MAC':<18} Description"
    )
    print(header)
    print("-" * len(header))
    for i in interfaces:
        speed = i.get("speed") or ""
        if speed and str(speed).isdigit():
            speed = f"{int(speed) // 1000} Mbps"
        print(
            f"{(i.get('portName') or '-')[:28]:<28} "
            f"{(i.get('interfaceType') or '-')[:10]:<10} "
            f"{(i.get('adminStatus') or '-')[:6]:<6} "
            f"{(i.get('status') or '-')[:6]:<6} "
            f"{(i.get('vlanId') or '-')[:6]:<6} "
            f"{str(speed)[:10]:<10} "
            f"{(i.get('duplex') or '-')[:14]:<14} "
            f"{(i.get('macAddress') or '-')[:18]:<18} "
            f"{(i.get('description') or '')[:40]}"
        )


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
def save_outputs(
    interfaces: List[Dict[str, Any]], device: Dict[str, Any], out_dir: str
) -> None:
    if not interfaces:
        return
    label = (device.get("hostname") or device.get("id") or "device").replace("/", "_")
    base = os.path.join(out_dir, f"interfaces_{label}")

    with open(f"{base}.json", "w") as f:
        json.dump(interfaces, f, indent=2)

    fields: List[str] = []
    seen = set()
    for d in interfaces:
        for k in d.keys():
            if k not in seen:
                seen.add(k)
                fields.append(k)
    with open(f"{base}.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for d in interfaces:
            w.writerow({k: ("" if v is None else v) for k, v in d.items()})

    print(f"\nSaved: {base}.json")
    print(f"Saved: {base}.csv")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Catalyst Center interface explorer")
    p.add_argument("device_id", nargs="?", help="Skip the device picker.")
    p.add_argument("--host", help=f"Catalyst Center IP/FQDN (default: {DEFAULT_HOST})")
    p.add_argument("--user", help=f"Username (default: {DEFAULT_USER})")
    p.add_argument("--password", help="Password (omit to be prompted)")
    p.add_argument(
        "--no-detail",
        action="store_true",
        help="Skip per-interface detail calls; use the list response only.",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()

    host = args.host or prompt("Catalyst Center host", DEFAULT_HOST)
    user = args.user or prompt("Username", DEFAULT_USER)
    if args.password is not None:
        password = args.password
    elif sys.stdin.isatty():
        password = prompt("Password", DEFAULT_PASS, secret=True) or DEFAULT_PASS
    else:
        password = DEFAULT_PASS

    print(f"\nConnecting to {host} as {user} ...")
    try:
        dnac = DNAC(host, user, password)
    except requests.HTTPError as e:
        print(f"Auth failed: {e}", file=sys.stderr)
        return 2
    except requests.RequestException as e:
        print(f"Connection error: {e}", file=sys.stderr)
        return 2

    # ---- choose device ---------------------------------------------------
    if args.device_id:
        device = {"id": args.device_id, "hostname": args.device_id}
    else:
        devices = sorted(dnac.devices(), key=lambda d: (d.get("hostname") or ""))
        device = pick_device(devices)
        if not device:
            return 0

    device_id = device["id"]
    print(f"\nFetching interfaces for {device.get('hostname') or device_id} ...")

    try:
        interfaces = dnac.interfaces(device_id)
    except requests.HTTPError as e:
        print(f"Failed to list interfaces: {e}", file=sys.stderr)
        return 3

    print(f"  found {len(interfaces)} interfaces")

    # ---- enrich with per-interface detail (optional) ---------------------
    detailed: List[Dict[str, Any]] = []
    if args.no_detail:
        detailed = interfaces
    else:
        for i, intf in enumerate(interfaces, 1):
            iid = intf.get("id") or intf.get("instanceUuid")
            if not iid:
                detailed.append(intf)
                continue
            try:
                detailed.append(dnac.interface(iid))
            except requests.HTTPError as e:
                print(f"  [{i}/{len(interfaces)}] {iid} FAILED: {e}", file=sys.stderr)
                continue
            time.sleep(SLEEP_BETWEEN)

    # ---- show + save -----------------------------------------------------
    show_interfaces(detailed)
    save_outputs(detailed, device, out_dir=os.path.dirname(os.path.abspath(__file__)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
