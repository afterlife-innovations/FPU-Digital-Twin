<p align="center">
  <h1 align="center">⚡ 6S22P Battery Pack Digital Twin</h1>
  <p align="center">
    <strong>Real-Time Cell-Level Monitoring, Diagnostics &amp; Maintenance for Li-ion Battery Packs</strong>
  </p>
  <p align="center">
    <a href="#-quick-start"><img src="https://img.shields.io/badge/quick--start-guide-blue?style=flat-square" alt="Quick Start"></a>
    <img src="https://img.shields.io/badge/version-3.0.0-green?style=flat-square" alt="Version 3.0.0">
    <img src="https://img.shields.io/badge/python-3.11+-3776ab?style=flat-square&logo=python&logoColor=white" alt="Python 3.11+">
    <img src="https://img.shields.io/badge/node-18+-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node 18+">
    <img src="https://img.shields.io/badge/fastapi-0.110+-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI">
    <img src="https://img.shields.io/badge/react-19-61dafb?style=flat-square&logo=react&logoColor=black" alt="React 19">
    <img src="https://img.shields.io/badge/socket.io-realtime-010101?style=flat-square&logo=socket.io" alt="Socket.IO">
    <img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" alt="License MIT">
  </p>
</p>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Quick Start](#-quick-start)
- [Configuration](#%EF%B8%8F-configuration)
- [API Documentation](#-api-documentation)
- [Frontend Components](#-frontend-components)
- [Pack Electrical Specifications](#-pack-electrical-specifications)
- [Data Flow](#-data-flow)
- [Project Structure](#-project-structure)
- [Contributing](#-contributing)
- [Troubleshooting](#-troubleshooting)
- [License](#-license)

---

## 🔋 Overview

The **6S22P Battery Pack Digital Twin** is a production-grade, real-time monitoring and diagnostics platform built for a 132-cell Li-ion 18650 battery pack configured in a **6-series × 22-parallel** topology. It is a core module of the [Afterlife Intelligence](https://afterlife-int-production.up.railway.app) battery-cell lifecycle management ecosystem.

The twin bridges two domains:

| Domain | Description |
|--------|-------------|
| **Physical** | 132 cell slots in a 6S22P matrix, connected to the BMS over an RS485-to-TTL serial link |
| **Digital** | Each cell linked to a unique Afterlife Intelligence digital passport (e.g., `AFI-LIIO-18650-JN39Q`) with full lifecycle telemetry |

The **Pack Assembly Map** is the data structure that binds each physical position (e.g., `S3-P17`) to its corresponding `battery_code`, enabling position-correlated live telemetry, diagnostics, and maintenance.

---

## ✨ Key Features

### Real-Time Telemetry
- **1 Hz cell-level telemetry** via Socket.IO — voltage, temperature, DCIR, SOH per cell
- **Traffic-light health coding** — instant green / yellow / red status at a glance
- **Pack-level aggregates** — total voltage, average temperature, current, voltage delta
- **REST polling fallback** — guaranteed data access when WebSocket is unavailable

### Diagnostics & Anomaly Detection
- **Anomaly alerts** — reports threshold exceedance amounts and 2-sigma statistical outliers
- **Multi-mode color overlays** — Health, Voltage Gradient, Temperature Heatmap, DCIR, SOH
- **Time-series history** — per-cell trend charts across configurable windows (1h, 24h, 7d, 30d)
- **CSV / JSON telemetry export** — offline analysis support

### BMS Integration
- **BMS telemetry input** — RS485-to-TTL serial telemetry; no Modbus adapter is used
- **Raw frame forensics** — inspect decoded BMS protocol frames for debugging
- **Built-in BMS Simulator** — generates realistic 132-cell telemetry with injected fault scenarios for development and demo

### Pack Assembly & Maintenance
- **Interactive Assembly Map** — assign cells to matrix positions individually or via bulk import
- **Afterlife API integration** — validates every battery code against the live inventory before assignment
- **Cell Replacement Wizard** — 3-Tier Cascade BaaS (Battery-as-a-Service) engine:
  - **Tier 1** — Same manufacturer, tight tolerances (±250 mAh, ±5% DCIR, ≤1.5V ΔOCV)
  - **Tier 2** — All manufacturers, standard tolerances
  - **Tier 3** — All manufacturers, widened ballpark thresholds
- **Maintenance event logging** — full audit trail with operator, reason, and timestamp
- **Assembly map versioning** — snapshot-based version history for every map change

### Alerting
- **Configurable threshold rules** — over-current (10A limit), over-temperature, under-voltage
- **Alert lifecycle management** — acknowledge, snooze (configurable duration), and history audit log
- **Notification channels** — CallMeBot WhatsApp anomaly alerts

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Vite + React 19)                │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────────┐  │
│  │ PackGrid │  │PackSumm. │  │CellDetail│  │  Assembly Map   │  │
│  │ (132     │  │(Aggr.    │  │  Modal   │  │  Modal + Bulk   │  │
│  │  cells)  │  │ stats)   │  │+ Tooltip │  │     Import      │  │
│  └────┬─────┘  └──────────┘  └──────────┘  └─────────────────┘  │
│       │                                                          │
│  ┌────┴──────────────────────────────────────────────────────┐   │
│  │   Zustand Store  ←──  Socket.IO Client  ←── REST API      │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────┬───────────────────────────────────────┘
                           │  WebSocket (ws://127.0.0.1:8000)
                           │  REST       (http://127.0.0.1:8000)
┌──────────────────────────┴───────────────────────────────────────┐
│                     BACKEND (FastAPI + Socket.IO)                 │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐        │
│  │                    API Routers                       │        │
│  │  /telemetry  /pack  /passport  /alerts  /bms         │        │
│  └──────────────────────────────────────────────────────┘        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                       Services                              │ │
│  │  TelemetryStore │ Health │ Anomaly │ ReplacementEngine      │ │
│  │  PassportClient │ BMS Adapter │ CAN Adapter │ FrameLogger  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐  │
│  │ BMS Simul.   │  │   SQLAlchemy  │  │  Afterlife API       │  │
│  │ (dev/demo)   │  │   (SQLite /   │  │  Passport Proxy      │  │
│  │              │  │    Neon PG)   │  │  (cloud inventory)   │  │
│  └──────────────┘  └───────────────┘  └──────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │      Physical BMS       │
              │    (RS485-to-TTL)       │
              └─────────────────────────┘
```

---

## 🛠 Tech Stack

### Backend

| Technology | Purpose |
|------------|---------|
| **FastAPI** ≥ 0.110 | Async REST API framework |
| **Uvicorn** ≥ 0.28 | ASGI server with hot-reload |
| **python-socketio** ≥ 5.11 | Real-time WebSocket transport |
| **SQLAlchemy** ≥ 2.0 (async) | ORM with async session support |
| **aiosqlite** ≥ 0.20 | SQLite async driver (default persistence) |
| **httpx** ≥ 0.27 | Async HTTP client for Afterlife API proxy |
| **Pydantic** ≥ 2.6 | Data validation and serialization |
| **pydantic-settings** ≥ 2.2 | Environment-based configuration |

### Frontend

| Technology | Purpose |
|------------|---------|
| **Vite** ≥ 8.2 | Build tool and dev server |
| **React** 19 | UI framework |
| **Zustand** ≥ 5.0 | Lightweight state management |
| **Socket.IO Client** ≥ 4.8 | Real-time telemetry subscription |
| **Three.js** ≥ 0.185 | 3D rendering engine |
| **TypeScript** ~6.0 | Type checking (dev dependency) |

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Minimum Version | Check Command |
|-------------|-----------------|---------------|
| **Python** | 3.11+ | `python --version` |
| **Node.js** | 18+ | `node --version` |
| **npm** | 9+ | `npm --version` |
| **Git** | Any | `git --version` |

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/digital-twin.git
cd digital-twin
```

### 2. Backend Setup

```bash
# Navigate to backend directory
cd backend

# Create and activate a virtual environment (recommended)
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt
```

#### Configure Environment

Copy and configure the environment file:

```bash
# The .env file should already exist with sensible defaults.
# Edit it if you need to change database or API settings.
```

> **Default configuration uses SQLite** — no external database setup required. See [Configuration](#%EF%B8%8F-configuration) for Neon PostgreSQL setup.

#### Start the Backend Server

```bash
python run.py
```

The backend starts at **http://127.0.0.1:8000** with:
- ✅ Database auto-initialization
- ✅ BMS Simulator auto-start (1 Hz telemetry for 132 cells)
- ✅ Hot-reload enabled for development

### 3. Frontend Setup

```bash
# Navigate to frontend directory (from project root)
cd frontend

# Install Node dependencies
npm install

# Start the development server
npm run dev
```

The frontend starts at **http://localhost:5173** and connects to the backend automatically.

### 4. Verify Installation

Open your browser to `http://localhost:5173`. You should see:

1. **Header** — pack ID, connection status indicator (green = connected)
2. **Pack Summary** — aggregate voltage, temperature, current, cell health counts
3. **132-Cell Grid** — live color-coded cells updating at 1 Hz
4. **Hover any cell** — tooltip with live voltage, temperature, DCIR, SOH

Verify the backend API directly:

```bash
# Health check
curl http://127.0.0.1:8000/

# Get latest telemetry snapshot
curl http://127.0.0.1:8000/telemetry/latest

# Check BMS status
curl http://127.0.0.1:8000/bms/status
```

---

## ⚙️ Configuration

All backend configuration is managed through the `.env` file located at `backend/.env`. The application uses Pydantic Settings for type-safe environment variable parsing.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./digital_twin.db` | Database connection string |
| `TWIN_API_KEY` | unset | Required shared secret for ESP32 raw telemetry ingestion |
| `AFTERLIFE_API_BASE_URL` | `https://afterlife-int-production.up.railway.app` | Afterlife Intelligence platform API |
| `PACK_ID` | `PACK-6S22P-001` | Unique identifier for this battery pack |
| `CALLMEBOT_PHONE` | `+254796120248` | WhatsApp number in international format |
| `CALLMEBOT_API_KEY` | unset | API key issued by CallMeBot for the WhatsApp number |

Activate the WhatsApp number by following [CallMeBot's WhatsApp API instructions](https://www.callmebot.com/blog/free-api-whatsapp-messages/), then place the issued API key and the number (E.164 format, e.g. `+254796120248`) in `backend/.env`. Keep the API key private. Alerts are sent through `https://api.callmebot.com/whatsapp.php`; message text is URL-encoded by the HTTP client. Dispatch stays disabled until both settings are present. Newly active anomalies are sent once, and failed requests are retried on a later telemetry frame.

### Database Options

#### SQLite (Default — Zero Setup)

```env
DATABASE_BACKEND=sqlite
DATABASE_URL=sqlite+aiosqlite:///./digital_twin.db
```

No external database is contacted at startup. The backend uses the existing
`backend/digital_twin.db` file and does not create or alter its schema on startup.
The database file and application tables must already exist.

#### Neon PostgreSQL (Cloud Persistence)

```env
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST/DATABASE?sslmode=require
```

To use Neon instead of the local database, explicitly set
`DATABASE_BACKEND=postgresql`. The backend converts the Neon URL to SQLAlchemy's
`postgresql+asyncpg://` dialect and maps `sslmode=require` to asyncpg's TLS
option. asyncpg does not support the CLI's `channel_binding` parameter, so the
backend removes it. `asyncpg` is installed from `backend/requirements.txt`.

### Vercel deployment

The root `vercel.json` configures Vercel Services (currently Beta) to build the
Vite frontend and FastAPI backend from their respective directories and route
the frontend, REST API, and Socket.IO endpoint under one domain. In production,
the frontend uses same-origin HTTPS/WSS; local development keeps using port 8000.
The Socket.IO client selects WebSocket transport for Vercel.

Set these environment variables in the Vercel project before deploying:

- `TWIN_API_KEY`: a long random secret. Set the same value as `API_KEY` in the
  ESP32 sketch. The raw ingest endpoint rejects missing or incorrect keys.
- `DATABASE_BACKEND=postgresql` and `DATABASE_URL`: use a managed PostgreSQL
  database such as Neon. SQLite on Vercel is not durable and its filesystem is
  not a suitable writable database. The backend intentionally does not create
  tables on startup; provision/migrate the schema before using database-backed
  features.
- `CALLMEBOT_PHONE` and `CALLMEBOT_API_KEY` if WhatsApp alerts are required.

**Realtime/persistence caveat:** the current backend keeps latest telemetry,
observer state, and frame buffers in process memory, and writes CSV exports to
local disk. Vercel can route WebSockets to FastAPI, but different function
instances do not share that memory or broadcast channel. Before relying on
multi-instance live telemetry, add shared persistence for the observer/latest
state and a Redis-backed Socket.IO manager; CSV export also needs durable
storage. The current deployment configuration is a starting point, not a
production-ready replacement for those shared services.

Before flashing, update `SERVER_URL` in the sketch to your actual
`https://<project>.vercel.app/telemetry/ingest/raw` URL and replace the `API_KEY`
placeholder with the exact Vercel `TWIN_API_KEY` value. The pasted sketch calls
`WiFiClientSecure::setInsecure()`, which disables TLS certificate verification;
replace that with trusted CA validation before sending live data over the
internet. Change the sketch's default `SETUP_AP_PASS` before flashing as well.
It also sends a Modbus function-code `0x10` request with Modbus CRC, so confirm
that this matches the BMS's configured serial protocol before flashing—the
RS485-to-TTL label describes the physical interface, not the application
protocol.

### Health Threshold Configuration

Health thresholds are defined in `backend/app/config.py` and can be viewed at runtime:

```bash
curl http://127.0.0.1:8000/telemetry/config/thresholds
```

| Metric | Green | Yellow | Red |
|--------|-------|--------|-----|
| **Voltage** | 3.0 – 4.2 V | 2.8 – 4.25 V | Outside yellow |
| **Temperature** | ≤ 45°C | ≤ 55°C | > 55°C |
| **DCIR** | ≤ 50 mΩ | ≤ 75 mΩ | > 75 mΩ |
| **SOH** | ≥ 80% | ≥ 60% | < 60% |
| **Voltage Drift** | — | > 50 mV from string mean | — |

### Pack Configuration Defaults

| Parameter | Value |
|-----------|-------|
| Series groups | 6 |
| Parallel cells per group | 22 |
| Total cells | 132 |
| Charging current limit | 10 A |

---

## 📡 API Documentation

The backend exposes a comprehensive REST API and a real-time Socket.IO interface. Interactive Swagger documentation is available at:

**http://127.0.0.1:8000/docs**

### Telemetry Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/telemetry/latest` | Latest 132-cell telemetry snapshot |
| `GET` | `/telemetry/history/{position}` | Time-series history for a cell (query: `window=1h\|24h\|7d\|30d\|all`) |
| `GET` | `/telemetry/trends` | Aggregate pack-level trend metrics |
| `GET` | `/telemetry/config/thresholds` | Current health thresholds and pack config |
| `GET` | `/telemetry/anomalies` | Cells flagged by 2-sigma deviation engine |
| `GET` | `/telemetry/export` | Export telemetry data (query: `format=csv\|json`) |

### Pack Assembly Map Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/pack/{pack_id}/map` | Full 132-slot assembly map |
| `POST` | `/pack/{pack_id}/map` | Assign a cell to a position (validates against Afterlife API) |
| `POST` | `/pack/{pack_id}/map/bulk` | Bulk assign cells to positions |
| `DELETE` | `/pack/{pack_id}/map/S{s}-P{p}` | Unassign a cell from a position |
| `GET` | `/pack/{pack_id}/progress` | Assembly progress (assigned vs total) |
| `GET` | `/pack/{pack_id}/map/history` | Assembly map version history |

### Cell Replacement & Maintenance Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/pack/{pack_id}/replacements/{position}` | Ranked replacement candidates (3-Tier BaaS engine) |
| `POST` | `/pack/{pack_id}/replace-cell` | Execute cell swap with full lifecycle updates |
| `GET` | `/pack/{pack_id}/maintenance` | Maintenance event history |

### Afterlife Passport Proxy Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/passport/inventory/grades` | Aggregated grade distribution from Afterlife API |
| `GET` | `/passport/search?q={query}` | Search passports by code, legacy ID, chemistry, or source |
| `GET` | `/passport/list` | List passports (query: `page`, `page_size`) |
| `GET` | `/passport/{battery_code}` | Full passport details for a cell |
| `GET` | `/passport/{battery_code}/tests` | Test history for a cell |

### Alert Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/alerts/rules` | List configured alert threshold rules |
| `POST` | `/alerts/rules` | Create/update alert threshold rules |
| `GET` | `/alerts/active` | Currently active unacknowledged alerts |
| `POST` | `/alerts/{alert_id}/acknowledge` | Acknowledge an alert |
| `POST` | `/alerts/{alert_id}/snooze` | Snooze an alert (body: `duration_minutes`) |
| `GET` | `/alerts/history` | Alert audit log |
| `GET` | `/alerts/channels` | Notification channel configuration |
| `POST` | `/alerts/channels` | Update notification channels |

### BMS Hardware & Forensics Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/bms/status` | BMS connection health, protocol state, signal quality |
| `GET` | `/bms/frames` | Raw BMS protocol frames (query: `limit`, `protocol`) |
| `GET` | `/bms/frames/stats` | Aggregate frame buffer statistics |

### Socket.IO Events

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `connect` | Server → Client | — | Emits latest telemetry snapshot on connection |
| `telemetry` | Server → Client | `TelemetryPayload` | 1 Hz full pack telemetry update |
| `disconnect` | Bidirectional | — | Connection lifecycle event |

#### Example: Telemetry Payload Structure

```json
{
  "pack_id": "PACK-6S22P-001",
  "timestamp": "2026-08-25T20:30:00.000Z",
  "pack_current_a": 4.2,
  "pack_voltage_v": 22.14,
  "bms_protocol": "SIMULATED",
  "summary": {
    "total_voltage_v": 22.14,
    "avg_cell_voltage_v": 3.69,
    "min_cell_voltage_v": 3.25,
    "max_cell_voltage_v": 3.82,
    "voltage_delta_mv": 570.0,
    "avg_temperature_c": 27.3,
    "pack_current_a": 4.2,
    "charging_current_limit_a": 10.0,
    "is_charging_limit_exceeded": false,
    "green_count": 126,
    "yellow_count": 4,
    "red_count": 2
  },
  "cells": [
    {
      "position": "S1-P1",
      "series": 1,
      "parallel": 1,
      "voltage_v": 3.72,
      "temperature_c": 26.4,
      "dcir_mohm": 32.1,
      "soh_percent": 94.2,
      "health_status": "green"
    }
  ],
  "anomaly_flags": {
    "S2-P14": ["dcir_mohm"],
    "S4-P8": ["temperature_c"]
  }
}
```

---

## 🖥 Frontend Components

| Component | Directory | Purpose |
|-----------|-----------|---------|
| **Header** | `components/Header/` | Pack ID, connection status, navigation controls |
| **PackSummary** | `components/PackSummary/` | Aggregate statistics panel (voltage, current, temp, health distribution) |
| **PackGrid** | `components/PackGrid/` | 6×22 interactive cell matrix with color-coded health states |
| **CellTooltip** | `components/CellTooltip/` | Hover overlay — live voltage, temperature, DCIR, SOH |
| **CellDetail** | `components/CellDetail/` | Click-to-inspect modal — full cell diagnostics, history charts, passport data |
| **CellReplacementWizard** | `components/CellDetail/` | Guided cell swap workflow with candidate ranking |
| **AssemblyMap** | `components/AssemblyMap/` | Pack Assembly Map management — assign, bulk import, unassign |
| **CellGrades** | `components/CellGrades/` | Inventory grade distribution from Afterlife API |
| **Maintenance** | `components/Maintenance/` | Maintenance event history log |
| **BMS** | `components/BMS/` | BMS Frame Inspector — raw protocol frame forensics |
| **Alerts** | `components/Alerts/` | Alert drawer — active alerts, acknowledge, snooze, history |

---

## 🔌 Pack Electrical Specifications

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Configuration** | 6S22P | 6 series groups × 22 parallel cells per group |
| **Total Cell Count** | 132 | 6 × 22 |
| **Cell Chemistry** | Li-ion 18650 | Nominal 3.6 – 3.7 V per cell |
| **Nominal Pack Voltage** | ~22.2 V | 6 × 3.7 V |
| **Max Charge Voltage** | 25.2 V | 6 × 4.2 V |
| **Cutoff Voltage** | 15.0 V | 6 × 2.5 V |
| **Charging Current Limit** | 10 A | BMS-enforced standard limit |
| **Cell Form Factor** | 18650 (cylindrical) | 18 mm diameter × 65 mm length |
| **BMS Communication** | RS485-to-TTL | Raw telemetry input; no Modbus protocol |

---

## 🔄 Data Flow

### Real-Time Telemetry Pipeline

```
Physical BMS (RS485-to-TTL)
    │
    ▼
BMS telemetry bridge ──► Raw telemetry ingest (no Modbus decoding)
    │
    ▼
Health Engine ──► Per-cell health status (green/yellow/red)
    │
    ▼
Anomaly Detector ──► 2-sigma deviation flagging
    │
    ▼
Telemetry Store ──► In-memory latest snapshot
    │
    ├──► Socket.IO ──► Frontend (1 Hz push)
    └──► REST API  ──► Frontend (on-demand polling)
```

### Cell Passport Integration

```
Afterlife Intelligence API (Neon PostgreSQL)
    │
    ▼
Passport Client (httpx async proxy)
    │
    ├──► Cell Assignment Validation (POST /pack/{id}/map)
    ├──► Replacement Candidate Search (GET /pack/{id}/replacements/{pos})
    ├──► Grade Distribution (GET /passport/inventory/grades)
    └──► Cell Detail Lookup (GET /passport/{battery_code})
```

### Cell Replacement Workflow

```
1. Identify degraded cell (anomaly flag / red health status)
    │
    ▼
2. Open Replacement Wizard → 3-Tier Cascade BaaS Engine
    │  Tier 1: Same manufacturer + tight tolerances
    │  Tier 2: All manufacturers + standard tolerances
    │  Tier 3: All manufacturers + widened thresholds
    │
    ▼
3. Select candidate → Execute swap (POST /pack/{id}/replace-cell)
    │
    ├──► Update Pack Assembly Map (new battery_code)
    ├──► Log Maintenance Event (operator, reason, timestamp)
    ├──► Create Assembly Map Version Snapshot
    ├──► Update Passports: old cell → RETIRED_FROM_PACK
    ├──► Update Passports: new cell → DEPLOYED_IN_PACK
    └──► Clear simulator anomaly offset (if active)
```

---

## 📁 Project Structure

```
digital-twin/
├── 6S22P_Digital_Twin_PRD.md      # Process Requirements Document
├── README.md                       # ← You are here
├── .gitignore
│
├── backend/
│   ├── .env                        # Environment configuration
│   ├── requirements.txt            # Python dependencies
│   ├── run.py                      # Application entry point
│   ├── digital_twin.db             # SQLite database (auto-created)
│   │
│   └── app/
│       ├── main.py                 # FastAPI app + Socket.IO server + lifespan
│       ├── config.py               # Pack config + health thresholds (Pydantic)
│       ├── database.py             # SQLAlchemy async engine + session factory
│       ├── models.py               # ORM models (6 tables)
│       ├── schemas.py              # Pydantic request/response schemas
│       │
│       ├── routers/
│       │   ├── telemetry.py        # /telemetry/* endpoints
│       │   ├── pack.py             # /pack/* endpoints (assembly + maintenance)
│       │   ├── passport.py         # /passport/* endpoints (Afterlife proxy)
│       │   ├── alerts.py           # /alerts/* endpoints
│       │   └── bms.py              # /bms/* endpoints (hardware forensics)
│       │
│       ├── services/
│       │   ├── telemetry_store.py  # In-memory latest telemetry cache
│       │   ├── health.py           # Cell health status calculator
│       │   ├── anomaly.py          # 2-sigma statistical anomaly detector
│       │   ├── replacement_engine.py # 3-Tier Cascade BaaS replacement engine
│       │   ├── passport_client.py  # Async Afterlife API client (httpx)
│       │   ├── can_adapter.py      # CAN bus adapter
│       │   └── frame_logger.py     # Raw BMS frame buffer + statistics
│       │
│       └── simulator/
│           └── bms.py              # BMS Simulator (132-cell telemetry generator)
│
└── frontend/
    ├── index.html                  # HTML entry point
    ├── package.json                # Node dependencies + scripts
    ├── tsconfig.json               # TypeScript configuration
    │
    └── src/
        ├── main.jsx                # React DOM mount
        ├── App.jsx                 # Root component + Socket.IO + REST bootstrap
        ├── App.module.css
        ├── index.css               # Global styles + design tokens
        ├── style.css               # Component styles
        │
        ├── components/
        │   ├── Header/             # Pack identity + connection status
        │   ├── PackSummary/        # Aggregate statistics panel
        │   ├── PackGrid/           # 6×22 interactive cell grid
        │   ├── CellTooltip/        # Hover-to-inspect overlay
        │   ├── CellDetail/         # Click-to-detail modal + Replacement Wizard
        │   ├── AssemblyMap/        # Pack Assembly Map management
        │   ├── CellGrades/         # Inventory grade distribution
        │   ├── Maintenance/        # Maintenance history log
        │   ├── BMS/                # BMS Frame Inspector
        │   └── Alerts/             # Alert management drawer
        │
        ├── services/
        │   ├── api.js              # REST API client (fetch wrapper)
        │   └── socket.js           # Socket.IO client instance
        │
        └── stores/
            └── useTelemetryStore.js  # Zustand global state
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines to maintain code quality and consistency.

### Development Setup

1. **Fork** the repository and clone your fork
2. Follow the [Quick Start](#-quick-start) guide to set up both backend and frontend
3. Create a feature branch from `main`:

```bash
git checkout -b feature/your-feature-name
```

### Code Standards

#### Backend (Python)

- **Style**: Follow [PEP 8](https://peps.python.org/pep-0008/) conventions
- **Type hints**: Use Python type annotations for all function signatures
- **Models**: Define SQLAlchemy models in `models.py`, Pydantic schemas in `schemas.py`
- **Routing**: Add new endpoint groups as separate router modules in `routers/`
- **Services**: Business logic belongs in `services/` — keep routers thin
- **Async**: All database and HTTP operations must use `async`/`await`

#### Frontend (React/JSX)

- **Components**: One component per directory with co-located `.module.css`
- **State**: Use Zustand stores in `stores/` — avoid prop drilling
- **API calls**: Route through the `api.js` service — never call `fetch` directly
- **Real-time data**: Subscribe via the `socket.js` client through Zustand store updates

### Commit Messages

Use the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat: add cell temperature heatmap overlay
fix: correct DCIR threshold comparison in health engine
docs: update API endpoint table in README
refactor: extract BMS frame parser into dedicated service
```

### Pull Request Process

1. Ensure the backend starts without errors: `python run.py`
2. Ensure the frontend builds cleanly: `npm run build` (in `frontend/`)
3. Verify all existing API endpoints return expected responses
4. Update documentation if adding new endpoints, config, or components
5. Write a clear PR description referencing any relevant PRD requirements (e.g., `FR-10.1`)
6. Request review from at least one maintainer

### Adding New API Endpoints

1. Create or update the router in `backend/app/routers/`
2. Register the router in `backend/app/main.py`
3. Add corresponding Pydantic schemas in `schemas.py` if needed
4. Add the frontend API method in `frontend/src/services/api.js`
5. Document the endpoint in this README

---

## 🔧 Troubleshooting

### Backend Issues

#### `ModuleNotFoundError: No module named 'app'`

**Cause**: Running `run.py` from the wrong directory.

**Fix**: Always run from the `backend/` directory:

```bash
cd backend
python run.py
```

#### `sqlite3.OperationalError: database is locked`

**Cause**: Multiple processes writing to the SQLite database simultaneously.

**Fix**: Ensure only one instance of `run.py` is running. Kill other processes:

```bash
# Windows
taskkill /F /IM python.exe

# macOS / Linux
pkill -f "run.py"
```

#### `httpx.ConnectError` on passport/inventory endpoints

**Cause**: The Afterlife Intelligence platform API (`afterlife-int-production.up.railway.app`) is unreachable.

**Fix**:
1. Check internet connectivity
2. Verify the API URL in `.env`: `AFTERLIFE_API_BASE_URL`
3. The platform may be experiencing downtime — the digital twin will continue operating with cached data

#### Port 8000 already in use

**Fix**:

```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# macOS / Linux
lsof -i :8000
kill -9 <PID>
```

### Frontend Issues

#### `ENOENT: no such file or directory` during `npm install`

**Fix**: Ensure you are in the `frontend/` directory:

```bash
cd frontend
npm install
```

#### WebSocket connection fails (telemetry not updating)

**Cause**: Backend is not running or CORS is blocked.

**Fix**:
1. Verify the backend is running at `http://127.0.0.1:8000`
2. Check browser console for WebSocket errors
3. The Socket.IO client auto-reconnects with infinite retries — wait a few seconds

#### Cells show but no color changes

**Cause**: Telemetry data hasn't arrived yet.

**Fix**: The BMS Simulator starts automatically on backend boot. Allow 2–3 seconds for the first telemetry frame. Check the backend console for:

```
INFO:app.simulator.bms:BMS Simulator started
```

### Common Issues

#### Assembly Map is empty (no cells assigned)

**Expected behavior**: The assembly map starts empty. Cells must be assigned to positions either:
- Individually via the Assembly Map modal
- In bulk via the bulk import feature
- Programmatically via `POST /pack/{pack_id}/map` or `POST /pack/{pack_id}/map/bulk`

#### Replacement Wizard shows no candidates

**Cause**: All inventory cells are either already assigned to the pack or filtered out by tolerance thresholds.

**Fix**: The engine uses a 3-tier cascade — if Tier 1 yields no matches, it automatically widens to Tier 2 and then Tier 3. If still empty, the Afterlife inventory may not have enough eligible cells.

---

## 📄 License

This project is licensed under the **MIT License**.

```
MIT License

Copyright (c) 2026 Afterlife Intelligence

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---
#   F P U - D i g i t a l - T w i n  
 