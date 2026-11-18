# PROCESS REQUIREMENTS DOCUMENT

## 6S22P Battery Pack Digital Twin

### Real-Time Cell-Level Monitoring and Diagnostics

---

## Assumptions

The following assumptions are made based on platform exploration, BMS specification, and system description provided. Any inaccuracy should be flagged before development begins.

| # | Assumption | Implication |
|---|-----------|-------------|
| A-1 | **BMS Hardware Specified.** The BMS supports RS485 (Modbus RTU) and CAN communication protocols with a standard charging current limit of 10 A. The BMS is capable of per-cell voltage, temperature, and internal-resistance telemetry at 1 Hz or higher, accessible via either protocol. | BMS Adapter Service must support both RS485 and CAN translation. |
| A-2 | **Known API Bug.** The `GET /passport/{battery_code}` endpoint currently returns a 500 Internal Server Error. | The list endpoint `GET /passport/` with search filtering serves as the workaround. This bug must be resolved before Phase 2 (cell detail panel). |
| A-3 | **No Live BMS-to-Cloud Pipeline Exists.** Real-time telemetry ingestion from the physical BMS is a new capability to be built. | The Telemetry Ingestion Service and BMS Adapter are greenfield components. |
| A-4 | **Cell Position Mapping is Manual.** No existing system maps a cell's battery code to its physical position within a pack assembly. | A Pack Assembly Map and an assembly workflow must be created (see Section 2.2, FR-7). |
| A-5 | **408 Cells Currently Registered.** The platform holds 408 registered cells (all Li-ion 18650, predominantly in INTAKE state). The 132 cells for this pack will be selected and assigned from this pool. | Cell selection criteria and grade-matching logic are required. |
| A-6 | **Single Pack Build.** This PRD targets the completion of one (1) unit of a 6S22P battery pack. Multi-pack configurations are addressed in the scaling addendum (Section 7). | All architecture decisions account for multi-pack extensibility but only activate single-pack features. |
| A-7 | **Autonomous Data Ingestion.** Cell registration and test data upload are performed autonomously by Google Apps Scripts scraping tested cell data from Google Drive and ingesting into the Neon database. The frontend "Register Cell" and "Test Upload" tools are operationally redundant. | The digital twin consumes passport data from Neon; it does not produce cell registration data. |
| A-8 | **Neon Database.** The platform backend uses Neon (serverless PostgreSQL) as its primary database. All telemetry persistence and pack management data will leverage this existing infrastructure. | No separate time-series database is required for the initial build. |

---

## 1. Introduction

### 1.1 Background

Afterlife Intelligence is a battery-cell lifecycle management platform that tests, grades, and issues digital passports for individual cells. Each cell receives a unique code (e.g., `AFI-LIIO-18650-JN39Q`) and is tracked through its lifecycle: intake, testing, grading, deployment, and eventual retirement.

The platform currently provides:

- **Cell Inventory:** A searchable registry of all cells with per-cell data including battery code, legacy ID, chemistry, form factor, DCIR, OCV, SOH, state, grade, and intake date.
- **Autonomous Data Ingestion:** Google Apps Scripts scrape tested cell data from Google Drive and ingest it into the Neon database, eliminating manual cell registration or test upload workflows. The data flows: physical testing > Google Drive (CSV/data files) > Google Apps Scripts (scraping and transformation) > Neon database.

### 1.2 The Gap

The platform today manages cells at rest. It knows what each cell measured on the bench, but it has no visibility into how cells behave after deployment inside a working battery pack. Once 132 cells are assembled into a 6S22P configuration and begin cycling under load, the platform goes dark.

### 1.3 The Vision

Build a unified digital twin of the 6S22P battery pack: a real-time, interactive, spatially accurate render that mirrors the physical pack cell by cell. Rather than a two-phase approach (prototype then pilot), this PRD defines a single, comprehensive system designed for production from day one, with features integrated in a meticulous piecemeal procedure, each capability layered on incrementally within a cohesive architecture.

The twin is fed continuously by BMS telemetry via RS485 or CAN, translating raw data into an explorable, color-coded visualization that supports:

- **Instant pack health assessment:** Traffic-light color coding (green / yellow / red) makes degradation visible at a glance.
- **Cell-level diagnostics:** Hover-to-inspect any of 132 cells for live voltage, temperature, DCIR, and SOH.
- **Historical analytics:** Time-series charts, anomaly detection, and trend analysis per cell and per pack.
- **Targeted maintenance:** Identify the failing cell by position, cross-reference its passport in the Afterlife Intelligence inventory, and swap it with a grade-matched replacement.
- **Historical traceability:** Every cell's field performance flows back into its passport, enriching the platform's lifecycle intelligence.
- **BMS protocol integration:** Direct RS485/CAN communication with the physical BMS hardware, with simulator fallback for development.

### 1.4 Unified System Philosophy

**One system. Piecemeal delivery.**

The previous two-phase approach (Rapid Prototype then Full Pilot) has been replaced by a single, production-grade architecture. Features are delivered incrementally, but every component is built to production standards from the outset. The integration sequence is detailed in Section 3 (Piecemeal Integration Roadmap).

### 1.5 Existing Platform Data Model (from API)

The Afterlife Intelligence backend (`https://afterlife-int-production.up.railway.app`) exposes the following data per cell:

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `battery_code` | string | `AFI-LIIO-18650-JN39Q` | Globally unique cell identifier |
| `legacy_cell_id` | string or null | `"320"` | Legacy spreadsheet reference |
| `chemistry` | string | `"Li-ion"` | Cell chemistry |
| `form_factor` | string | `"18650"` | Physical form factor |
| `nominal_capacity_ah` | float or null | `2.5` | Rated capacity |
| `source` | string | `"Live Sheet webhook (LGA-Brown)"` | Intake source / pipeline origin |
| `intake_date` | date | `"2026-07-30"` | Date of registration |
| `current_state` | string | `"intake"` | Lifecycle state |
| `current_grade` | string or null | `null` | Quality grade (post-testing) |
| `needs_review` | boolean | `true` | Flagged for review |
| `dcir_mohm` | float or null | `108.47` | DC Internal Resistance (milliohms) |
| `intake_ocv_v` | float or null | `3.933` | Open-Circuit Voltage at intake (V) |
| `soh_percent` | float or null | `null` | State of Health (%) |

