// Tipos espelhando as respostas da API (backend/app/api/routes).

export type RegionId = 'brasil' | 'para' | 'santarem' | (string & {})
export type WindowLabel = '24h' | '48h' | '7d'
export type DayNight = 'all' | 'D' | 'N'

export interface Region {
  id: RegionId
  name: string
  level: 'pais' | 'estado' | 'municipio'
  ibge_code: string
  parent: string | null
  pilot: boolean
  bbox: [number, number, number, number]
  centroid: [number, number]
  boundary_source: string | null
  boundary_fetched_at: string | null
  boundary_publisher: string
  featured?: boolean
  area_km2?: number
  area_note?: string
}

export interface ApiErrorBody {
  error: { code: string; message: string; source?: string | null; detail?: unknown }
}

export interface Provenance {
  source: string
  mode: 'public_file' | 'area_api'
  request_urls: string[]
  fetched_at: string
  cache_hit: boolean
  stale: boolean
  http_last_modified: string | null
  sha256: string
  rows_in_source: number
  source_earliest_observation_utc: string | null
  source_latest_observation_utc: string | null
  nominal_latency: string
  nominal_latency_source: string
  versions: string[]
  warnings: string[]
}

export interface ProductSummary {
  product_id: string
  sensor: 'VIIRS' | 'MODIS'
  platform: string
  processing: 'NRT' | 'SP'
  collection: string
  resolution_m: number
  confidence_scale: string
  status: 'ativo' | 'encerrado'
  status_note: string | null
  available: boolean
  error: { code: string; message: string; detail?: unknown } | null
  count: number
  provenance?: Provenance
  latest_observation_utc: string | null
  by_daynight?: Record<string, number>
  by_satellite?: Record<string, number>
  by_day_utc?: Record<string, number>
  by_confidence?: Record<string, number>
  confidence_pct_quartiles?: number[] | null
  frp_mw?: { n_with_value: number; median: number | null; p90: number | null; max: number | null }
}

export interface DetectionsMeta {
  region: Region
  window: { label: WindowLabel; start_utc: string; end_utc: string }
  daynight: DayNight
  generated_at: string
  platform_data_fetched_at: string | null
  latest_observation_utc: string | null
  total_count_note: string
  products: ProductSummary[]
}

export interface DetectionProps {
  id: string
  p: string
  s: string
  t: string
  frp: number | null
  c: string | number | null
  dn: 'D' | 'N'
}

export interface DetectionsFC {
  type: 'FeatureCollection'
  features: { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: DetectionProps }[]
  metadata: DetectionsMeta
}

export interface DetectionRecord {
  detection_id: string
  product_id: string
  sensor: 'VIIRS' | 'MODIS'
  satellite: string
  satellite_name: string
  instrument: string
  latitude: number
  longitude: number
  acq_date: string
  acq_time: string
  acq_datetime_utc: string
  daynight: 'D' | 'N'
  confidence_raw: string
  confidence_class: string | null
  confidence_pct: number | null
  frp_mw: number | null
  bright_ti4_k: number | null
  bright_ti5_k: number | null
  brightness_k: number | null
  bright_t31_k: number | null
  scan_km: number | null
  track_km: number | null
  version: string | null
  type: number | null
}

export interface SourcesInfo {
  firms: {
    map_key_configured: boolean
    modes: Record<string, string>
    nominal_latency: string
    nominal_latency_source: string
    map_key_signup: string
    products: (Record<string, unknown> & { id: string; sensor: string; platform: string; processing: string; status: string; status_note: string | null; nrt_mode: string | null })[]
  }
  power: { base_url: string; docs: string; note: string }
  boundaries: { publisher: string; api: string }
}

export interface Health {
  status: string
  version: string
  time_utc: string
  firms_map_key_configured: boolean
  regions_loaded: string[]
  history_imported: boolean
}

// ---------------------------------------------------------------- clima
export interface DailyWeather {
  date: string
  T2M: number | null
  T2M_MAX: number | null
  RH2M: number | null
  WS10M: number | null
  WD10M: number | null
  PRECTOTCORR: number | null
}

export interface WindRose {
  n_hours: number
  sectors: string[]
  speed_classes_ms: string[]
  freq_pct: number[][]
  prevailing_sector?: string
  resultant_direction_from_deg?: number
  mean_speed_ms?: number
  convention?: string
}

export interface PeriodBlock {
  days_with_data: number
  precip_total_mm: number | null
  rh_mean_pct: number | null
  t2m_max_mean_c: number | null
  period: [string, string]
}

