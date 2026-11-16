# Amazônia Viva

**Environmental intelligence for the Amazon, built on NASA satellite fire data.**
Built by team **Binary Horizon (Horizonte Binário)** for the NASA Space Apps Challenge 2026 challenge
**"Harmonization of MODIS and VIIRS Hot Spots"**.

> Português: [README.pt-BR.md](README.pt-BR.md)

Amazônia Viva turns NASA FIRMS fire detections into territorial context. It shows where fire activity is unusual,
which hotspots deserve attention, and who and what may be affected. It also states clearly what the data cannot say.

> **Not an official alert system.** A satellite detection is a pixel with a thermal anomaly at the time of the
> overpass. It is not a confirmed fire. MODIS and VIIRS are never summed. Fire spread and the probability of
> reaching a place are not modeled. The platform supports decisions and does not replace civil defense or
> environmental agencies.

## What it does

### 1. Harmonized fire history (the challenge)
- MODIS (1 km pixels, Terra/Aqua) and VIIRS (375 m pixels, NOAA-20/NOAA-21) see fire at different resolutions,
  so raw counts are **never added or compared directly**.
- Each satellite is compared only with itself (MODIS × MODIS archive, NOAA-20 × NOAA-20 archive).
- An **experimental harmonized series** converts MODIS Aqua into NOAA-20-equivalent detections.
  - It is validated by leaving one year out. For Pará: median error 14.3%, 90th percentile 54.1%,
    60 active months, 2021–2025.
  - The uncertainty is shown on every chart.
- The result is a **monthly fire-activity calendar for 2002–2025** with seasonal profiles, year comparison and
  unusual months (robust z-score with P10/P90 bands).

### 2. Situation center
- Near-real-time FIRMS detections from **four satellites** (NOAA-20, NOAA-21, Terra, Aqua) are grouped into
  **hotspots**: detections within 1.5 km of each other.
- Each hotspot shows:
  - its proportion (pixels, overpasses, satellites, area) and observed displacement;
  - **model wind** (Open-Meteo);
  - **what lies in the path**: towns, federal roads, Indigenous lands, quilombola territories, settlements and
    protected areas within 5/10/20 km or downwind.
- **Alert level** (high, moderate, low) and **detection reliability** follow public, written rules. There is no
  arbitrary risk score.
- The map has satellite imagery, hover pop-ups for every layer and quick layer filters. It is available in
  Portuguese and English.

### 3. Dedicated alerts for Indigenous lands
- Each Indigenous land (FUNAI, plus OTCA for the other Amazon countries) is classified as: fire inside confirmed
  by two or more overpasses, fire inside, or fire within 10 km.
- Each alert shows:
  - census residents (IBGE 2022) and peoples;
  - the FUNAI regional office to contact;
  - the nearest road and brigade;
  - a bulletin ready to copy or share.

### 4. "Is it really a fire?"
- For each detection, the platform checks other overpasses, the FIRMS static-source type, ANM mining titles,
  INPE DETER warnings and archive recurrence.
- It then shows a rule-based reading: *compatible with vegetation fire*, *mining context*, *clearing context*,
  *static source* or *inconclusive*.

### 5. Evidence sheet
- Each territory has a printable report in which every fact is labeled as an observation, an estimate or an
  external indicator, with its source.

**Coverage:** the nine Amazon countries. All 144 municipalities of Pará (Brazil) have detailed history.
Santarém and Portel are the pilots.

## Data sources

