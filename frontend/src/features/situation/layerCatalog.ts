// Catálogo das camadas do centro de situação: cada uma declara origem, resolução, significado e limitações.
export type LayerId = 'amazon' | 'hotspots' | 'roads' | 'detections' | 'footprints' | 'clusters' | 'distribution' | 'attention' | 'recurrence' | 'fwi' | 'power' | 'municipalities' | 'seats' | 'protected' | 'settlements' | 'localities' | 'health' | 'deter'

export type LayerGroup = 'observations' | 'attention' | 'territories' | 'people' | 'forest' | 'history' | 'weather'
export const LAYER_GROUPS: { id: LayerGroup; label: string; hint: string }[] = [
  { id: 'observations', label: 'Satellite detections', hint: 'What the satellites saw: VIIRS 375 m and MODIS 1 km pixels' },
  { id: 'attention', label: 'Alerts and cross-checks', hint: 'Detections that touch protected areas, communities or recent deforestation' },
  { id: 'territories', label: 'Official territories', hint: 'Boundaries, seats, protected areas and settlements' },
  { id: 'people', label: 'People and infrastructure', hint: 'Mapped localities and health facilities' },
  { id: 'forest', label: 'Forest change (INPE)', hint: 'DETER deforestation, degradation and fire-scar warnings' },
  { id: 'history', label: 'History', hint: 'Where detections recur in the archive' },
  { id: 'weather', label: 'Weather', hint: 'Fire danger and the reanalysis cell used in the panel' },
]

export interface LayerDef {
  id: LayerId
  group: LayerGroup
  label: string
  source: string
  resolution: string
  meaning: string
  limitation: string
  kind: 'observation' | 'estimate' | 'forecast' | 'external' | 'reference'
}