export interface WeatherContext {
  point: { lat: number; lon: number; basis?: string }
  grid_note: string
  generated_at: string
  errors: Record<string, { code: string; message: string }>
  forecast: { available: boolean; note: string }
  recent_analysis: {
    available: boolean
    kind?: string
    time_standard?: string
    sources?: string[]
    api_version?: string
    parameters?: Record<string, { units: string; longname: string }>
    last_available_date?: string | null
    latency_days?: number | null
    series?: DailyWeather[]
    latest?: DailyWeather
    last_7d?: PeriodBlock
    last_14d?: PeriodBlock
    last_30d?: PeriodBlock
    provenance?: { source: string; request_url: string; fetched_at: string; cache_hit: boolean; stale: boolean; warnings: string[] }
  }
  recent_hourly: {
    available: boolean
    last_available_hour_utc?: string
    latest?: Record<string, number | null>
    wind_rose_7d?: WindRose
    wind_height_m?: number
    provenance?: { source: string; request_url: string; fetched_at: string }
  }
  historical: {
    available: boolean
    range?: string
    sources?: string[]
    monthly?: Record<string, Record<string, number | null>>
    parameters?: Record<string, { units: string; longname: string }>
    precip_vs_climatology?: Record<string, { observed_mm: number | null; climatology_expected_mm: number | null; ratio: number | null; days_with_data: number }>
    provenance?: { source: string; request_url: string; fetched_at: string }
  }
}

// ------------------------------------------------------------- histórico
export interface HistoryStatus {
  empty: boolean
  products: { product_id: string; sensor: string; platform: string; resolution_m: number; status_note: string | null; imported: boolean; years: number[]; files: number; satellites: string[]; bytes_processed: number }[]
  source_files: {
    id: number; product_id: string; year: number; url: string; http_last_modified: string | null; bytes: number; sha256: string
    rows_read: number; rows_by_region: Record<string, number>; min_acq_date: string; max_acq_date: string
    version_values: string[]; satellites: string[]; imported_at: string; importer_version: string
  }[]
  storage: string
}

export interface MonthlyPoint { year_month: string; year: number; month: number; n: number; percentile_vs_other_years: number | null; baseline_median: number | null }
export interface BaselineMonth { month: number; n_years: number; years: number[]; median: number | null; p10: number | null; p25: number | null; p75: number | null; p90: number | null; minimum: number | null; maximum: number | null }
export interface MonthlyHistory {
  region_id: string; product_id: string; sensor: string; satellites: string[] | 'todos'; years: number[]
  series: MonthlyPoint[]; baseline_by_month: BaselineMonth[]; min_years_for_percentiles: number; note: string
  anomalies?: Anomaly[]; anomaly_rule?: string
}
export interface CalendarHistory { region_id: string; product_id: string; year: number; days: { date: string; n: number }[]; max: number; total: number }
export interface OverlapHistory {
  region_id: string
  reference: { product_id: string; satellites: string[] | 'todos' }
  other: { product_id: string; platform?: string }
  overlap_years: number[]
  comparison: {
    months_paired: number; months_only_ref: string[]; months_only_other: string[]
    spearman_rho: number | null; pearson_r_log1p: number | null
    ratio_median_all: number | null; ratio_median_active_months: number | null; ratio_iqr_active_months: [number, number] | null
    active_months_threshold: number; n_active_months: number
    series: { year_month: string; ref: number; other: number; ratio: number | null }[]
  }
  interpretation_limits: string[]
  spatial?: { grid_deg: number; min_cells_for_reliable?: number; jaccard_median_reliable?: number | null; months: { year_month: string; cells_ref: number; cells_other: number; jaccard: number | null; spearman_cells: number | null; reliable?: boolean }[] }
}
export interface ComparePeriods { a: { start: string; end: string; days: number; n: number }; b: { start: string; end: string; days: number; n: number }; difference: number; ratio_b_over_a: number | null; note: string }

// ------------------------------------------------------------- território
export interface Signal { id: string; label: string; rule: string; value: string | null; status: 'met' | 'not_met' | 'unknown' | 'not_applicable'; evidence: unknown; uncertainty: string }
export interface TerritoryBrief {
  region: Region
  generated_at: string
  weather_point: { lat: number; lon: number; basis: string }
  recent: { available: boolean; window?: string; products?: ProductSummary[] }
  historical_comparison: {
    available: boolean; reason?: string; product_current?: string; product_baseline?: string; satellites?: string[]
    period?: [string, string]; n_days?: number; current_count?: number
    baseline?: { totals_by_year: Record<string, number>; stats: BaselineMonth & { n_years: number } }
    percentile?: number | null; ratio_to_median?: number | null
  }
  weather: WeatherContext | { available: false; reason: string }
  attention: {
    experimental: true; validated: false; disclaimer: string; level: 'sem_sinais' | 'observar' | 'examinar'; level_rule: string
    signals_met: number; signals_evaluated: number; signals_total: number; signals_not_applicable: number; signals: Signal[]
  }
  facts: { text: string; source: string }[]
  limitations: string[]
  future_layers: { id: string; label: string; status: string; candidate_source: string }[]
}

