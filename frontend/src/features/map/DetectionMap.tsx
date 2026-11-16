import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { t, useLocale } from '../../lib/i18n'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import type { DetectionProps, DetectionsFC } from '../../lib/types'
import { AGE_OPACITY, CLUSTER_PROPERTIES, colorBySatellite, ensureIcon, SATELLITES, seatIcon } from './symbology'
import { fmtUtc } from '../../lib/format'

/** analytical: fundo discreto (Positron); cartographic: OSM Liberty (rios, estradas, localidades);
 *  imagery: mosaico de alta resolução (Esri World Imagery, cena datada por ponto); satellite: NASA GIBS diário datado. */
export type Basemap = 'analytical' | 'cartographic' | 'imagery' | 'satellite'
const IMAGERY_MODES: Basemap[] = ['imagery', 'satellite']

export interface MapLayers {
  points: boolean
  /** agregação automática em escala regional (zoom ≤ 7) */
  aggregate: boolean
  boundary: boolean
  municipalities?: boolean
}

/** Sobreposição temática (ex.: UCs, assentamentos, localidades). */
export interface MapOverlay {
  id: string
  /** polygon (padrão): preenchimento + contorno; circle/symbol: pontos de contexto; raster: tiles externos (WMS). */
  kind?: 'polygon' | 'circle' | 'symbol' | 'raster'
  data?: GeoJSON.FeatureCollection
  tiles?: string[]
  attribution?: string
  color: string | maplibregl.ExpressionSpecification
  fillColor?: maplibregl.ExpressionSpecification | string
  fillOpacity?: number
  opacity?: number
  dashed?: boolean
  radius?: number
  lineWidth?: number
  strokeWidth?: number
  /** cor de preenchimento de círculos por expressão (ex.: por grau de alerta) */
  circleColor?: maplibregl.ExpressionSpecification
  minzoom?: number
  text?: string
  visible?: boolean
  /** rótulo do ponto (nome), com zoom mínimo e prioridade de colisão */
  label?: { field: string; minzoom?: number; size?: maplibregl.ExpressionSpecification | number; sortKey?: maplibregl.ExpressionSpecification }
  tooltip?: (props: Record<string, unknown>) => string
  /** clique num ponto da sobreposição (círculos) */
  onClick?: (props: Record<string, unknown>) => void
}

