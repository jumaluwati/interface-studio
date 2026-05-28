# Interface Studio

Interface Studio is a local web dashboard for exploring Cisco Catalyst Center interface inventory. It connects to Catalyst Center, lists devices, loads interfaces for selected devices, visualizes port status, and lets users download custom reports for selected devices and interfaces.

The project also includes a CLI helper (`get_interfaces.py`) for users who prefer terminal output plus CSV/JSON exports.

## Features

- Connect to any Catalyst Center using a host, username, and password.
- List network devices and filter by switches, wireless, or all devices.
- Load interfaces for one or more selected devices.
- Show interface totals, up/down counts, and percentages.
- Visual grouped port map by device.
- Filter interfaces by status, type, VLAN, search text, or selected-only mode.
- Select specific interfaces for a report.
- Download custom reports as readable HTML, CSV, or JSON.
- Run fully locally; credentials are not committed to the repository.

## Requirements

- Python 3.10 or newer
- Network reachability from your computer to Catalyst Center
- Catalyst Center user account with permission to read network devices and interfaces
- A browser for the local UI

Python packages:

```bash
pip install -r requirements.txt
```

## Install

```bash
git clone https://github.com/jumaluwati/interface-studio.git
cd interface-studio
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run The Web App

Start the local server:

```bash
python3 web_app.py --port 8765
```

Open:

```text
http://127.0.0.1:8765
```

Then use the page:

1. Enter your Catalyst Center host, username, and password.
2. Leave TLS verification disabled if your lab uses a self-signed certificate.
3. Click **Connect**.
4. Select one or more devices.
5. Click **Load Interfaces**.
6. Filter/select interfaces as needed.
7. Download a report from the report panel.

## Optional Environment Defaults

You can prefill the connection form with environment variables:

```bash
export CATALYST_CENTER_HOST="your-catalyst-center-host-or-ip"
export CATALYST_CENTER_USER="your-username"
export CATALYST_CENTER_PASSWORD="your-password"
python3 web_app.py --port 8765
```

The app also accepts older `DNAC_*` names:

```bash
export DNAC_HOST="your-catalyst-center-host-or-ip"
export DNAC_USER="your-username"
export DNAC_PASS="your-password"
```

Do not commit `.env` files or credentials. The `.gitignore` file excludes common local secret files.

## Run The CLI Helper

Interactive mode:

```bash
python3 get_interfaces.py
```

Direct mode for a known device ID:

```bash
python3 get_interfaces.py <deviceId> --host <catalyst-center-host> --user <username>
```

The CLI prompts for the password unless you pass `--password` or set `CATALYST_CENTER_PASSWORD` / `DNAC_PASS`.

Useful faster mode:

```bash
python3 get_interfaces.py <deviceId> --host <host> --user <user> --no-detail
```

`--no-detail` uses only the bulk interface endpoint and skips the per-interface detail calls.

CLI output files are generated locally as:

```text
interfaces_<device>.json
interfaces_<device>.csv
```

These files are ignored by git because they are generated inventory data.

## Catalyst Center APIs Used

The tool uses these Catalyst Center APIs.

### 1. Authenticate

```http
POST /dna/system/api/v1/auth/token
```

Purpose: gets an auth token using HTTP Basic Auth.

The returned token is sent on later requests as:

```http
x-auth-token: <Token>
```

### 2. List Network Devices

```http
GET /dna/intent/api/v1/network-device
```

Purpose: populates the device picker with hostname, platform, family, management IP, device ID, and related metadata.

### 3. Get Interfaces For A Device

```http
GET /dna/intent/api/v1/interface/network-device/{deviceId}
```

Purpose: gets all interfaces for one selected network device.

This is the main endpoint used by the web dashboard. It provides fields such as:

- interface ID / instance UUID
- port name
- admin status
- operational status
- VLAN
- native VLAN
- speed
- duplex
- MAC address
- description
- interface type
- port mode
- port type

### 4. Get One Interface Detail

```http
GET /dna/intent/api/v1/interface/{interfaceId}
```

Purpose: gets detailed information for a single interface.

The CLI helper uses this endpoint by default after listing interfaces. The web UI normally uses the bulk device-interface endpoint because it already returns the fields needed for the dashboard and reports.

## Local Web App APIs

The browser talks to the local Python backend instead of calling Catalyst Center directly. This avoids browser CORS issues and keeps the Catalyst Center token on the local server process.

### Defaults

```http
GET /api/defaults
```

Returns optional environment-provided defaults for host/user/password.

### Connect

```http
POST /api/connect
```

Request body:

```json
{
  "host": "catalyst-center.example.com",
  "username": "admin",
  "password": "password",
  "verifyTls": false
}
```

The backend authenticates to Catalyst Center, fetches devices, and returns a local session ID.

### Refresh Devices

```http
POST /api/devices
```

Request body:

```json
{
  "sessionId": "local-session-id"
}
```

### Load Interfaces

```http
POST /api/interfaces
```

Request body:

```json
{
  "sessionId": "local-session-id",
  "deviceIds": ["device-uuid-1", "device-uuid-2"],
  "includeDetail": false
}
```

The backend calls Catalyst Center once per selected device:

```http
GET /dna/intent/api/v1/interface/network-device/{deviceId}
```

If `includeDetail` is set to `true`, it also calls:

```http
GET /dna/intent/api/v1/interface/{interfaceId}
```

for each interface.

## Data Flow

```text
Browser UI
  -> local Python backend (web_app.py)
    -> Catalyst Center auth API
    -> Catalyst Center network-device API
    -> Catalyst Center interface APIs
  <- normalized device/interface JSON
Browser UI
  -> filters, port map, selection, report export
```

## Report Downloads

Reports are generated in the browser from loaded data. No additional server-side file is created.

Supported formats:

- HTML: readable report suitable for opening/printing
- CSV: spreadsheet-friendly report
- JSON: raw structured report data

The user can choose:

- selected interfaces
- current filtered view
- all loaded interfaces
- which fields are included

## Notes About TLS

Catalyst Center labs often use self-signed certificates. The app disables certificate verification by default for lab convenience. Enable **Verify TLS certificate** in the UI when your Catalyst Center has a trusted certificate.

## Files In This Repository

```text
web_app.py          Local web server and Catalyst Center API proxy
get_interfaces.py   CLI helper for interface inventory export
web/index.html      Dashboard markup
web/styles.css      Dashboard styling
web/app.js          Dashboard behavior and report generation
requirements.txt    Python dependencies
.gitignore          Keeps generated exports and secrets out of git
README.md           Setup and usage guide
```

Generated inventory exports such as `interfaces_*.json` and `interfaces_*.csv` are intentionally not part of the repository.