### 1.6 API Endpoints (Current State)

| Method | Endpoint | Status | Purpose |
|--------|----------|--------|---------|
| `GET` | `/passport/` | Working | List all cell passports (paginated, searchable by battery code, legacy ID, chemistry, or source) |
| `GET` | `/passport/{battery_code}` | 500 Error | Get single cell passport (bug, see A-2) |
| `DELETE` | `/passport/{battery_code}` | Working | Delete cell passport |
| `POST` | `/passport/{battery_code}/state` | Working | Change cell lifecycle state |
| `GET` | `/passport/{battery_code}/tests` | Working | Get test history for a cell |
| `POST` | `/ingest/webhook` | Working | Google Sheets webhook ingestion |

**Pagination parameters** for `GET /passport/`:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | 1 | Page number |
| `page_size` | integer | 10 | Results per page (max configurable) |
| `search` | string | (none) | Free-text search across battery code, legacy cell ID, chemistry, and source |

**Example:** `GET /passport/?search=318&page_size=5` returns the cell whose `legacy_cell_id` is `"318"`, resolving the legacy reference to its canonical `battery_code`.

### 1.7 Cell Matrix Integration Strategy

The digital twin must bridge two domains: the physical 6S22P cell matrix (132 slots arranged in 6 series groups of 22 parallel cells) and the digital passport registry (408 cells in the Afterlife Intelligence inventory). The bridge is the **Pack Assembly Map**, a data structure that links each physical position (e.g., S3-P17) to a specific `battery_code`.

**No manual passport data entry is required.** The backend API provides programmatic access to all battery passports. The only manual step is the deliberate assignment of which cell occupies which slot, which is intentional: it enforces traceability and accountability during pack assembly.

Three approaches support this assignment:

#### 1.7.1 Scan-to-Assign (Recommended for Production Assembly)

1. Pre-print QR codes or barcodes encoding each cell's `battery_code` during intake (the platform already generates unique codes like `AFI-LIIO-18650-XXXXX`).
2. During pack assembly, scan each cell as it is placed into a specific matrix position.
3. The scanning app validates the code against the API (`GET /passport/?search={code}`) and pulls the passport data.
4. The scan event writes the `[position, battery_code]` pair to the Pack Assembly Map in Neon.

#### 1.7.2 Bulk Fetch with Manual Mapping

1. Fetch all candidate passports: `GET /passport/?page=1&page_size=132`.
2. Create a mapping file (JSON or CSV) associating each matrix slot `[series, parallel]` with a `battery_code`.
3. Upload or import the mapping into the Pack Assembly Map via an API endpoint.

**Example mapping structure:**
```json
{
  "pack_id": "PACK-6S22P-001",
  "cells": [
    { "series": 1, "parallel": 1, "battery_code": "AFI-LIIO-18650-LQ94T" },
    { "series": 1, "parallel": 2, "battery_code": "AFI-LIIO-18650-HD8KW" }
  ]
}
```

#### 1.7.3 Legacy ID Lookup

For teams working from legacy spreadsheet IDs (e.g., cell `318`), the search endpoint resolves them to canonical battery codes:

```
GET /passport/?search=318
```

This returns the full passport for that cell, including the `battery_code` the digital twin uses going forward.

#### 1.7.4 Integration Data Flow

```
Physical Cell (barcode/QR) 
    --> Scan or Manual Entry
        --> API Validation (GET /passport/?search={code})
            --> Pack Assembly Map (Neon)
                --> Digital Twin Render (position + passport linked)
```

Once the Pack Assembly Map is populated, the digital twin fetches passport data for each cell on demand, and all subsequent BMS telemetry is correlated by position automatically.

### 1.8 Data Ingestion Architecture (Current State)

```
Physical Testing (UBA5 / bench equipment)
    --> Google Drive (CSV / data files)
        --> Google Apps Scripts (scraping + transformation)
            --> Neon Database (serverless PostgreSQL)
                --> Afterlife Intelligence API (FastAPI)
                    --> Frontend / Digital Twin (consumer)
```

### 1.9 Current Platform Interface

The existing Afterlife Intelligence frontend (v1.0) uses a dark-themed UI built with React (Vite), using the Sora and JetBrains Mono font families. The inventory page displays a tabular list of all registered cells with columns for battery code, legacy ID, type, DCIR, OCV, SOH, state, grade, and intake date. The interface supports search by battery code, legacy ID, chemistry, or source, with pagination across 41 pages.

### 1.10 6S22P Pack Electrical Characteristics

| Parameter | Value | Notes |
|-----------|-------|-------|
| Configuration | 6S22P | 6 series groups x 22 parallel cells per group |
| Total Cell Count | 132 | 6 x 22 |
| Cell Chemistry | Li-ion 18650 | Nominal 3.6 to 3.7 V per cell |
| Nominal Pack Voltage | ~22.2 V | 6 x 3.7 V |
| Max Charge Voltage | 25.2 V | 6 x 4.2 V |
| Cutoff Voltage | 15.0 V | 6 x 2.5 V |
| Charging Current Limit | 10 A | BMS-enforced standard limit |
| BMS Communication | RS485 (Modbus RTU), CAN | Dual-protocol support |
| Cell Form Factor | 18650 (cylindrical) | 18 mm diameter x 65 mm length |

---

## 2. Unified System Requirements

**Goal:** Deliver a single, production-grade digital twin of the 6S22P battery pack encompassing real-time 3D visualization, physical BMS integration (RS485/CAN), cell matrix integration with the passport registry, historical analytics, maintenance workflows, and alerting. The system is built as one cohesive architecture with features integrated in a meticulous piecemeal sequence.

### 2.1 Objectives

