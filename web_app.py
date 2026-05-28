#!/usr/bin/env python3
"""Local web UI for browsing Catalyst Center interface inventory."""

import argparse
import json
import os
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests
import urllib3
from requests.auth import HTTPBasicAuth

urllib3.disable_warnings()

APP_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(APP_DIR, "web")
DEFAULT_HOST = os.environ.get("CATALYST_CENTER_HOST", os.environ.get("DNAC_HOST", ""))
DEFAULT_USER = os.environ.get("CATALYST_CENTER_USER", os.environ.get("DNAC_USER", ""))
DEFAULT_PASS = os.environ.get("CATALYST_CENTER_PASSWORD", os.environ.get("DNAC_PASS", ""))
TIMEOUT = 30
SESSION_TTL_SECONDS = 4 * 60 * 60

SESSIONS: Dict[str, Dict[str, Any]] = {}


class CatalystCenterClient:
    def __init__(self, host: str, username: str, password: str, verify_tls: bool):
        normalized = host.strip().rstrip("/")
        if not normalized.startswith(("http://", "https://")):
            normalized = f"https://{normalized}"
        self.base_url = normalized
        self.verify_tls = verify_tls
        self.session = requests.Session()
        self.session.headers.update({"Accept": "application/json"})
        self.login(username, password)

    def login(self, username: str, password: str) -> None:
        response = requests.post(
            f"{self.base_url}/dna/system/api/v1/auth/token",
            auth=HTTPBasicAuth(username, password),
            verify=self.verify_tls,
            timeout=TIMEOUT,
        )
        response.raise_for_status()
        self.session.headers["x-auth-token"] = response.json()["Token"]

    def get(self, path: str, **params: Any) -> Dict[str, Any]:
        response = self.session.get(
            f"{self.base_url}{path}",
            params=params or None,
            verify=self.verify_tls,
            timeout=TIMEOUT,
        )
        response.raise_for_status()
        return response.json()

    def devices(self) -> List[Dict[str, Any]]:
        return self.get("/dna/intent/api/v1/network-device").get("response", [])

    def interfaces(self, device_id: str) -> List[Dict[str, Any]]:
        data = self.get(f"/dna/intent/api/v1/interface/network-device/{device_id}")
        response = data.get("response", data)
        if isinstance(response, list):
            return response
        if isinstance(response, dict):
            for key in ("interfaces", "items", "data"):
                if isinstance(response.get(key), list):
                    return response[key]
            return [response]
        return []

    def interface_detail(self, interface_id: str) -> Dict[str, Any]:
        return self.get(f"/dna/intent/api/v1/interface/{interface_id}").get(
            "response", {}
        )


def compact_device(device: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": device.get("id"),
        "hostname": device.get("hostname") or device.get("id") or "Unknown device",
        "platformId": device.get("platformId") or "-",
        "family": device.get("family") or "-",
        "managementIpAddress": device.get("managementIpAddress") or "-",
        "softwareVersion": device.get("softwareVersion") or "-",
        "reachabilityStatus": device.get("reachabilityStatus") or "-",
        "role": device.get("role") or device.get("type") or "-",
    }


def compact_interface(
    interface: Dict[str, Any], device: Dict[str, Any]
) -> Dict[str, Any]:
    normalized = dict(interface)
    interface_id = normalized.get("id") or normalized.get("instanceUuid") or ""
    port_name = normalized.get("portName") or normalized.get("name") or interface_id
    normalized["_key"] = f"{device.get('id')}::{interface_id or port_name}"
    normalized["_deviceId"] = device.get("id")
    normalized["_deviceName"] = device.get("hostname") or device.get("id")
    normalized["_devicePlatform"] = device.get("platformId") or "-"
    normalized["_deviceFamily"] = device.get("family") or "-"
    normalized["_portName"] = port_name or "-"
    return normalized