export const LAYERS: LayerDef[] = [
  { id: 'detections', group: 'observations', label: 'Thermal detections (VIIRS 375 m · MODIS 1 km)', source: 'NASA FIRMS near real time — VIIRS on NOAA-20 / NOAA-21; MODIS on Terra / Aqua',
    resolution: 'VIIRS 375 m pixel; MODIS 1 km pixel', meaning: 'Each symbol is a pixel with a thermal anomaly at one satellite overpass. Colour = satellite, shape = sensor, fading = older observation.', limitation: 'Not a fire perimeter or burned area; symbol size is fixed and does not represent fire size. Clouds and overpass timing hide fires.', kind: 'observation' },
  { id: 'footprints', group: 'observations', label: 'Pixel area on the ground (scan × track)', source: 'NASA FIRMS scan and track attributes of each detection',
    resolution: 'From zoom 10; VIIRS ≈ 0.375–0.8 km, MODIS ≈ 1–4.8 km depending on viewing angle', meaning: 'Dashed rectangle = nominal area the sensor integrated for that pixel. The fire can be anywhere inside it, and can be much smaller.', limitation: 'Orientation approximated as north–south (real pixels are tilted ~9° along the orbit). Not a burned area.', kind: 'observation' },
  { id: 'clusters', group: 'observations', label: 'Aggregation at regional scale', source: 'Grouping of the same FIRMS points (map rendering)',
    resolution: 'State view below zoom 7; a selected municipality always shows individual detections', meaning: 'At state scale, nearby detections are grouped; click a group to see which satellites it contains and zoom in.', limitation: 'Visual grouping only: counts mix overpasses and satellites and are not fires or a hotspot statistic.', kind: 'observation' },
  { id: 'distribution', group: 'observations', label: 'Detections per municipality', source: 'Same FIRMS points counted inside IBGE municipal boundaries',
    resolution: 'Municipality (state view)', meaning: 'Count of one satellite at a time in the current window, so sensors are never added together.', limitation: 'Counts depend on overpasses and clouds; larger municipalities tend to have more detections.', kind: 'observation' },
  { id: 'hotspots', group: 'attention', label: 'Hotspots by alert level', source: 'Platform grouping of FIRMS detections (4 satellites) with public alert rules',
    resolution: 'Detections within 1.5 km grouped; one marker per hotspot', meaning: 'Dark red = high, orange = moderate, grey = low alert. Click a marker to see size, wind and what lies in the way.', limitation: 'Screening, not an official alert or a spread forecast.', kind: 'estimate' },
  { id: 'attention', group: 'attention', label: 'Detections flagged by alert criteria', source: 'Platform cross-check of FIRMS detections with FUNAI, ICMBio, CNUC, INCRA, IBGE, CNES and INPE DETER layers',
    resolution: 'Same as each detection; territory outlines from official polygons', meaning: 'Red halo = detection that meets a public criterion (inside an official territory, ≤ 1 km from a locality, ≤ 5 km from a health facility, over a DETER warning). See the Alerts tab.', limitation: 'Screening cross-checks, not official alerts; proximity is not damage and coincidence is not cause.', kind: 'estimate' },
  { id: 'recurrence', group: 'history', label: 'Historical recurrence', source: 'NASA FIRMS archive (standard processing): NOAA-20 2021–2025 or MODIS 2001–2025',
    resolution: '0.1° grid in municipalities (~11 km); 0.5° in Pará', meaning: 'Accumulated detections per cell for the chosen series; darker = more detections over the archive years.', limitation: 'Counts, not burned area. One sensor series at a time; no harmonization applied on the map.', kind: 'observation' },
  { id: 'fwi', group: 'weather', label: 'Fire Weather Index (FWI)', source: 'Copernicus GWIS — ECMWF FWI (WMS)',
    resolution: 'Model grid (~0.25°)', meaning: 'Weather-driven fire danger class from temperature, humidity, wind and rain.', limitation: 'External modeled index, not an observation. Value lookup per point is not offered by the service.', kind: 'external' },
  { id: 'power', group: 'weather', label: 'NASA POWER weather cell', source: 'NASA POWER (GEOS-IT / MERRA-2 reanalysis)',
    resolution: '0.5° × 0.625° (~55 × 69 km)', meaning: 'Area represented by the weather values shown in the panel.', limitation: 'Reanalysis with ~2–3 days latency; not a local station measurement.', kind: 'estimate' },
  { id: 'amazon', group: 'territories', label: 'Amazon boundary (9 countries)', source: 'IBGE (Legal Amazon, Complementary Law 124/2007) + ACTO/OTCA combined layer via Censipam',
    resolution: 'Simplified to ~0.005° (~500 m)', meaning: 'The Amazon as a whole: Brazil’s Legal Amazon and each neighbouring country’s official Amazon definition.', limitation: 'Each country defines its Amazon differently; this is not the hydrographic basin or the biome.', kind: 'reference' },
  { id: 'municipalities', group: 'territories', label: 'Municipal boundaries', source: 'IBGE territorial mesh v3', resolution: 'Maximum quality',
    meaning: 'Click a municipality to analyse it.', limitation: 'Administrative limits only.', kind: 'reference' },
  { id: 'seats', group: 'territories', label: 'Municipal seats', source: 'IBGE Continuous Cartographic Base 1:250,000 (2025), localities of type Cidade or Capital',
    resolution: '1:250,000', meaning: 'Town where the municipal government is seated; the selected municipality’s seat is highlighted.', limitation: 'Point position of the urban area, not its extent.', kind: 'reference' },
  { id: 'protected', group: 'territories', label: 'Protected areas & Indigenous lands', source: 'ICMBio, MMA/CNUC, FUNAI, INCRA (via Censipam GeoServer)',
    resolution: 'Official polygons', meaning: 'Federal and state conservation units, Indigenous lands and quilombola territories overlapping the territory.', limitation: 'Municipal conservation units are not in the consulted layers.', kind: 'reference' },
  { id: 'roads', group: 'territories', label: 'Federal roads (DNIT)', source: 'DNIT National Road System via Censipam GeoServer', resolution: 'Road segments, simplified for display',
    meaning: 'Federal highways (BR) with surface type; hover for the segment. Used for access and to flag roads near hotspots.', limitation: 'State and municipal roads are not included in this layer (see the cartographic basemap).', kind: 'reference' },
  { id: 'settlements', group: 'territories', label: 'Federal settlements', source: 'INCRA (via Censipam GeoServer)', resolution: 'Official polygons',
    meaning: 'Agrarian reform settlements overlapping the territory.', limitation: 'Registry geometry; occupation on the ground may differ.', kind: 'reference' },
  { id: 'localities', group: 'people', label: 'Localities (towns, rural settlements)', source: 'IBGE Continuous Cartographic Base 1:250,000 (2025)',
    resolution: '1:250,000', meaning: 'Mapped populated places. Hover for the name.', limitation: 'Small and traditional communities may be missing.', kind: 'reference' },
  { id: 'health', group: 'people', label: 'Health facilities', source: 'CNES — Ministry of Health open data', resolution: 'Registered coordinates',
    meaning: 'Health establishments with coordinates. Hover for the name and type.', limitation: 'Coordinates are declared by the registry and may be imprecise.', kind: 'reference' },
  { id: 'deter', group: 'forest', label: 'DETER warnings, last 12 months', source: 'INPE DETER Amazônia (TerraBrasilis public WFS)',
    resolution: 'AWFI/WFI imagery, 56–64 m; per municipality', meaning: 'Polygons where INPE mapped clear-cut or vegetated deforestation, degradation, selective logging, mining or forest fire scars.', limitation: 'Enforcement warning system, not the official PRODES rate; forest mask only; clouds delay mapping.', kind: 'external' },
]

export const DEFAULT_LAYERS: Record<LayerId, boolean> = {
  amazon: true, hotspots: true, roads: true, detections: true, footprints: true, clusters: true, distribution: false, attention: true, recurrence: false, fwi: false, power: false, municipalities: true,
  seats: true, protected: true, settlements: false, localities: true, health: false, deter: false,
}

/** Visões prontas: combinações de camadas para perguntas frequentes. */
export const LAYER_PRESETS: { id: string; label: string; hint: string; layers: Partial<Record<LayerId, boolean>> }[] = [
  { id: 'impact', label: 'Investigate impact', hint: 'Protected areas, settlements, communities, health facilities, alerts and DETER',
    layers: { detections: true, attention: true, protected: true, settlements: true, localities: true, health: true, deter: true, seats: true, recurrence: false, fwi: false, distribution: false } },
  { id: 'history', label: 'Compare with history', hint: 'Archive recurrence and detections per municipality',
    layers: { detections: true, recurrence: true, distribution: true, attention: false, deter: false, fwi: false, health: false, settlements: false } },
  { id: 'weather', label: 'Weather danger', hint: 'Fire Weather Index under the detections and the POWER cell',
    layers: { detections: true, fwi: true, power: true, recurrence: false, distribution: false, deter: false } },
  { id: 'clean', label: 'Clean map', hint: 'Detections, boundaries and seats only',
    layers: { detections: true, attention: false, protected: false, settlements: false, localities: false, health: false, deter: false, recurrence: false, distribution: false, fwi: false, power: false } },
]