| # | Objective | Success Metric |
|---|-----------|----------------|
| O-01 | Render 132 cells in a spatially accurate 6S22P layout with full 3D interaction | All 132 cell positions visible, addressable, orbitable at 30 FPS or higher |
| O-02 | Ingest per-cell telemetry from physical BMS via RS485 or CAN and update the render in real time | Cell colors update within 1 second of data arrival from BMS |
| O-03 | Provide hover-to-inspect and click-to-detail interaction for individual cells | Tooltip shows live vitals; detail panel shows passport, history, maintenance |
| O-04 | Apply multi-mode color coding based on cell health | Health (traffic-light), Voltage (gradient), Temperature (heatmap), DCIR, SOH modes |
| O-05 | Link each rendered cell to its Afterlife Intelligence passport via the Pack Assembly Map | Cell detail panel displays full passport data from Neon database |
| O-06 | Persist all telemetry data for historical analysis | Time-series charts available for any cell over configurable windows |
| O-07 | Provide maintenance workflow for cell replacement with passport lifecycle updates | End-to-end wizard: identify, find replacement, swap, update map and passports |
| O-08 | Generate alerts on cell degradation and BMS threshold violations | Configurable rules trigger in-app, email, and webhook notifications |
| O-09 | Support BMS simulator for development and demonstration | System runs fully functional without physical BMS hardware |
| O-10 | Integrate with the autonomous data pipeline and passport registry | System reads cell passport data from Neon via the API; respects the existing ingestion flow |
| O-11 | Support deliberate cell-to-position mapping during pack assembly | Scan-to-assign, bulk import, and legacy ID lookup workflows available |

### 2.2 Functional Requirements

#### FR-1: Pack Layout Render

| ID | Requirement | Priority | Phase |
|----|------------|----------|-------|
| FR-1.1 | Render a 6 (series) x 22 (parallel) grid representing all 132 cell positions | Must Have | 1 |
| FR-1.2 | Each cell occupies a distinct, clickable/hoverable element in the grid | Must Have | 1 |
| FR-1.3 | Grid orientation and axis labels clearly indicate Series (S1-S6) and Parallel (P1-P22) positions | Must Have | 1 |
| FR-1.4 | Full 3D interactive model with physically accurate cylindrical 18650 cell placement | Must Have | 2 |
| FR-1.5 | Camera controls: orbit, zoom, pan with smooth inertia | Must Have | 2 |
| FR-1.6 | Toggle between 3D render and 2D flat grid view | Should Have | 2 |
| FR-1.7 | Cell selection: click to select, with 3D highlight/glow effect on the selected cell | Must Have | 2 |
| FR-1.8 | Optional cross-section view to reveal inner cells obscured by the pack enclosure | Should Have | 3 |
| FR-1.9 | Render pack enclosure, busbars, and BMS board for spatial context | Nice to Have | 4 |
| FR-1.10 | Responsive layout across desktop and tablet viewports | Should Have | 3 |

#### FR-2: Data Ingestion and BMS Integration

| ID | Requirement | Priority | Phase |
|----|------------|----------|-------|
| FR-2.1 | Accept a JSON payload containing per-cell telemetry data (voltage, temperature, DCIR, SOH) keyed by cell position or battery code | Must Have | 1 |
| FR-2.2 | Support ingestion via WebSocket (Socket.IO) for real-time streaming with automatic reconnection | Must Have | 1 |
| FR-2.3 | BMS Adapter Service: Translate RS485 (Modbus RTU) protocol into the standardized JSON telemetry format | Must Have | 2 |
| FR-2.4 | BMS Adapter Service: Translate CAN-bus protocol into the standardized JSON telemetry format | Must Have | 2 |
| FR-2.5 | Validate charging current against the 10 A BMS limit; flag exceedances as anomalies | Must Have | 2 |
| FR-2.6 | Automatic BMS discovery and connection health monitoring | Should Have | 3 |
| FR-2.7 | Graceful fallback to simulator mode when hardware is disconnected | Must Have | 2 |
| FR-2.8 | Raw data logging of all BMS frames (RS485/CAN) for forensic analysis | Should Have | 3 |
| FR-2.9 | Fallback REST polling endpoint (`GET /pack/{pack_id}/telemetry`) for environments where WebSocket is impractical | Should Have | 1 |

#### FR-3: BMS Data Simulator

| ID | Requirement | Priority | Phase |
|----|------------|----------|-------|
| FR-3.1 | Standalone service that generates realistic 6S22P telemetry at configurable intervals (default: 1 Hz) | Must Have | 1 |
| FR-3.2 | Simulate normal charge/discharge curve behavior across all 132 cells, respecting the 10 A charging current limit | Must Have | 1 |
| FR-3.3 | Model realistic voltage ranges (2.5 V to 4.2 V for Li-ion 18650), temperature (20 to 60 degrees C), and DCIR drift over time | Must Have | 1 |
| FR-3.4 | Inject configurable anomalies: 2 to 5 cells with elevated DCIR, 1 to 2 cells with voltage drift, 1 cell with temperature excursion | Must Have | 1 |
| FR-3.5 | Output via Socket.IO (same interface the real BMS adapter uses) | Must Have | 1 |
| FR-3.6 | Simulate RS485/CAN frame-level behavior for adapter testing | Should Have | 2 |

#### FR-4: Cell Health Color Coding

| ID | Requirement | Priority | Phase |
|----|------------|----------|-------|
| FR-4.1 | Each cell element is color-coded based on its health status using a traffic-light scheme | Must Have | 1 |
| FR-4.2 | Green: Cell operating within nominal parameters (voltage 3.0 to 4.2 V, DCIR below 50 milliohms, SOH above 80%, temperature below 45 degrees C) | Must Have | 1 |
| FR-4.3 | Yellow (Warning): Cell showing early degradation (voltage drift greater than 50 mV from string mean, DCIR 50 to 75 milliohms, SOH 60 to 80%, temperature 45 to 55 degrees C) | Must Have | 1 |
| FR-4.4 | Red (Critical): Cell in poor condition (voltage below 2.8 V or above 4.25 V, DCIR 75 to 100 milliohms, SOH below 60%, temperature above 55 degrees C) | Must Have | 1 |
| FR-4.5 | Color thresholds configurable via a JSON configuration object served from the backend, not hard-coded | Must Have | 1 |
| FR-4.6 | A cell with any single metric in red range displays red; yellow takes precedence over green similarly | Must Have | 1 |
| FR-4.7 | Multiple render modes: Health (traffic-light), Voltage (gradient), Temperature (heatmap), DCIR (gradient), SOH (gradient) | Must Have | 2 |

#### FR-5: Interactive Cell Inspection

