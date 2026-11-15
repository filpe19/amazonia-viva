-- Amazônia Viva — esquema alvo em PostgreSQL + PostGIS (preparado, ainda não usado no MVP).
-- O MVP usa SQLite (history_store.py) com as mesmas tabelas de agregados; a migração consiste
-- em reimplementar HistoryStore sobre este esquema e passar a guardar detecções individuais.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Regiões com geometria oficial (IBGE e, futuramente, FUNAI/ICMBio)
CREATE TABLE IF NOT EXISTS region (
    id            text PRIMARY KEY,                -- 'brasil', 'para', 'santarem'
    name          text NOT NULL,
    level         text NOT NULL,                   -- pais | estado | municipio | ti | uc | aoi
    official_code text,                            -- código IBGE, FUNAI, CNUC...
    parent_id     text REFERENCES region(id),
    geom          geometry(MultiPolygon, 4326) NOT NULL,
    source_url    text NOT NULL,
    source_sha256 text NOT NULL,
    fetched_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS region_geom_gix ON region USING gist (geom);

-- Arquivo ou chamada de API de origem (proveniência)
CREATE TABLE IF NOT EXISTS source_file (
    id                 bigserial PRIMARY KEY,
    product_id         text NOT NULL,              -- MODIS_SP, VIIRS_SNPP_SP, VIIRS_NOAA20_NRT...
    kind               text NOT NULL,              -- archive_country | public_nrt | area_api
    year               int,
    country            text,
    url                text NOT NULL,              -- nunca contém MAP_KEY
    http_last_modified text,
    bytes              bigint,
    sha256             text NOT NULL,
    rows_read          bigint,
    rows_invalid       bigint,
    version_values     text[],
    satellites         text[],
    imported_at        timestamptz NOT NULL DEFAULT now(),
    importer_version   text NOT NULL,
    UNIQUE (product_id, kind, year, country, sha256)
);

-- Detecções individuais (particionar por ano em produção)
CREATE TABLE IF NOT EXISTS detection (
    detection_id     text NOT NULL,                -- sha1(produto|lat|lon|data|hora|satélite)[:16]
    product_id       text NOT NULL,
    satellite        text NOT NULL,
    acq_datetime_utc timestamptz NOT NULL,
    daynight         char(1),
    confidence_raw   text,
    confidence_class text,                         -- VIIRS: low/nominal/high
    confidence_pct   smallint,                     -- MODIS: 0–100
    frp_mw           real,
    bright_1_k       real,                         -- VIIRS I4 | MODIS 21/22
    bright_2_k       real,                         -- VIIRS I5 | MODIS 31
    scan_km          real,
    track_km         real,
    type             smallint,                     -- 0 vegetação presumida, 1 vulcão, 2 fonte estática, 3 offshore
    version          text,
    geom             geometry(Point, 4326) NOT NULL,
    source_file_id   bigint NOT NULL REFERENCES source_file(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, detection_id, acq_datetime_utc)
);
CREATE INDEX IF NOT EXISTS detection_geom_gix ON detection USING gist (geom);
CREATE INDEX IF NOT EXISTS detection_time_ix ON detection (product_id, acq_datetime_utc);

-- Agregados (mesma semântica do SQLite do MVP)
CREATE TABLE IF NOT EXISTS daily_counts (
    region_id      text NOT NULL REFERENCES region(id),
    product_id     text NOT NULL,
    satellite      text NOT NULL,
    acq_date       date NOT NULL,
    daynight       char(1) NOT NULL,
    type           smallint NOT NULL,
    conf_bucket    text NOT NULL,
    n              int NOT NULL,
    frp_sum        double precision,
    source_file_id bigint NOT NULL REFERENCES source_file(id) ON DELETE CASCADE,
    PRIMARY KEY (region_id, product_id, satellite, acq_date, daynight, type, conf_bucket)
);

CREATE TABLE IF NOT EXISTS monthly_grid_counts (
    region_id      text NOT NULL REFERENCES region(id),
    product_id     text NOT NULL,
    satellite      text NOT NULL,
    year_month     char(7) NOT NULL,
    cell_id        text NOT NULL,                  -- canto SW da célula de 0,5°
    n              int NOT NULL,
    source_file_id bigint NOT NULL REFERENCES source_file(id) ON DELETE CASCADE,
    PRIMARY KEY (region_id, product_id, satellite, year_month, cell_id)
);