| Source | Used for |
|---|---|
| **NASA FIRMS** (near real time and archive) | VIIRS 375 m (NOAA-20, NOAA-21) and MODIS C6.1 (Terra, Aqua) detections; 2002–2025 fire calendar |
| **NASA POWER** | Weather reanalysis and climatology |
| **NASA GIBS** | Dated satellite basemap |
| INPE TerraBrasilis (DETER) | Deforestation and degradation warnings |
| IBGE | Territorial meshes, BC250 localities, 2022 Census (SIDRA) |
| Censipam Panorama | Fire Panel API; GeoServer layers for FUNAI, ICMBio, CNUC, INCRA, DNIT and OTCA |
| DATASUS CNES, ANM SIGMINE | Health facilities and mining titles |
| Copernicus GWIS, Open-Meteo | Fire Weather Index (FWI) and model wind |
| Esri World Imagery, OpenFreeMap / OpenStreetMap | Basemaps |

More detail: [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md). Only real, traceable public data is shown. Synthetic
fixtures exist only inside the automated tests.

## Architecture

```
amazonia-viva/
├── backend/   FastAPI (Python 3.11): integrations, science (harmonization, anomalies), services (hotspots,
│              Indigenous alerts, cross-checks), Parquet archive + SQLite aggregates, file cache
├── frontend/  React 19 + TypeScript + Vite + Tailwind 4 + MapLibre GL + TanStack Query + Recharts (PT-BR/EN)
├── deploy/    Docker images, nginx, Caddy, compose files and deployment guide
└── docs/      architecture, methodology, data sources, product notes and development reports
```

- Heavy geospatial work (Shapely STRtree, pyproj) runs off the event loop, one job at a time. Results are cached
  and identical requests are coalesced.
- API reference: `/docs` (OpenAPI) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Method: [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## Run locally

Requirements: Python 3.11 and Node 20+.

```bash
make setup          # virtualenv, dependencies, npm install, IBGE boundaries, census tracts for Pará
make history-pilot  # optional: imports the FIRMS archive (streams ~1.1 GB; keeps aggregates and a Parquet subset)
make api            # http://127.0.0.1:8710  (OpenAPI docs at /docs)
make web            # http://127.0.0.1:5710
```

- Without a key, the backend reads the public FIRMS near-real-time files.
- With a free FIRMS MAP_KEY (`FIRMS_MAP_KEY` in `backend/.env`), it uses the FIRMS area API. The key stays on
  the server and is redacted from logs and responses.

## Quality

- **Backend:** 93 tests (pytest, no network). **Frontend:** type check + vitest.
- **End-to-end:** Playwright flows on real data (map and pilot).
- **Data consistency:** 30/30 checks comparing independent routes and official IBGE totals
  (`backend/scripts/verify_consistency.py`).
- **Accessibility:** zero WCAG 2.1 AA violations in automated axe-core audits.

```bash
make test   # backend + frontend
make lint   # ruff
make e2e    # browser flow with real data (local Chrome)
```

## Deployment

Docker images for the API and the web app (nginx with per-IP rate limits and security headers), plus a Caddy
profile for automatic HTTPS. See [deploy/DEPLOY.md](deploy/DEPLOY.md) and [docs/DEPLOY_VPS.md](docs/DEPLOY_VPS.md)
(shared server behind an existing nginx).

## Known limitations

- The harmonized MODIS → VIIRS series is experimental and is labeled as such. Uncertainty is empirical
  (leave-one-year-out), not a calibrated confidence interval.
- Alert levels follow transparent rules but have not yet been calibrated with field teams.
- Detailed history (archive, census tracts, health facilities) is complete for Pará. The other Amazon states and
  countries have near-real-time detections, hotspots and Indigenous-land alerts.
- Wind comes from numerical models (Open-Meteo), not from local stations.
- External sources can be temporarily unavailable. The interface always says which source failed and never
  shows a failure as zero.

## Use of AI

We used Claude (Anthropic), an AI assistant, to help write and review code, tests, data pipelines and
documentation, to translate texts into English and to script the demo videos. whisper.cpp was used to time the
subtitles. All data shown are real public data. There are no AI-generated images, footage or voices.

## Team

**Binary Horizon (Horizonte Binário):** Felipe Souza (software engineer and full-stack developer), Ariel Barros
(social worker) and Ronaldo Moraes (full-stack developer).