| ID | Requirement | Priority | Phase |
|----|------------|----------|-------|
| FR-5.1 | Hovering over a cell displays a tooltip/popover showing the cell's current vital statistics | Must Have | 1 |
| FR-5.2 | Tooltip must display: Battery Code, Position (e.g., S3-P17), Voltage (V), Temperature (degrees C), DCIR (milliohms), SOH (%) | Must Have | 1 |
| FR-5.3 | Tooltip must display the cell's current health status (Green/Yellow/Red) with the triggering metric highlighted | Should Have | 1 |
| FR-5.4 | Clicking a cell opens a detail side panel with: full passport data, mini time-series charts, maintenance history | Must Have | 2 |
| FR-5.5 | Detail panel fetches passport data from the Afterlife Intelligence API (backed by Neon) using the Pack Assembly Map to resolve position to battery code | Must Have | 2 |

#### FR-6: Pack-Level Summary

| ID | Requirement | Priority | Phase |
|----|------------|----------|-------|
| FR-6.1 | Display aggregate pack-level statistics: total voltage, average cell voltage, min/max cell voltage, average temperature, count of green/yellow/red cells | Must Have | 1 |
| FR-6.2 | Display a status badge summary: "Green 120 | Yellow 9 | Red 3" for instant pack health assessment | Must Have | 1 |
| FR-6.3 | Display pack-level charging current and validate against the 10 A limit | Must Have | 1 |
| FR-6.4 | Show pack nominal voltage (approximately 22.2 V), current total voltage, and voltage delta | Must Have | 1 |

#### FR-7: Cell-to-Passport Mapping and Assembly Integration

This requirement group governs how the digital twin links each physical cell position in the 6S22P matrix to its battery passport in the Afterlife Intelligence inventory. The mapping is the critical bridge between the physical and digital domains.

| ID | Requirement | Priority | Phase |
|----|------------|----------|-------|
| FR-7.1 | Maintain a Pack Assembly Map: a data structure mapping each grid position (S1-P1 through S6-P22) to a specific `battery_code` from the inventory | Must Have | 1 |
| FR-7.2 | Store the Pack Assembly Map in Neon with CRUD API endpoints (`POST /pack/{pack_id}/map`, `GET /pack/{pack_id}/map`, `PUT /pack/{pack_id}/map/{position}`, `DELETE /pack/{pack_id}/map/{position}`) | Must Have | 1 |
| FR-7.3 | **Scan-to-Assign workflow:** Accept a scanned barcode/QR code containing a `battery_code`, validate it against the inventory API (`GET /passport/?search={code}`), and write the position assignment to the Pack Assembly Map | Must Have | 1 |
| FR-7.4 | **Bulk Import workflow:** Accept a JSON or CSV file mapping positions to battery codes, validate all codes against the inventory, and populate the Pack Assembly Map in a single transaction | Must Have | 1 |
| FR-7.5 | **Legacy ID Lookup:** Resolve legacy cell IDs to canonical battery codes using the search endpoint (`GET /passport/?search={legacy_id}`) during assembly mapping | Should Have | 1 |
| FR-7.6 | Display an Assembly Progress view showing how many of 132 slots are populated, with visual indicators for unmapped positions | Must Have | 1 |
| FR-7.7 | When a cell is replaced, update the map via the maintenance workflow (FR-10) | Must Have | 3 |
| FR-7.8 | Assembly map versioning: each update creates a history entry for traceability | Should Have | 3 |
| FR-7.9 | Validate that no `battery_code` is assigned to more than one position across all active packs | Must Have | 1 |

#### FR-8: Historical Data and Analytics

| ID | Requirement | Priority | Phase |
|----|------------|----------|-------|
| FR-8.1 | Persist all telemetry data in Neon using time-based table partitioning (`PARTITION BY RANGE` on timestamp) | Must Have | 2 |
| FR-8.2 | Per-cell time-series charts: voltage, temperature, DCIR, SOH over configurable time windows (1h, 24h, 7d, 30d, all) | Must Have | 2 |
| FR-8.3 | Pack-level trend charts: total voltage, average temperature, cell balance spread, charging current over time | Must Have | 2 |
| FR-8.4 | Anomaly detection: automatically flag cells whose metrics deviate from the string mean by more than 2 standard deviations | Should Have | 3 |
| FR-8.5 | Predictive degradation curves: extrapolate SOH trends to estimate remaining useful life (RUL) per cell | Nice to Have | 4 |
| FR-8.6 | Data export to CSV / JSON for offline analysis | Should Have | 3 |
| FR-8.7 | Playback mode: scrub through historical telemetry and see the pack render update as if in real time | Nice to Have | 4 |

#### FR-9: Alerting and Notifications

| ID | Requirement | Priority | Phase |
|----|------------|----------|-------|
| FR-9.1 | Configurable alert rules: per-metric thresholds with severity levels (warning, critical) | Must Have | 2 |
| FR-9.2 | Charging current alert: trigger critical alert if pack current exceeds the 10 A BMS limit | Must Have | 2 |
| FR-9.3 | Alert channels: in-app notification, email, webhook (Slack/Teams integration) | Must Have | 3 |
| FR-9.4 | Alert acknowledgment and snooze functionality | Should Have | 3 |
| FR-9.5 | Alert history log with timestamps and resolution status | Should Have | 3 |
| FR-9.6 | Escalation rules: if a critical alert is unacknowledged for N minutes, escalate to next contact | Nice to Have | 4 |

#### FR-10: Maintenance Workflow

| ID | Requirement | Priority | Phase |
|----|------------|----------|-------|
| FR-10.1 | Cell Replacement Wizard: from the render, select a red/yellow cell; system queries the inventory API for grade-matched replacement candidates; operator confirms swap; system updates the Pack Assembly Map and both cell passports | Must Have | 3 |
| FR-10.2 | Replacement candidate ranking by: matching grade, closest DCIR, closest capacity, closest SOH | Must Have | 3 |
| FR-10.3 | Replacement event logging: timestamp, old cell code, new cell code, position, operator, reason | Must Have | 3 |
| FR-10.4 | Old cell's passport updated with a `RETIRED_FROM_PACK` state change via `POST /passport/{battery_code}/state` | Must Have | 3 |
| FR-10.5 | New cell's passport updated with a `DEPLOYED_IN_PACK` state change via `POST /passport/{battery_code}/state` | Must Have | 3 |
| FR-10.6 | Maintenance history view per pack and per cell | Should Have | 3 |

#### FR-11: Enhanced Visualization