export interface EvidenceManifest {
  manifest_version: string
  generated_at: string
  query: { region: string; window: WindowLabel; products: string[]; daynight: DayNight }
  region: Region
  window: { label: WindowLabel; start_utc: string; end_utc: string }
  observations: ProductSummary[]
  historical_sources: { product_id: string; year: number; url: string; http_last_modified: string | null; sha256: string; rows_read: number; rows_by_region: Record<string, number>; version_values: string[]; imported_at: string }[]
  boundary: { source_url: string | null; fetched_at: string | null }
  limitations: string[]
  export: { csv: string; pdf: { available: boolean; note: string } }
}

// ------------------------------------------------------ Missão 02: território
export type InfoKind = 'observacao' | 'estimativa' | 'previsao' | 'indicador_externo' | 'ausente'

export interface Comparison {
  experimental?: boolean
  note?: string
  units?: string
  origins?: Record<string, string>
  ratio_source?: string
  label: string
  product_current: string
  product_baseline: string
  kind: InfoKind
  available: boolean
  reason?: string
  satellites?: string[] | null
  period?: [string, string]
  n_days?: number
  current_count?: number
  baseline?: { totals_by_year: Record<string, number>; stats: BaselineMonth & { n_years: number } }
  percentile?: number | null
  ratio_to_median?: number | null
}

export interface LayerItem {
  name: string
  attributes: Record<string, string | number>
  area_in_territory_km2: number
  share_of_territory_pct: number | null
  share_of_feature_inside_pct: number
  geometry: GeoJSON.Geometry
  detections_7d_by_product?: Record<string, number>
}

export interface TerritoryLayer {
  id: string
  label: string
  primary_source: string
  served_by: string
  kind: InfoKind
  available: boolean
  reason?: string
  items: LayerItem[]
  count?: number
  note?: string | null
  provenance?: { url: string; fetched_at: string; cache_hit: boolean; stale: boolean; warnings: string[]; features_in_bbox: number }
}

export interface CensipamEvent {
  id_evento: number
  status_evento: string
  dt_minima: string
  dt_maxima: string
  dt_ultima_visao: string
  persistencia_dias: number
  dominio: string | null
  municipio: string | null
  terra_indigena: string[]
  unidade_conservacao: string[]
  quilombola: string[]
  projeto_assentamento: string[]
  priority: { indice: number | null; indice_referencia: number | null; variacao_percentual: number | null; dt_referencia: string | null } | null
  geometry: GeoJSON.Geometry
}

export interface TerritoryContext {
  region: Region
  generated_at: string
  layers: { available: boolean; kind?: InfoKind; reason?: string; layers?: TerritoryLayer[]; method?: string; gaps?: string[]; wfs?: string }
  population: {
    available: boolean; kind: InfoKind; reason?: string; label?: string; population?: number | null; area_km2_official?: number | null
    density_per_km2?: number | null; reference_date?: string; source?: string; url?: string; fetched_at?: string; caveat?: string
  }
  censipam: {
    available: boolean; kind: InfoKind; reason?: string; source: string; docs?: string; events?: CensipamEvent[]; count?: number
    by_status?: Record<string, number>; with_priority?: number; priority_note?: string; priority_error?: string | null
    area_note?: string; selection?: string
    provenance?: { events_url: string; events_fetched_at: string; priorities_url: string | null; stale: boolean; warnings: string[] }
  }
}

export interface Fact { kind: InfoKind; text: string; source: string }

export interface BriefV2 extends Omit<TerritoryBrief, 'facts'> {
  facts: Fact[]
  comparisons: Comparison[]
  persistent_cells?: { cell_sw: [number, number]; size_deg: number; days_with_detection: number }[]
  forecast: { available: boolean; kind: InfoKind; note: string }
}

export interface Ficha {
  ficha_version: string
  title: string
  generated_at: string
  region: Region & { area_km2?: number; area_note?: string }
  kinds: Record<InfoKind, string>
  sections: { id: string; title: string; kind: InfoKind }[]
  brief: BriefV2
  context: TerritoryContext
  impact: ImpactReport
  questions?: { id: string; question: string }[]
  human_review: string[]
  decrees: { id: string; date: string; summary: string; verification: string }[]
  limitations: string[]
}

// ------------------------------------------------------ Missão 03
export interface Anomaly { year_month: string; year: number; month: number; n: number; median_other_years: number; percentile: number; robust_z: number | null; direction: 'acima' | 'abaixo'; n_years_compared: number }