interface Props {
  data: DetectionsFC | undefined
  boundary: GeoJSON.FeatureCollection | undefined
  bbox: [number, number, number, number] | undefined
  layers: MapLayers
  basemap: Basemap
  imageryDate: string // YYYY-MM-DD do mosaico VIIRS do NASA GIBS
  selectedId: string | null
  onSelect: (p: DetectionProps | null, lngLat?: [number, number]) => void
  municipalities?: GeoJSON.FeatureCollection
  selectedRegionId?: string
  onSelectRegion?: (id: string) => void
  overlays?: MapOverlay[]
  seats?: GeoJSON.FeatureCollection
  /** valores por município (feature-state) para o mapa de distribuição; null desliga */
  munValues?: { values: Record<string, number>; stops: [number, string][] } | null
  /** desenha a área nominal de cada pixel (scan × track) ao aproximar */
  footprints?: boolean
  onMap?: (map: maplibregl.Map | null) => void
  className?: string
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const STYLE_URL: Record<Basemap, string> = {
  analytical: 'https://tiles.openfreemap.org/styles/positron',
  satellite: 'https://tiles.openfreemap.org/styles/positron',
  imagery: 'https://tiles.openfreemap.org/styles/positron',
  cartographic: 'https://tiles.openfreemap.org/styles/liberty',
}
const ARCGIS_KEY = import.meta.env.VITE_ARCGIS_API_KEY as string | undefined
export const HIRES_TILES = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}${ARCGIS_KEY ? `?token=${ARCGIS_KEY}` : ''}`
export const HIRES_ATTRIBUTION = 'Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community'
const FOOTPRINT_MIN_ZOOM = 10

/** Retângulo da área nominal do pixel (scan × track, km) centrado na detecção. Orientação aproximada (alinhado a N–S). */
export function pixelFootprints(fc: DetectionsFC | undefined): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const f of fc?.features ?? []) {
    const { sc, tr } = f.properties
    if (sc == null || tr == null) continue
    const [lon, lat] = f.geometry.coordinates
    const dLat = tr / 2 / 110.574
    const dLon = sc / 2 / (111.32 * Math.cos((lat * Math.PI) / 180))
    features.push({ type: 'Feature', properties: { id: f.properties.id, s: f.properties.s, age: f.properties.age ?? '' },
      geometry: { type: 'Polygon', coordinates: [[[lon - dLon, lat - dLat], [lon + dLon, lat - dLat], [lon + dLon, lat + dLat], [lon - dLon, lat + dLat], [lon - dLon, lat - dLat]]] } })
  }
  return { type: 'FeatureCollection', features }
}
// Índice de agrupamento usa zoom inteiro: grupos até 6.x, detecções individuais a partir de 7.
const AGGREGATE_MAX_ZOOM = 6

function gibsUrl(date: string) {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
}

maplibregl.setWorkerUrl(workerUrl)

// ----------------------------------------------------------------- ordem das camadas
// base → imagem de satélite → raster meteorológico → polígonos de território → contornos municipais
// → (rótulos da base) → detecções → localidades e rótulos prioritários → seleção/realce.
const OWN = new Set<string>()
const SELECTION = ['det-hover', 'det-selected']
const IMAGERY_LAYERS = ['gibs', 'hires']
const isOwn = (id: string) => OWN.has(id) || id.startsWith('ov-')

function firstBase(map: maplibregl.Map, pred: (l: maplibregl.LayerSpecification) => boolean): string | undefined {
  return map.getStyle().layers.find((l) => !isOwn(l.id) && pred(l))?.id
}
function beforeIdFor(map: maplibregl.Map, layer: maplibregl.LayerSpecification, contextPoint = false): string | undefined {
  const layers = map.getStyle().layers
  if (IMAGERY_LAYERS.includes(layer.id)) return firstBase(map, (l) => l.type === 'line')
  if (layer.type === 'raster') {
    const firstOwnVector = layers.find((l) => isOwn(l.id) && !IMAGERY_LAYERS.includes(l.id) && l.type !== 'raster' && ['fill', 'line'].includes(l.type))?.id
    return firstOwnVector ?? firstBase(map, (l) => l.type === 'symbol')
  }
  if (layer.type === 'fill' || layer.type === 'line') return firstBase(map, (l) => l.type === 'symbol')
  // pontos/rótulos de contexto: acima das detecções, abaixo da seleção
  if (contextPoint) return SELECTION.find((id) => map.getLayer(id))
  return undefined
}
function addOwn(map: maplibregl.Map, layer: maplibregl.LayerSpecification, contextPoint = false) {
  OWN.add(layer.id)
  map.addLayer(layer as maplibregl.AddLayerObject, beforeIdFor(map, layer, contextPoint))
}

/** Ajustes por modo de base (pintura apenas; dados e camadas próprias não mudam). */
function tuneBase(map: maplibregl.Map, mode: Basemap) {
  const set = (id: string, prop: string, value: unknown) => { if (map.getLayer(id)) map.setPaintProperty(id, prop as never, value as never) }
  const vis = (id: string, on: boolean) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none') }
  const base = map.getStyle().layers.filter((l) => !isOwn(l.id))
  if (mode === 'analytical' || IMAGERY_MODES.includes(mode)) {
    set('background', 'background-color', '#eef1ec')
    set('water', 'fill-color', '#c6dbe8')
    set('waterway', 'line-color', '#a9c8dc')
  }
  const satellite = IMAGERY_MODES.includes(mode)
  for (const l of base) {
    if (l.type === 'fill' && l.id !== 'background') vis(l.id, !satellite)
    if (l.id === 'waterway') vis(l.id, !satellite)
    if (l.type === 'symbol' && satellite) {
      set(l.id, 'text-color', '#ffffff'); set(l.id, 'text-halo-color', 'rgba(10,20,15,0.85)'); set(l.id, 'text-halo-width', 1.4)
    }
  }
  if (mode === 'cartographic') {
    // Liberty: destacar rios (relevantes na Amazônia) e manter localidades legíveis.
    set('waterway_river', 'line-color', '#6fa8d6')
    for (const id of ['label_city', 'label_town', 'label_village']) set(id, 'text-halo-width', 1.6)
  }
}

export function DetectionMap({
  data, boundary, bbox, layers, basemap, imageryDate, selectedId, onSelect,
  municipalities, selectedRegionId, onSelectRegion, overlays, seats, munValues, footprints = false, onMap, className = '',
}: Props) {
  const { locale } = useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [styleVersion, setStyleVersion] = useState(0)
  const [mapError, setMapError] = useState(false)
  const [retry, setRetry] = useState(0)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onSelectRegionRef = useRef(onSelectRegion)
  onSelectRegionRef.current = onSelectRegion
  const overlayIds = useRef<string[]>([])
  // Pop-up único para áreas e linhas (TIs, UCs, rodovias, DETER…): mostra até 3 feições sob o cursor; pontos têm prioridade.
  const areaTips = useRef<Map<string, (p: Record<string, unknown>) => string>>(new Map())
  const pointLayers = useRef<Set<string>>(new Set())
  const clickHandlers = useRef<Map<string, (p: Record<string, unknown>) => void>>(new Map())
  const areaHit = useRef<(pt: maplibregl.PointLike) => boolean>(() => false)
  const modeRef = useRef<Basemap>(basemap)
  const styleUrlRef = useRef(STYLE_URL[basemap])

  // Inicialização única
  useEffect(() => {
    if (!ref.current) return
    setReady(false)
    setMapError(false)
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE_URL[modeRef.current],
      bounds: bbox ?? [-74, -16, -44, 5.5],
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('error', (e) => {
      console.warn('[map]', e.error?.message ?? e)
      if (!map.isStyleLoaded()) setMapError(true)
    })
    map.on('styleimagemissing', (e) => {
      if (e.id === 'seat-star' && !map.hasImage('seat-star')) map.addImage('seat-star', seatIcon(44), { pixelRatio: 2 })
      else ensureIcon(map, e.id)
    })
    map.on('style.load', () => { tuneBase(map, modeRef.current); setStyleVersion((v) => v + 1) })
    map.once('load', () => {
      map.addSource('gibs', {
        type: 'raster', tiles: [gibsUrl(imageryDate)], tileSize: 256, maxzoom: 9,
        attribution: 'Imagery: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> (VIIRS NOAA-20 corrected reflectance, true color)',
      })
      addOwn(map, { id: 'gibs', type: 'raster', source: 'gibs', layout: { visibility: 'none' } })
      map.addSource('hires', { type: 'raster', tiles: [HIRES_TILES], tileSize: 256, maxzoom: 19, attribution: HIRES_ATTRIBUTION })
      addOwn(map, { id: 'hires', type: 'raster', source: 'hires', layout: { visibility: 'none' } })

      // Municípios (seleção no mapa e distribuição territorial via feature-state)
      map.addSource('mun', { type: 'geojson', data: EMPTY, promoteId: 'id' })
      addOwn(map, {
        id: 'mun-fill', type: 'fill', source: 'mun',
        paint: { 'fill-color': '#0f2e25', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0.0] },
      })
      addOwn(map, {
        id: 'mun-line', type: 'line', source: 'mun',
        paint: { 'line-color': '#5f7268', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 8, 0.9], 'line-opacity': 0.7 },
      })
      addOwn(map, {
        id: 'mun-label', type: 'symbol', source: 'mun', minzoom: 6.2,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'symbol-placement': 'point', 'text-optional': true },
        paint: { 'text-color': '#5c6d64', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
      })
      let hoverId: string | number | null = null
      const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'mun-tip' })
      map.on('mousemove', 'mun-fill', (e) => {
        const f = e.features?.[0]
        if (!f || areaHit.current(e.point) || map.queryRenderedFeatures(e.point, { layers: DET_LAYERS.filter((l) => map.getLayer(l)) }).length) { tip.remove(); return }
        if (hoverId !== null) map.setFeatureState({ source: 'mun', id: hoverId }, { hover: false })
        hoverId = f.id ?? null
        if (hoverId !== null) map.setFeatureState({ source: 'mun', id: hoverId }, { hover: true })
        const n = f.state?.count as number | undefined
        tip.setLngLat(e.lngLat).setHTML(`<strong>${String(f.properties?.name ?? '')}</strong>${n != null ? `<br>${n} ${t('detections in the distribution layer')}` : ''}<br><span style="color:#6b7a72">${t('Select to analyse')}</span>`).addTo(map)
      })
      map.on('mouseleave', 'mun-fill', () => {
        if (hoverId !== null) map.setFeatureState({ source: 'mun', id: hoverId }, { hover: false })
        hoverId = null
        tip.remove()
      })
      map.on('click', 'mun-fill', (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: [...DET_LAYERS, 'cluster-circles'].filter((l) => map.getLayer(l)) }).length) return
        const id = e.features?.[0]?.properties?.id
        if (id && onSelectRegionRef.current) onSelectRegionRef.current(String(id))
      })

      const areaTip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'mun-tip area-tip', maxWidth: '300px' })
      const visibleIds = (ids: Iterable<string>) => [...ids].filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none')
      const box = (pt: maplibregl.Point): [maplibregl.PointLike, maplibregl.PointLike] => [[pt.x - 4, pt.y - 4], [pt.x + 4, pt.y + 4]]
      areaHit.current = (pt) => {
        const ids = visibleIds(areaTips.current.keys())
        return ids.length > 0 && map.queryRenderedFeatures(box(maplibregl.Point.convert(pt)), { layers: ids }).length > 0
      }
      map.on('mousemove', (e) => {
        const ids = visibleIds(areaTips.current.keys())
        const blockers = visibleIds([...DET_LAYERS, 'cluster-circles', 'seats', 'seat-selected', ...pointLayers.current])
        if (!ids.length || (blockers.length && map.queryRenderedFeatures(e.point, { layers: blockers }).length)) { areaTip.remove(); return }
        const feats = map.queryRenderedFeatures(box(e.point), { layers: ids })
        if (!feats.length) { areaTip.remove(); return }
        const parts: string[] = []
        for (const f of feats) {
          const html = areaTips.current.get(f.layer.id)?.(f.properties as Record<string, unknown>)
          if (html && !parts.includes(html)) parts.push(html)
          if (parts.length >= 3) break
        }
        if (!parts.length) { areaTip.remove(); return }
        areaTip.setLngLat(e.lngLat).setHTML(parts.join('<hr>')).addTo(map)
      })
      map.on('mouseout', () => areaTip.remove())

      map.addSource('boundary', { type: 'geojson', data: EMPTY })
      addOwn(map, { id: 'boundary-fill', type: 'fill', source: 'boundary', paint: { 'fill-color': '#0f2e25', 'fill-opacity': 0.03 } })
      addOwn(map, { id: 'boundary-casing', type: 'line', source: 'boundary', paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.9 } })
      addOwn(map, { id: 'boundary-line', type: 'line', source: 'boundary', paint: { 'line-color': '#17402f', 'line-width': 2 } })

      // Área nominal do pixel (scan × track): mostra o que uma detecção representa no terreno ao aproximar.
      map.addSource('footprints', { type: 'geojson', data: EMPTY })
      addOwn(map, { id: 'footprint-fill', type: 'fill', source: 'footprints', minzoom: FOOTPRINT_MIN_ZOOM,
        paint: { 'fill-color': colorBySatellite, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], FOOTPRINT_MIN_ZOOM, 0.04, 14, 0.12] } })
      addOwn(map, { id: 'footprint-line', type: 'line', source: 'footprints', minzoom: FOOTPRINT_MIN_ZOOM,
        paint: { 'line-color': colorBySatellite, 'line-width': ['interpolate', ['linear'], ['zoom'], FOOTPRINT_MIN_ZOOM, 0.6, 14, 1.6], 'line-opacity': 0.85, 'line-dasharray': [3, 1.5] } })

      // Detecções: uma única fonte; agregada em escala regional, individual ao aproximar.
      map.addSource('det', { type: 'geojson', data: EMPTY, cluster: true, clusterMaxZoom: AGGREGATE_MAX_ZOOM, clusterRadius: 46, clusterProperties: CLUSTER_PROPERTIES, promoteId: 'id' })
      addOwn(map, {
        id: 'cluster-circles', type: 'circle', source: 'det', filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#26352e', 'circle-opacity': 0.86,
          'circle-radius': ['step', ['get', 'point_count'], 11, 10, 14, 50, 18, 200, 23, 1000, 29],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
        },
      })
      addOwn(map, {
        id: 'cluster-count', type: 'symbol', source: 'det', filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 11.5, 'text-allow-overlap': true },
        paint: { 'text-color': '#ffffff' },
      })
      const single: maplibregl.FilterSpecification = ['!', ['has', 'point_count']]
      addOwn(map, {
        id: 'det-points', type: 'circle', source: 'det', filter: ['all', single, ['match', ['get', 's'], ['NOAA-20', 'NOAA-21'], true, false]],
        paint: {
          'circle-color': colorBySatellite,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.4, 8, 5, 11, 7, 14, 9],
          'circle-stroke-color': ['match', ['get', 'age'], 'recent', '#14231d', '#ffffff'],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 9, 1.6],
          'circle-opacity': AGE_OPACITY,
          'circle-stroke-opacity': AGE_OPACITY,
        },
      })
      addOwn(map, {
        id: 'det-modis', type: 'symbol', source: 'det', filter: ['all', single, ['match', ['get', 's'], ['Aqua', 'Terra'], true, false]],
        layout: {
          'icon-image': ['concat', 'det-', ['get', 's'], ['case', ['==', ['get', 'age'], 'recent'], '-recent', '']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.62, 8, 0.85, 11, 1.1, 14, 1.35],
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
        },
        paint: { 'icon-opacity': AGE_OPACITY },
      })
      addOwn(map, {
        id: 'det-hover', type: 'circle', source: 'det', filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 7, 9, 10, 13, 13], 'circle-stroke-color': '#14231d', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.7 },
      })
      addOwn(map, {
        id: 'det-selected', type: 'circle', source: 'det', filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-color': 'rgba(255,255,255,0.15)', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 9, 9, 13, 13, 17], 'circle-stroke-color': '#14231d', 'circle-stroke-width': 3 },
      })

      // Sedes municipais (IBGE BC250: localidade do tipo Cidade); a sede do município selecionado tem prioridade.
      map.addSource('seats', { type: 'geojson', data: EMPTY })
      addOwn(map, {
        id: 'seats', type: 'symbol', source: 'seats', minzoom: SEATS_MIN_ZOOM, filter: ['!=', ['get', 'selected'], true],
        layout: {
          'icon-image': 'seat-star', 'icon-size': ['interpolate', ['linear'], ['zoom'], 5.6, 0.32, 9, 0.5],
          'text-field': ['step', ['zoom'], '', 6.4, ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6.4, 10.5, 10, 12.5],
          'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true, 'symbol-sort-key': 1,
        },
        paint: { 'text-color': '#26352e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
      }, true)
      addOwn(map, {
        id: 'seat-selected', type: 'symbol', source: 'seats', filter: ['==', ['get', 'selected'], true],
        layout: {
          'icon-image': 'seat-star', 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 9, 0.72], 'icon-allow-overlap': true,
          'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, 1], 'text-anchor': 'top',
          'text-allow-overlap': true, 'symbol-sort-key': 0,
        },
        paint: { 'text-color': '#0f2e25', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      }, true)

      const seatTip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'mun-tip' })
      for (const id of ['seats', 'seat-selected']) {
        map.on('mousemove', id, (e) => {
          const f = e.features?.[0]
          if (!f) return
          seatTip.setLngLat(e.lngLat).setHTML(`<strong>${String(f.properties?.name)}</strong><br><span style="color:#6b7a72">${t('Municipal seat')} · IBGE BC250 2025</span>`).addTo(map)
        })
        map.on('mouseleave', id, () => seatTip.remove())
      }

      // Interação: realce ao passar, clique abre o painel, grupos explicam o que agregam.
      const hoverTip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'mun-tip' })
      const pick = (e: MapLayerMouseEvent) => {
        const f = e.features?.[0]
        if (f) onSelectRef.current(f.properties as unknown as DetectionProps, [e.lngLat.lng, e.lngLat.lat])
      }
      for (const id of DET_LAYERS) {
        map.on('click', id, pick)
        map.on('mousemove', id, (e) => {
          const p = e.features?.[0]?.properties as DetectionProps | undefined
          if (!p) return
          map.getCanvas().style.cursor = 'pointer'
          map.setFilter('det-hover', ['==', ['get', 'id'], p.id])
          const sat = SATELLITES.find((s) => s.key === p.s)
          hoverTip.setLngLat(e.lngLat).setHTML(`<strong>${sat?.label ?? p.s}</strong> · ${sat?.resolution ?? ''}<br>${fmtUtc(p.t.length === 17 ? p.t.replace('Z', ':00Z') : p.t)}${p.frp != null ? ` · FRP ${p.frp} MW` : ''}`).addTo(map)
        })
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; map.setFilter('det-hover', ['==', ['get', 'id'], '']); hoverTip.remove() })
      }
      const clusterPop = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 14, className: 'cluster-pop', maxWidth: '260px' })
      map.on('click', 'cluster-circles', async (e) => {
        const f = e.features?.[0]
        if (!f) return
        const props = f.properties as Record<string, number>
        const src = map.getSource('det') as GeoJSONSource
        const zoom = await src.getClusterExpansionZoom(props.cluster_id)
        const center = (f.geometry as GeoJSON.Point).coordinates as [number, number]
        const rows = SATELLITES.map((s) => ({ s, n: props[`n_${s.key.replace('-', '')}`] ?? 0 })).filter((r) => r.n > 0)
        const el = document.createElement('div')
        el.className = 'cluster-pop-body'
        el.innerHTML = `<strong>${props.point_count} ${t('detections grouped at this scale')}</strong>
          <ul>${rows.map((r) => `<li><i style="background:${r.s.color}"></i>${r.s.label} <b>${r.n}</b></li>`).join('')}</ul>
          <p>${t('Thermal-anomaly pixels from different overpasses and satellites, not individual fires.')}</p>`
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = t('Zoom in to investigate')
        btn.onclick = () => { clusterPop.remove(); map.easeTo({ center, zoom: Math.max(zoom, AGGREGATE_MAX_ZOOM + 0.6) }) }
        el.appendChild(btn)
        clusterPop.setLngLat(center).setDOMContent(el).addTo(map)
      })
      map.on('mouseenter', 'cluster-circles', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'cluster-circles', () => (map.getCanvas().style.cursor = ''))
      setReady(true)
      setMapError(false)
      requestAnimationFrame(() => { if (mapRef.current === map) { map.resize(); map.triggerRepaint() } })
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __avMap?: maplibregl.Map }).__avMap = map // apenas para testes E2E locais
    const observer = new ResizeObserver(() => {
      if (mapRef.current === map) { map.resize(); map.triggerRepaint() }
    })
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      onMapRef.current?.(null)
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry])

  const onMapRef = useRef(onMap)
  onMapRef.current = onMap
  useEffect(() => { if (ready) onMapRef.current?.(mapRef.current) }, [ready])

  // Troca de mapa-base: Liberty ↔ Positron preserva fontes e camadas próprias (transformStyle).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    modeRef.current = basemap
    const url = STYLE_URL[basemap]
    if (url !== styleUrlRef.current) {
      styleUrlRef.current = url
      const prev = map.getStyle()
      map.setStyle(url, {
        diff: false,
        transformStyle: (_previous, next) => {
          if (!next) return next as never
          const ownLayers = prev.layers.filter((l) => isOwn(l.id))
          const ownSources = Object.fromEntries(Object.entries(prev.sources).filter(([id]) => !next.sources[id]))
          const base = next.layers
          const firstSym = base.findIndex((l) => l.type === 'symbol')
          const firstLine = base.findIndex((l) => l.type === 'line')
          const lower = ownLayers.filter((l) => ['fill', 'line', 'raster'].includes(l.type) && !IMAGERY_LAYERS.includes(l.id))
          const upper = ownLayers.filter((l) => !['fill', 'line', 'raster'].includes(l.type))
          const gibs = ownLayers.filter((l) => IMAGERY_LAYERS.includes(l.id))
          const out = [...base]
          out.splice(firstSym < 0 ? out.length : firstSym, 0, ...lower)
          out.splice(firstLine < 0 ? 1 : firstLine, 0, ...gibs)
          return { ...next, sources: { ...next.sources, ...ownSources }, layers: [...out, ...upper] }
        },
      })
    } else {
      tuneBase(map, basemap)
    }
  }, [basemap, ready])

  // Dados (já filtrados por satélite e com classe de idade)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    ;(map.getSource('det') as GeoJSONSource | undefined)?.setData((data ?? EMPTY) as GeoJSON.FeatureCollection)
  }, [data, ready, styleVersion])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    ;(map.getSource('boundary') as GeoJSONSource | undefined)?.setData(boundary ?? EMPTY)
  }, [boundary, ready, styleVersion])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    ;(map.getSource('mun') as GeoJSONSource | undefined)?.setData(municipalities ?? EMPTY)
  }, [municipalities, ready, styleVersion])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: (seats?.features ?? []).map((f) => ({ ...f, properties: { ...f.properties, selected: f.properties?.region_id === selectedRegionId } })) }
    ;(map.getSource('seats') as GeoJSONSource | undefined)?.setData(fc)
    const hasSeats = Boolean(seats?.features.length)
    for (const id of BASE_PLACE_LABELS) if (map.getLayer(id)) map.setLayerZoomRange(id, 0, hasSeats ? SEATS_MIN_ZOOM : 24)
  }, [seats, selectedRegionId, ready, styleVersion])

  // Distribuição territorial: preenchimento por feature-state (sem nova fonte).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !map.getSource('mun')) return
    map.removeFeatureState({ source: 'mun' })
    if (munValues) {
      for (const [id, n] of Object.entries(munValues.values)) map.setFeatureState({ source: 'mun', id }, { count: n })
      map.setPaintProperty('mun-fill', 'fill-color', ['case', ['boolean', ['feature-state', 'hover'], false], '#0f2e25',
        ['step', ['coalesce', ['feature-state', 'count'], 0], ...munValues.stops.flatMap(([v, c], i) => (i === 0 ? [c] : [v, c]))]] as never)
      map.setPaintProperty('mun-fill', 'fill-opacity', ['case', ['boolean', ['feature-state', 'hover'], false], 0.18, ['>', ['coalesce', ['feature-state', 'count'], 0], 0], 0.5, 0])
    } else {
      map.setPaintProperty('mun-fill', 'fill-color', '#0f2e25')
      map.setPaintProperty('mun-fill', 'fill-opacity', ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0.0])
    }
  }, [munValues, municipalities, ready, styleVersion])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const vis = layers.municipalities === false ? 'none' : 'visible'
    for (const id of ['mun-fill', 'mun-line', 'mun-label']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
  }, [layers.municipalities, ready, styleVersion])

  // Sobreposições temáticas (ordem garantida por beforeIdFor).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const layerIds = (id: string) => [`ov-${id}-raster`, `ov-${id}-fill`, `ov-${id}-line`, `ov-${id}-circle`, `ov-${id}-symbol`, `ov-${id}-label`]
    const wanted = new Set((overlays ?? []).map((o) => o.id))
    for (const id of overlayIds.current) {
      if (!wanted.has(id)) {
        for (const l of layerIds(id)) { areaTips.current.delete(l); pointLayers.current.delete(l); if (map.getLayer(l)) map.removeLayer(l) }
        if (map.getSource(`ov-${id}`)) map.removeSource(`ov-${id}`)
      }
    }
    for (const o of overlays ?? []) {
      const sid = `ov-${o.id}`
      const kind = o.kind ?? 'polygon'
      const existing = map.getSource(sid)
      if (kind === 'raster') {
        if (existing && (existing as maplibregl.RasterTileSource).setTiles) (existing as maplibregl.RasterTileSource).setTiles(o.tiles ?? [])
        else if (!existing) {
          map.addSource(sid, { type: 'raster', tiles: o.tiles ?? [], tileSize: 256, attribution: o.attribution })
          addOwn(map, { id: `${sid}-raster`, type: 'raster', source: sid, paint: { 'raster-opacity': o.opacity ?? 0.45, 'raster-fade-duration': 0 } })
        }
        if (map.getLayer(`${sid}-raster`)) map.setPaintProperty(`${sid}-raster`, 'raster-opacity', o.opacity ?? 0.45)
      } else if (existing) {
        (existing as GeoJSONSource).setData(o.data ?? EMPTY)
      } else {
        map.addSource(sid, { type: 'geojson', data: o.data ?? EMPTY })
        if (kind === 'polygon') {
          addOwn(map, { id: `${sid}-fill`, type: 'fill', source: sid, paint: { 'fill-color': (o.fillColor ?? o.color) as never, 'fill-opacity': o.fillOpacity ?? 0.12 } })
          addOwn(map, { id: `${sid}-line`, type: 'line', source: sid,
            paint: { 'line-color': o.color as never, 'line-width': o.lineWidth ?? (o.fillColor ? 0.6 : 1.4), ...(o.dashed ? { 'line-dasharray': [2, 1.5] } : {}) } })
        } else if (kind === 'circle') {
          addOwn(map, { id: `${sid}-circle`, type: 'circle', source: sid, ...(o.minzoom ? { minzoom: o.minzoom } : {}),
            paint: { 'circle-radius': o.radius ?? 4.5, 'circle-color': (o.circleColor ?? (typeof o.fillColor === 'string' ? o.fillColor : '#ffffff')) as never, 'circle-stroke-color': o.color as never, 'circle-stroke-width': o.strokeWidth ?? (typeof o.fillColor === 'string' ? 1 : 2) } }, true)
        } else {
          addOwn(map, { id: `${sid}-symbol`, type: 'symbol', source: sid, ...(o.minzoom ? { minzoom: o.minzoom } : {}),
            layout: { 'text-field': o.text ?? '+', 'text-font': ['Noto Sans Bold'], 'text-size': 17, 'text-allow-overlap': true },
            paint: { 'text-color': o.color, 'text-halo-color': '#ffffff', 'text-halo-width': 2 } }, true)
        }
        if (o.label && kind === 'polygon') {
          addOwn(map, { id: `${sid}-label`, type: 'symbol', source: sid, minzoom: o.label.minzoom ?? 5,
            layout: { 'text-field': ['get', o.label.field], 'text-font': ['Noto Sans Bold'], 'text-size': o.label.size ?? 11.5, 'text-optional': true, 'text-max-width': 10,
              'symbol-placement': 'point', ...(o.label.sortKey ? { 'symbol-sort-key': o.label.sortKey } : {}) },
            paint: { 'text-color': (typeof o.color === 'string' ? o.color : '#5c1a0e') as never, 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 } }, true)
        }
        if (o.label && (kind === 'circle' || kind === 'symbol')) {
          addOwn(map, { id: `${sid}-label`, type: 'symbol', source: sid, minzoom: o.label.minzoom ?? 9,
            layout: { 'text-field': ['get', o.label.field], 'text-font': ['Noto Sans Regular'], 'text-size': o.label.size ?? 11,
              'text-offset': [0, 0.85], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 9,
              ...(o.label.sortKey ? { 'symbol-sort-key': o.label.sortKey } : {}) },
            paint: { 'text-color': '#26352e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } }, true)
        }
        if (o.tooltip && (kind === 'circle' || kind === 'symbol')) {
          const lid = `${sid}-${kind}`
          const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'mun-tip' })
          const fmt = o.tooltip
          map.on('mousemove', lid, (e) => {
            const f = e.features?.[0]
            if (!f) return
            map.getCanvas().style.cursor = 'help'
            tip.setLngLat(e.lngLat).setHTML(fmt(f.properties as Record<string, unknown>)).addTo(map)
          })
          map.on('mouseleave', lid, () => { map.getCanvas().style.cursor = ''; tip.remove() })
        }
      }
      const v = o.visible === false ? 'none' : 'visible'
      for (const l of layerIds(o.id)) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', v)
      if (kind === 'polygon' && o.tooltip) { areaTips.current.set(`${sid}-fill`, o.tooltip); areaTips.current.set(`${sid}-line`, o.tooltip) }
      if ((kind === 'circle' || kind === 'symbol') && (o.tooltip || o.onClick)) pointLayers.current.add(`${sid}-${kind}`)
      if (kind === 'circle' && o.onClick) {
        const lid = `${sid}-circle`
        if (!clickHandlers.current.has(lid)) {
          map.on('click', lid, (e) => {
            // Detecção sob o cursor tem prioridade (abre a investigação); o marcador do foco responde fora do pixel.
            if (map.queryRenderedFeatures(e.point, { layers: DET_LAYERS.filter((l) => map.getLayer(l)) }).length) return
            const f = e.features?.[0]
            if (f) clickHandlers.current.get(lid)?.(f.properties as Record<string, unknown>)
          })
          map.on('mouseenter', lid, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', lid, () => { map.getCanvas().style.cursor = '' })
        }
        clickHandlers.current.set(lid, o.onClick)
      }
    }
    overlayIds.current = [...wanted]
  }, [overlays, ready, styleVersion])

  // Enquadramento só ao trocar de região (nunca a cada atualização de dados).
  const bboxKey = bbox?.join(',')
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !bbox) return
    map.fitBounds(bbox, { padding: framePadding(map), duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450, maxZoom: 11 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey, ready])

  // Camadas e agregação
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const vis = (on: boolean) => (on ? 'visible' : 'none')
    for (const id of [...DET_LAYERS, 'det-hover', 'det-selected', 'cluster-circles', 'cluster-count']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis(layers.points))
    for (const id of ['boundary-fill', 'boundary-casing', 'boundary-line']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis(layers.boundary))
    const src = map.getSource('det') as GeoJSONSource | undefined
    void src?.setClusterOptions({ cluster: layers.aggregate, clusterMaxZoom: AGGREGATE_MAX_ZOOM, clusterRadius: 46 })
  }, [layers.points, layers.boundary, layers.aggregate, ready, styleVersion])

  // Base: imagem VIIRS datada (GIBS) ou mosaico de alta resolução (Esri) e contraste do limite
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !map.getLayer('gibs')) return
    ;(map.getSource('gibs') as maplibregl.RasterTileSource).setTiles([gibsUrl(imageryDate)])
    map.setLayoutProperty('gibs', 'visibility', basemap === 'satellite' ? 'visible' : 'none')
    if (map.getLayer('hires')) map.setLayoutProperty('hires', 'visibility', basemap === 'imagery' ? 'visible' : 'none')
    const img = IMAGERY_MODES.includes(basemap)
    map.setPaintProperty('boundary-line', 'line-color', img ? '#ffffff' : '#17402f')
    map.setPaintProperty('boundary-casing', 'line-color', img ? '#0f2e25' : '#ffffff')
    map.setPaintProperty('mun-line', 'line-color', img ? '#e8efe9' : '#5f7268')
    if (map.getLayer('footprint-fill')) map.setPaintProperty('footprint-fill', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], FOOTPRINT_MIN_ZOOM, img ? 0.08 : 0.04, 14, img ? 0.18 : 0.12])
  }, [basemap, imageryDate, ready, styleVersion])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    ;(map.getSource('footprints') as GeoJSONSource | undefined)?.setData(footprints ? pixelFootprints(data) : EMPTY)
  }, [data, footprints, ready, styleVersion])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !map.getLayer('det-selected')) return
    map.setFilter('det-selected', ['==', ['get', 'id'], selectedId ?? ''])
  }, [selectedId, ready, styleVersion])

  useEffect(() => {
    const labels: [string, string][] = [['.maplibregl-ctrl-attrib-button', 'Toggle attribution']]
    for (const [selector, label] of labels) {
      const control = ref.current?.querySelector<HTMLButtonElement>(selector)
      if (control) { control.title = t(label); control.setAttribute('aria-label', t(label)) }
    }
  }, [locale, ready])

  return <div className={`map-canvas-wrap ${className}`} data-map-state={mapError ? 'error' : ready ? 'ready' : 'loading'} data-basemap={basemap} data-feature-count={data?.features.length ?? 0}>
    <div ref={ref} className="h-full w-full" role="application" aria-label={t("Satellite observation map; select a detection or municipality")} />
    {!ready && <div className="map-status" role="status">{mapError ? <>{t("The basemap could not be loaded.")} <button onClick={() => setRetry(r => r + 1)}>{t("Retry map")}</button></> : t("Loading geographic layers…")}</div>}
  </div>
}

export const DET_LAYERS = ['det-points', 'det-modis']
/** Rótulos de lugares do mapa-base (OSM) substituídos pelas sedes municipais do IBGE no zoom regional/local. */
const BASE_PLACE_LABELS = ['label_city', 'label_city_capital', 'label_town', 'label_village', 'label_other']
const SEATS_MIN_ZOOM = 5.6

/** Margens que preservam a barra superior, a barra de ferramentas e a legenda. */
export function framePadding(map: maplibregl.Map) {
  const w = map.getContainer().clientWidth
  return w < 700 ? { top: 120, bottom: 110, left: 18, right: 52 } : { top: 76, bottom: 118, left: 36, right: 64 }
}