| ID | Requirement | Priority | Phase |
|----|------------|----------|-------|
| FR-11.1 | Animated heat map overlay showing temperature distribution across the pack | Should Have | 2 |
| FR-11.2 | Pack schematic overlay: show series/parallel wiring connections between cells | Should Have | 3 |
| FR-11.3 | Dark/light theme toggle (default: dark, consistent with Afterlife Intelligence design system) | Should Have | 2 |
| FR-11.4 | Responsive design for tablet use (field technicians) | Should Have | 3 |
| FR-11.5 | BMS connection status indicator (RS485/CAN link health, signal quality) | Must Have | 2 |

### 2.3 Non-Functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-01 | Latency: End-to-end from BMS data emission to visual update | 1 second or less |
| NFR-02 | Browser Support: Chrome, Firefox, Safari, Edge (latest 2 versions) | Cross-browser |
| NFR-03 | Concurrent Users: Support up to 10 simultaneous users | 10 |
| NFR-04 | Uptime: Service availability | 99.5% |
| NFR-05 | Data Retention: Telemetry data stored for at least 12 months | 12 months |
| NFR-06 | Data Backup: Neon database automated backups with point-in-time recovery | Continuous |
| NFR-07 | 3D Performance: Render 132 cells at 30 FPS or higher on mid-range hardware | 30+ FPS |
| NFR-08 | API Response Time: 95th percentile response time for REST endpoints | 200 ms or less |
| NFR-09 | Security: All data in transit encrypted via TLS 1.3 | Industry standard |
| NFR-10 | Accessibility: WCAG 2.1 AA compliance for non-3D UI elements | AA |
| NFR-11 | BMS Sampling Rate: Support telemetry ingestion at 1 Hz or higher per cell | 132+ data points/second |
| NFR-12 | RS485 Baud Rate: Support standard Modbus RTU baud rates (9600 to 115200 bps) | Configurable |
| NFR-13 | CAN Bus Speed: Support standard CAN speeds (125 kbps, 250 kbps, 500 kbps) | Configurable |

### 2.4 Constraints

- **Single Pack:** This build targets one (1) unit of a 6S22P battery pack (132 cells). Multi-pack architecture is designed in but not activated (see Section 7).
- **BMS Protocol Scope:** The BMS supports RS485 (Modbus RTU) and CAN. No other protocols (UART, SPI, I2C) are required.
- **Charging Current:** The BMS enforces a 10 A standard charging current limit. The system monitors and validates this limit, generating alerts on exceedance.
- **No Mobile Support (Phases 1 and 2):** Desktop and tablet browsers only. Mobile-specific layouts are deferred.
- **Neon Database:** All persistent data (passport registry, telemetry history, pack assembly maps, maintenance logs, alert rules) is stored in Neon. Time-based partitioning uses PostgreSQL native capabilities.
- **Autonomous Ingestion Boundary:** The digital twin does not write to or interfere with the Google Apps Scripts ingestion pipeline. It is a consumer of passport data, not a producer of cell registration data.

---

## 3. Piecemeal Integration Roadmap

The unified system is built within a single architecture from the outset, but features are integrated in phases. Each phase delivers a working, deployable increment. No phase produces throwaway code; every component is production-grade.

### Phase 1: Foundation (Weeks 1 to 3)

Core render + simulated data + pack summary + assembly mapping

| Deliverable | Requirements Addressed |
|------------|----------------------|
| 2D SVG grid render (6x22) with cell color coding | FR-1.1, FR-1.2, FR-1.3 |
| BMS data simulator (6S22P, 1 Hz, anomaly injection) | FR-3.1 to FR-3.5 |
| Socket.IO WebSocket transport with server | FR-2.1, FR-2.2 |
| Traffic-light health color coding with configurable thresholds | FR-4.1 to FR-4.6 |
| Hover tooltips with live cell vitals | FR-5.1 to FR-5.3 |
| Pack-level summary panel (voltage, temperature, status counts) | FR-6.1 to FR-6.4 |
| Pack Assembly Map with CRUD API (Neon-backed) | FR-7.1, FR-7.2, FR-7.9 |
| Scan-to-Assign and Bulk Import workflows | FR-7.3, FR-7.4, FR-7.6 |
| Legacy ID lookup integration | FR-7.5 |
| REST polling fallback endpoint | FR-2.9 |

### Phase 2: Depth (Weeks 4 to 6)

3D render + physical BMS + historical data + alerting

| Deliverable | Requirements Addressed |
|------------|----------------------|
| Full 3D interactive render (Three.js / React Three Fiber) | FR-1.4 to FR-1.7 |
| BMS Adapter: RS485 (Modbus RTU) protocol translation | FR-2.3 |
| BMS Adapter: CAN-bus protocol translation | FR-2.4 |
| Charging current validation (10 A limit) | FR-2.5, FR-6.3 |
| Simulator fallback when BMS disconnected | FR-2.7 |
| RS485/CAN frame-level simulation for adapter testing | FR-3.6 |
| Multiple render modes (voltage gradient, heatmap, DCIR, SOH) | FR-4.7 |
| Cell detail side panel with passport data via API | FR-5.4, FR-5.5 |
| Telemetry persistence in Neon (time-partitioned) | FR-8.1 |
| Per-cell and pack-level time-series charts | FR-8.2, FR-8.3 |
| Alert engine with configurable rules | FR-9.1, FR-9.2 |
| Temperature heat map overlay | FR-11.1 |
| Dark/light theme toggle | FR-11.3 |
| BMS connection status indicator | FR-11.5 |

### Phase 3: Operations (Weeks 7 to 9)

Maintenance workflow + notifications + polish

| Deliverable | Requirements Addressed |
|------------|----------------------|
| Cross-section view for inner cells | FR-1.8 |
| Responsive tablet layout | FR-1.10, FR-11.4 |
| BMS auto-discovery and connection health monitoring | FR-2.6 |
| Raw BMS frame logging (RS485/CAN forensics) | FR-2.8 |
| Cell Replacement Wizard with passport state updates | FR-10.1 to FR-10.5 |
| Maintenance history view | FR-10.6 |
| Pack Assembly Map versioning | FR-7.7, FR-7.8 |
| Anomaly detection (2-sigma deviation) | FR-8.4 |
| Data export (CSV/JSON) | FR-8.6 |
| Alert notification channels (email, webhook) | FR-9.3 |
| Alert acknowledgment and snooze | FR-9.4 |
| Alert history log | FR-9.5 |
| Pack schematic overlay (wiring diagram) | FR-11.2 |