def cleanup_sessions() -> None:
    now = time.time()
    expired = [
        session_id
        for session_id, session in SESSIONS.items()
        if now - session.get("created_at", now) > SESSION_TTL_SECONDS
    ]
    for session_id in expired:
        SESSIONS.pop(session_id, None)


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def log_message(self, format_string: str, *args: Any) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def do_GET(self) -> None:
        route = urlparse(self.path).path
        if route == "/api/health":
            self.send_json({"ok": True})
            return
        if route == "/api/defaults":
            self.send_json(
                {
                    "host": DEFAULT_HOST,
                    "username": DEFAULT_USER,
                    "password": DEFAULT_PASS,
                }
            )
            return
        if route == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        try:
            if route == "/api/connect":
                self.handle_connect()
            elif route == "/api/devices":
                self.handle_devices()
            elif route == "/api/interfaces":
                self.handle_interfaces()
            else:
                self.send_json({"error": "Not found"}, status=404)
        except requests.HTTPError as error:
            response = error.response
            detail = ""
            if response is not None:
                try:
                    detail = response.text[:700]
                except requests.RequestException:
                    detail = ""
            self.send_json(
                {
                    "error": "Catalyst Center request failed",
                    "status": response.status_code if response is not None else None,
                    "detail": detail,
                },
                status=502,
            )
        except requests.RequestException as error:
            self.send_json({"error": "Connection error", "detail": str(error)}, 502)
        except Exception as error:
            self.send_json({"error": "Server error", "detail": str(error)}, 500)

    def handle_connect(self) -> None:
        body = self.read_json()
        host = body.get("host") or DEFAULT_HOST
        username = body.get("username") or DEFAULT_USER
        password = body.get("password") or DEFAULT_PASS
        verify_tls = bool(body.get("verifyTls", False))

        cleanup_sessions()
        client = CatalystCenterClient(host, username, password, verify_tls)
        devices = sorted(
            [compact_device(device) for device in client.devices() if device.get("id")],
            key=lambda device: device.get("hostname", ""),
        )
        session_id = str(uuid.uuid4())
        SESSIONS[session_id] = {
            "client": client,
            "created_at": time.time(),
            "host": host,
            "devices": devices,
        }
        self.send_json({"sessionId": session_id, "host": host, "devices": devices})

    def handle_devices(self) -> None:
        session = self.session_from_body()
        devices = sorted(
            [compact_device(device) for device in session["client"].devices()],
            key=lambda device: device.get("hostname", ""),
        )
        session["devices"] = devices
        self.send_json({"devices": devices})

    def handle_interfaces(self) -> None:
        body = self.read_json()
        session = self.get_session(body.get("sessionId"))
        device_ids = body.get("deviceIds") or []
        include_detail = bool(body.get("includeDetail", False))
        device_map = {device["id"]: device for device in session.get("devices", [])}

        results = []
        errors = []
        for device_id in device_ids:
            device = device_map.get(device_id, {"id": device_id, "hostname": device_id})
            try:
                interfaces = session["client"].interfaces(device_id)
                if include_detail:
                    detailed = []
                    for interface in interfaces:
                        interface_id = interface.get("id") or interface.get("instanceUuid")
                        if interface_id:
                            detailed.append(session["client"].interface_detail(interface_id))
                        else:
                            detailed.append(interface)
                    interfaces = detailed
                results.append(
                    {
                        "device": device,
                        "interfaces": [
                            compact_interface(interface, device) for interface in interfaces
                        ],
                    }
                )
            except requests.HTTPError as error:
                response = error.response
                errors.append(
                    {
                        "deviceId": device_id,
                        "deviceName": device.get("hostname"),
                        "status": response.status_code if response is not None else None,
                        "message": str(error),
                    }
                )
        self.send_json({"results": results, "errors": errors})

    def session_from_body(self) -> Dict[str, Any]:
        return self.get_session(self.read_json().get("sessionId"))

    def get_session(self, session_id: Optional[str]) -> Dict[str, Any]:
        cleanup_sessions()
        if not session_id or session_id not in SESSIONS:
            raise ValueError("Session expired. Connect again.")
        return SESSIONS[session_id]

    def read_json(self) -> Dict[str, Any]:
        content_length = int(self.headers.get("Content-Length") or 0)
        if content_length <= 0:
            return {}
        raw = self.rfile.read(content_length).decode("utf-8")
        return json.loads(raw or "{}")

    def send_json(self, payload: Dict[str, Any], status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local Catalyst Center UI")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--bind", default="127.0.0.1")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), AppHandler)
    print(f"Interface Studio running at http://{args.bind}:{args.port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())