export interface ProximityItem {
  name: string; type?: string | null; lon: number; lat: number
  nearest_detection_km: number | null
  detections_within_km?: Record<string, number>
  nearest_detection_time_utc?: string | null
  nearest_detection_product?: string
  approximate?: boolean
  cnes?: number; type_code?: number; emergency_capable?: boolean; hospital_care?: boolean; coordinate_inside_territory?: boolean
}

export interface ImpactReport {
  available: boolean
  kind?: InfoKind
  reason?: string
  region: Region
  generated_at?: string
  method?: string
  detections_used?: { window: string; products: string[]; count: number; area: string; kind: InfoKind; provenance: { product_id?: string; available: boolean; fetched_at?: string; error?: string }[] }
  localities?: { available: boolean; kind: InfoKind; reason?: string; source?: string; url?: string; fetched_at?: string; count?: number; by_type?: Record<string, number>; within_5km?: number; items?: ProximityItem[]; caveat?: string }
  health?: { available: boolean; kind: InfoKind; reason?: string; source?: string; url?: string; fetched_at?: string; count_registered?: number; count_with_coordinates?: number; without_coordinates?: number; hospital_care_count?: number; within_5km?: number; items?: ProximityItem[]; caveat?: string }
  exposure?: {
    available: boolean; kind: InfoKind; reason?: string | null; label?: string; radius_km?: number; tracts_total?: number; population_total?: number
    tracts_within_radius?: number; population_upper_bound?: number; population_upper_bound_share_pct?: number | null
    tracts_with_detection_inside?: number; population_in_tracts_with_detection_inside?: number; urban_tracts_within_radius?: number
    top_tracts?: { cd_setor: string; situacao: string; area_km2: number; population: number; detections_within_radius: number; detections_inside: number; nearest_detection_km: number }[]
    source?: string; source_url?: string; source_sha256?: string; source_fetched_at?: string; method?: string; caveat?: string
  }
  infrastructure?: {
    airstrips: { available: boolean; reason?: string; items?: { name: string; surface: string | null; use: string | null; length_m: number | null; operational: string | null; lon: number; lat: number }[]; count?: number; source?: string; url?: string }
    brigades: { available: boolean; reason?: string; items?: { name: string; agency: string; municipality: string; uf: string; distance_from_centroid_km: number; inside_territory: boolean }[]; inside_territory?: number; source?: string; note?: string }
  }
  not_integrated?: string[]
}

export interface CoverageReport {
  region_id: string
  products: ({ product_id: string; available: boolean; reason?: string; instrument?: string; resolution?: string; algorithm?: string; overpass_local?: string; processing?: string; years?: number[]
    per_year?: { year: number; detections_in_territory: number; days_with_detection: number; months_with_detection: number; versions: string[]; satellites: string[]; file_first_date: string; file_last_date: string; sha256: string }[] })[]
  overlap_years_with_modis: Record<string, number[]>
  uncertainties: string[]
}

export interface HarmonizationExperiment {
  region_id: string
  reference: { product_id: string; satellites: string[] | 'todos' }
  other: { product_id: string; platform?: string }
  overlap_years: number[]
  experimental: true
  validated_fusion: false
  common_aggregation: string
  normalized: { months: { year_month: string; ref_index: number | null; other_index: number | null }[]; ref_mean: number | null; other_mean: number | null; median_abs_index_difference: number | null }
  loyo: {
    available: boolean; reason?: string; years: number[]; active_min?: number
    per_year?: { year: number; n_test_months: number; ratio_constante_treino?: number; constante: { median_ape: number; max_ape: number } | null; sazonal: { median_ape: number; max_ape: number } | null }[]
    summary?: Record<'constante' | 'sazonal', { median_ape: number; p90_ape: number; n_months: number } | null>
    interpretation?: string
  }
  statement: string
}

// ------------------------------------------------------ Missão 04: série harmonizada experimental
export interface HarmonizedRow { year_month: string; year: number; month: number; value: number | null; low: number | null; high: number | null; origin: 'observado_viirs' | 'convertido_modis' | 'sem_dado'; modis_n: number | null; viirs_n: number | null }
export interface HarmonizedSeries {
  region_id: string; experimental: true; validated_fusion: false; units: string; reference_sensor: string; converted_sensor: string
  period: [string, string] | null; first_month_with_data: string | null; overlap_years: number[]; ratio_source: string
  ratios: { available: boolean; global?: { ratio: number; p10: number; p90: number; n_months: number }; by_month?: Record<string, { ratio: number; p10: number; p90: number; n_years: number; source: string }> }
  series: HarmonizedRow[]
  annual: { year: number; value: number; low: number; high: number; converted_months: number }[]
  baseline_by_month: BaselineMonth[]
  anomalies: Anomaly[]
  validation: HarmonizationExperiment['loyo']
  method: string
  limitations: string[]
}