### Phase 4: Intelligence (Weeks 10 to 12)

Predictive analytics + advanced visualization + future-proofing

| Deliverable | Requirements Addressed |
|------------|----------------------|
| Pack enclosure, busbar, BMS board rendering | FR-1.9 |
| Predictive degradation curves (RUL estimation) | FR-8.5 |
| Playback mode (historical scrubbing) | FR-8.7 |
| Alert escalation rules | FR-9.6 |
| Multi-pack architecture activation (see Section 7) | Scaling preparation |

---

## 4. System Architecture

### 4.1 Unified Architecture Overview

```
+---------------------+       +-------------------------+       +--------------------+
|   Physical Layer    |       |     Edge / Server       |       |   Cloud (Railway)  |
|                     |       |                         |       |                    |
| 6S22P Battery Pack  |       |  BMS Adapter Service    |       |  FastAPI Backend   |
| (132 cells + BMS)   |------>|  (RS485/CAN to JSON)    |------>|  (Telemetry +      |
|                     | RS485 |                         | JSON  |   Pack Mgmt API)   |
|        or           | / CAN |  BMS Simulator          |  via  |                    |
|                     |       |  (dev fallback)         | HTTP/ |  Neon Database     |
|                     |       |                         | WS    |  (PostgreSQL)      |
+---------------------+       +-------------------------+       |                    |
                                                                |  Redis Cache       |
                                                                |                    |
                                                                |  Alert Engine      |
                                                                +--------+-----------+
                                                                         |
                                                                  Socket.IO / REST
                                                                         |
                                                                +--------v-----------+
                                                                |   Frontend         |
                                                                |                    |
                                                                |  React (Vite)      |
                                                                |  2D SVG Grid       |
                                                                |  3D Three.js       |
                                                                |  ECharts           |
                                                                |  Zustand State     |
                                                                +--------------------+
```

### 4.2 Cell Matrix Integration Architecture

```
+---------------------------+
| Afterlife Intelligence    |
| Inventory (408 cells)     |
|                           |
| GET /passport/            |
| ?search={code_or_legacy}  |
+------------+--------------+
             |
             | passport data
             v
+---------------------------+       +---------------------------+
| Pack Assembly Map         |       | Digital Twin Frontend     |
| (Neon table)              |       |                           |
|                           |<----->| Cell Grid (2D/3D)        |
| position | battery_code   |       | Hover: live vitals        |
| S1-P1    | AFI-...-JN39Q  |       | Click: passport + history |
| S1-P2    | AFI-...-KM42R  |       | Color: health status      |
| ...      | ...            |       |                           |
+---------------------------+       +---------------------------+
             ^
             |
   +--------------------+
   | Assembly Workflow   |
   |                     |
   | - QR/barcode scan   |
   | - Bulk CSV import   |
   | - Legacy ID lookup  |
   +--------------------+
```

### 4.3 BMS Communication Detail

```
+-------------------+     RS485 (Modbus RTU)     +-------------------+
|                   |  Baud: 9600-115200 bps     |                   |
|   BMS Hardware    |---------------------------->|  BMS Adapter      |
|   (on pack)       |                            |  Service          |
|                   |     CAN Bus                |                   |
|                   |  Speed: 125-500 kbps       |  Reads registers  |
|                   |---------------------------->|  or CAN frames,   |
|                   |                            |  normalizes to    |
+-------------------+                            |  JSON telemetry   |
                                                 +--------+----------+
                                                          |
                                                    Socket.IO / HTTP
                                                          |
                                                          v
                                                 +-------------------+
                                                 | Telemetry         |
                                                 | Ingestion Service |
                                                 | (FastAPI)         |
                                                 +-------------------+
```

### 4.4 Data Flow

1. **BMS Hardware** samples all 132 cells at 1 Hz or higher, reporting per-cell voltage, temperature, and DCIR, plus pack-level current, via RS485 (Modbus RTU) and/or CAN.

2. **BMS Adapter Service** (running on edge hardware or server) reads RS485/CAN frames and translates them into the standardized JSON telemetry format:

```json
{
  "pack_id": "PACK-6S22P-001",
  "timestamp": "2026-08-05T12:30:00Z",
  "pack_current_a": 8.7,
  "pack_voltage_v": 21.85,
  "bms_protocol": "RS485",
  "cells": [
    {
      "position": "S1-P1",
      "battery_code": "AFI-LIIO-18650-JN39Q",
      "voltage_v": 3.72,
      "temperature_c": 32.1,
      "dcir_mohm": 68.5,
      "soh_percent": 92.3
    },
    {
      "position": "S1-P2",
      "battery_code": "AFI-LIIO-18650-KM42R",
      "voltage_v": 3.71,
      "temperature_c": 31.8,
      "dcir_mohm": 72.1,
      "soh_percent": 90.1
    }
  ]
}
```

3. **Telemetry Ingestion Service** receives the normalized JSON, validates the charging current against the 10 A limit, persists the data to Neon, broadcasts to all connected frontend clients via Socket.IO, and evaluates alert rules.

4. **Frontend** receives the Socket.IO payload, updates the 2D/3D grid color-coding, recalculates pack-level summaries, and refreshes tooltip data.

5. **On cell click**, the frontend displays the detail panel with passport data fetched from the Afterlife Intelligence API (backed by Neon). The Pack Assembly Map resolves the clicked position (e.g., S3-P17) to its `battery_code`, which is then used to query the passport endpoint and retrieve the full cell identity, history, and test results.

6. **Alert Engine** evaluates configurable rules against each telemetry snapshot. Violations trigger in-app notifications and, when configured, email/webhook dispatch.

---

## 5. Technology Stack

### 5.1 Unified Stack

| Layer | Technology | Version | Justification |
|-------|-----------|---------|---------------|
| Frontend Framework | React (via Vite) | React 18+ / Vite 5+ | Matches the existing Afterlife Intelligence frontend stack. Enables future integration as a new route/module within the main platform. |
| 2D Rendering | SVG + React | n/a | Phase 1 grid render. DOM-based, zero-dependency, trivial hover/click interactions for 132 elements. |
| 3D Rendering | Three.js via React Three Fiber | R3F 8+ | Phase 2 upgrade. Industry-standard web 3D, GPU-accelerated, declarative React binding. @react-three/drei for camera controls and interaction helpers. |
| 3D Model Authoring | Blender, exported as glTF | Blender 4+ | Free, open-source. 18650 cell model and pack enclosure exported as .glb for Three.js consumption. |
| Real-Time Transport | Socket.IO | 4.x | Automatic reconnection, event namespacing, binary transport. Production-ready from Phase 1. |
| Backend API | FastAPI (Python) | 0.110+ | Continuity with existing Afterlife Intelligence backend. Excellent async support. New routers for pack management, telemetry ingestion, and alert configuration. |
| Database | Neon (Serverless PostgreSQL) | PostgreSQL 16+ | Already the platform database. Serverless scaling, automated backups, branching for dev/staging. Time-based table partitioning for telemetry data. |
| BMS Adapter (RS485) | Python + pymodbus | pymodbus 3.x | Mature Modbus RTU client library. Reads holding/input registers from BMS over RS485. Configurable baud rate (9600 to 115200). |
| BMS Adapter (CAN) | Python + python-can | python-can 4.x | Standard CAN-bus library. Supports SocketCAN (Linux), PCAN, Vector, and Kvaser interfaces. Parses CAN frames into per-cell data. |
| BMS Simulator | Python (asyncio) | 3.11+ | Generates realistic 6S22P telemetry. Outputs via Socket.IO, same interface as the real BMS adapter. |
| Charting Library | Apache ECharts | 5.x | High-performance time-series rendering, supports 100k+ data points. Better suited for historical analytics than lightweight alternatives. |
| Alert Engine | Custom Python service | n/a | Evaluates configurable rules against incoming telemetry. Triggers in-app, email (SendGrid), and webhook (Slack) notifications. |
| Caching | Redis | 7+ | Cache latest telemetry snapshots for instant page loads. Pub/Sub for internal event routing. |
| Styling | Vanilla CSS + CSS Modules | n/a | Consistent with Afterlife Intelligence design system (dark theme, Sora / JetBrains Mono fonts). Component-scoped styles. |
| State Management | Zustand | 4.x | Lightweight, scalable state management for 132 cells updating at 1 Hz with detail panels, alerts, and multi-mode renders. |
| Deployment | Railway | n/a | Continuity with existing Afterlife Intelligence infrastructure. Unified billing, shared networking. |
| CI/CD | GitHub Actions | n/a | Automated testing, linting, and deployment on push. |
| Monitoring | Sentry (errors) + Grafana (metrics) | n/a | Error tracking, system health dashboards, WebSocket connection monitoring. |
| Containerization | Docker + Docker Compose | n/a | Consistent environments. Compose for local multi-service orchestration (API, Neon dev, Redis, simulator, adapter). |

### 5.2 Technology Selection Rationale

The guiding principle is **continuity**. The Afterlife Intelligence platform already runs on FastAPI (Python) + React (Vite) + Neon (PostgreSQL) deployed on Railway. Every technology choice prioritizes compatibility with this existing stack.

**Why Neon over a separate time-series DB?**

Neon is already the platform database. Adding telemetry tables with time-based partitioning (PostgreSQL native `PARTITION BY RANGE`) avoids introducing a new database engine. Neon's serverless architecture auto-scales compute and storage. For a single 6S22P pack at 1 Hz (132 data points/second, approximately 11.4 million per day), Neon handles this comfortably. If future multi-pack scaling demands dedicated time-series infrastructure, TimescaleDB can be added as a PostgreSQL extension on Neon with zero migration.

**Why Socket.IO over raw WebSocket from the start?**

The unified architecture serves production from Phase 1. Socket.IO's automatic reconnection, event namespacing, and fallback polling are essential for reliability. Building on raw WebSocket and migrating later would waste effort.

**Why RS485 (Modbus RTU) and CAN?**

The BMS hardware explicitly supports these two protocols. Modbus RTU over RS485 is the industrial standard for battery monitoring: reliable over long cable runs, multi-device capable, well-documented register maps. CAN provides high-speed, noise-immune communication as an alternative or complement.

---

## 6. Glossary

| Term | Definition |
|------|-----------|
| 6S22P | Battery pack configuration: 6 cells in series x 22 parallel cells per series group = 132 cells total |
| BMS | Battery Management System: hardware that monitors and protects battery cells |
| CAN | Controller Area Network: a robust serial communication protocol designed for noisy environments, widely used in automotive and industrial applications |
| DCIR | DC Internal Resistance: a measure of cell health (lower is better, measured in milliohms) |
| Digital Twin | A virtual replica of a physical system that stays synchronized via real-time data |
| Google Apps Scripts | Google's cloud-based JavaScript platform used here to autonomously scrape cell test data from Google Drive and ingest into Neon |
| Modbus RTU | A serial communication protocol using the RS485 physical layer, common in industrial monitoring |
| Neon | Serverless PostgreSQL database platform used as the Afterlife Intelligence backend database |
| OCV | Open-Circuit Voltage: voltage measured with no load |
| Pack Assembly Map | Data structure mapping each physical cell position (S1-P1 through S6-P22) to its unique battery code |
| Passport | The Afterlife Intelligence digital identity record for an individual battery cell |
| RS485 | A serial communication standard supporting multi-point, long-distance, noise-resistant data transmission |
| RUL | Remaining Useful Life: predicted time or cycles before a cell falls below usable thresholds |
| SOH | State of Health: percentage indicating remaining capacity versus original rated capacity |
| Telemetry | Continuous stream of measurement data from the BMS |

---

## 7. Addendum: Multi-Pack Scaling Prospective

This addendum outlines the architectural considerations and scaling strategy for expanding beyond the single 6S22P pack to multi-pack configurations. The unified system architecture (Section 4) is designed with this expansion in mind; key extensibility points are identified below.

### 7.1 Scaling Scenarios

| Scenario | Configuration | Total Cells | Telemetry Rate (1 Hz) | Use Case |
|----------|--------------|-------------|----------------------|----------|
| Single Pack (current) | 1 x 6S22P | 132 | 132 pts/sec | Initial build, validation |
| Small Cluster | 4 x 6S22P | 528 | 528 pts/sec | Stationary storage, solar backup |
| Medium Array | 16 x 6S22P | 2,112 | 2,112 pts/sec | Commercial energy storage |
| Large Installation | 64 x 6S22P | 8,448 | 8,448 pts/sec | Grid-scale / industrial |
| Heterogeneous Fleet | Mixed configs | Variable | Variable | Multi-site fleet management |

### 7.2 Architecture Extensibility

#### 7.2.1 Data Model Extension

**Pack Registry (new table):**

| Field | Type | Example |
|-------|------|---------|
| `pack_id` (PK) | string | `PACK-6S22P-001` |
| `pack_name` | string | `Solar Storage Unit A` |
| `configuration` | string | `6S22P` |
| `series_count` | integer | 6 |
| `parallel_count` | integer | 22 |
| `total_cells` | integer | 132 |
| `bms_protocol` | string | `RS485` or `CAN` |
| `charging_current_limit_a` | float | 10 |
| `location` | string | `Building A, Rack 3` |
| `commissioned_date` | date | `2026-08-15` |
| `status` | enum | `ACTIVE`, `MAINTENANCE`, `RETIRED` |
| `assembly_map` | relation | Links to Pack Assembly Map (1:1) |

**Telemetry table gains:** `pack_id` (FK), partitioned by `pack_id` + `time`.

#### 7.2.2 Multi-Pack Dashboard

- **Fleet Overview:** Grid of pack cards, each showing aggregate health (Green/Yellow/Red counts), total voltage, current, and BMS connection status.
- **Click-through:** Each card navigates to the individual pack's 3D digital twin.
- **Comparative Analytics:** Cross-pack charts for aging trends, anomaly frequency, and maintenance cadence.
- **Fleet-level Alerts:** Aggregate alert rules (e.g., "if more than 3 packs have red cells simultaneously").

#### 7.2.3 BMS Adapter Scaling

| Approach | Description | Best For |
|----------|------------|----------|
| One adapter per pack | Dedicated adapter process per BMS, each with its own RS485/CAN connection | Small clusters (16 packs or fewer), simplest to manage |
| Shared adapter with multiplexing | Single adapter process manages multiple RS485/CAN channels via hub/switch | Medium arrays, shared edge hardware |
| Distributed edge nodes | Adapter runs on per-rack edge devices (Raspberry Pi / industrial gateway), pushes to central backend | Large installations, geographically distributed |

#### 7.2.4 Database Scaling Strategy

| Scale | Strategy |
|-------|---------|
| 1 to 4 packs | Single Neon instance, time-based partitioning per pack. Current architecture suffices. |
| 5 to 16 packs | Neon with continuous aggregates: pre-compute hourly/daily rollups to accelerate dashboard queries. Add read replicas for analytics workloads. |
| 17 to 64 packs | Consider adding TimescaleDB extension on Neon for hypertable compression and retention policies. Partition telemetry by pack_id + time. |
| 64+ packs | Evaluate dedicated TimescaleDB or InfluxDB cluster for telemetry. Neon continues to serve relational data (passports, pack registry, maintenance logs). |

#### 7.2.5 Frontend Scaling

| Challenge | Solution |
|-----------|---------|
| Rendering 64+ packs simultaneously | LOD (Level of Detail) rendering: fleet overview uses simplified pack icons; 3D render activates only for the selected pack |
| WebSocket fan-out to many clients | Socket.IO rooms per pack: clients subscribe only to packs they are viewing, reducing broadcast overhead |
| Historical query performance | Materialized views / continuous aggregates for dashboard-level metrics; raw data queries scoped to individual packs |

### 7.3 Inter-Pack Considerations

| Consideration | Detail |
|--------------|--------|
| Series-Parallel Expansion | Multiple 6S22P packs can be connected in series (higher voltage) or parallel (higher capacity). The digital twin should visualize inter-pack wiring topology. |
| Pack-to-Pack Balancing | When packs are connected in parallel, current sharing imbalances between packs become a monitoring concern. The system should track per-pack current contribution. |
| Heterogeneous Configurations | The pack registry data model supports arbitrary S x P configurations, enabling a fleet with mixed pack types (e.g., 6S22P for storage, 14S10P for mobility). |
| Site/Location Hierarchy | For large installations: Site > Rack > Pack > Cell hierarchy, with roll-up health metrics at each level. |
| Centralized vs. Distributed BMS | Large arrays may use a centralized BMS controller that aggregates multiple pack-level BMS units. The adapter layer must support both topologies. |

### 7.4 Scaling Readiness Checklist

| Item | Current State | Multi-Pack Ready? |
|------|--------------|-------------------|
| `pack_id` in telemetry payload | Present | Yes |
| Pack Assembly Map per pack | Neon-backed | Yes |
| Socket.IO namespacing | In architecture | Yes (add per-pack rooms) |
| Neon time-partitioned telemetry | Designed for single pack | Add `pack_id` partition key |
| BMS Adapter | Single adapter | Add multi-channel support |
| Frontend routing | Single pack view | Add fleet dashboard + pack selector |
| Alert rules | Per-cell rules | Add per-pack and fleet-level rules |
| User access control | Phase 4 (pending) | Add pack-level permissions |

---

## 8. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 31 Jul 2026 | Afterlife Intelligence Engineering | Initial draft: 13S10P, two-phase approach (Prototype + Full Pilot) |
| 2.0 | 5 Aug 2026 | Afterlife Intelligence Engineering | Major revision: configuration changed to 6S22P (132 cells); prototype and full-scale development phases coalesced into a single unified system with piecemeal integration roadmap; BMS protocols specified (RS485 + CAN, 10 A charging limit); database specified as Neon (serverless PostgreSQL); autonomous data ingestion via Google Apps Scripts documented; single-unit build scope clarified; multi-pack scaling addendum added (Section 7) |
| 3.0 | 7 Aug 2026 | Afterlife Intelligence Engineering | Cell Matrix Integration: incorporated API-validated cell-to-passport mapping strategy (Section 1.7) with three assembly workflows (scan-to-assign, bulk import, legacy ID lookup); expanded FR-7 with nine sub-requirements for Pack Assembly Map CRUD, assembly validation, and uniqueness constraints; added cell matrix integration architecture (Section 4.2); added new objective O-11; updated cell count to 408; removed all em-dashes; eliminated redundant repetitions of autonomous ingestion and Register Cell/Test Upload deprecation notes; consolidated and polished language throughout |

---

**END OF DOCUMENT**
