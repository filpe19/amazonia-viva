import maplibregl, { type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import type { DetectionProps, DetectionsFC } from '../../lib/types'
import { PRODUCT_STYLES } from '../../lib/products'

export type Basemap = 'mapa' | 'imagem'

export interface MapLayers {
  points: boolean
  clusters: boolean
  boundary: boolean
  municipalities?: boolean
}

/** Sobreposição temática (ex.: UCs, assentamentos, eventos Censipam). */
export interface MapOverlay {
  id: string
  data: GeoJSON.FeatureCollection
  color: string
  fillOpacity?: number
  dashed?: boolean
  visible?: boolean
}

interface Props {
  data: DetectionsFC | undefined
  boundary: GeoJSON.FeatureCollection | undefined
  bbox: [number, number, number, number] | undefined
  layers: MapLayers
  basemap: Basemap
  imageryDate: string // YYYY-MM-DD para o mosaico VIIRS do NASA GIBS
  selectedId: string | null
  onSelect: (p: DetectionProps | null, lngLat?: [number, number]) => void
  municipalities?: GeoJSON.FeatureCollection
  selectedRegionId?: string
  onSelectRegion?: (id: string) => void
  overlays?: MapOverlay[]
  className?: string
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

const colorExpr = [
  'match', ['get', 'p'],
  ...Object.values(PRODUCT_STYLES).flatMap((s) => [s.id, s.color]),
  '#6b7a72',
] as unknown as maplibregl.ExpressionSpecification

function gibsUrl(date: string) {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
}

const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

/** Ajustes leves no estilo Positron: fundo líquen e rios mais visíveis (relevantes na Amazônia). */
function tuneBase(map: maplibregl.Map) {
  const set = (id: string, prop: string, value: unknown) => {
    if (map.getLayer(id)) map.setPaintProperty(id, prop, value)
  }
  set('background', 'background-color', '#eef1ec')
  set('water', 'fill-color', '#c6dbe8')
  set('waterway', 'line-color', '#a9c8dc')
}

function firstSymbolLayer(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id
}

export function DetectionMap({
  data, boundary, bbox, layers, basemap, imageryDate, selectedId, onSelect,
  municipalities, selectedRegionId, onSelectRegion, overlays, className = '',
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [mapError, setMapError] = useState(false)
  const [retry, setRetry] = useState(0)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onSelectRegionRef = useRef(onSelectRegion)
  onSelectRegionRef.current = onSelectRegion
  const overlayIds = useRef<string[]>([])

  // Inicialização única
  useEffect(() => {
    if (!ref.current) return
    setReady(false)
    setMapError(false)
    const map = new maplibregl.Map({
      container: ref.current,
      style: BASE_STYLE_URL,
      bounds: bbox ?? [-74, -16, -44, 5.5],
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('error', (e) => {
      console.warn('[map]', e.error?.message ?? e)
      if (!map.isStyleLoaded()) setMapError(true)
    })
    map.on('load', () => {
      tuneBase(map)
      map.addSource('gibs', {
        type: 'raster',
        tiles: [gibsUrl(imageryDate)],
        tileSize: 256,
        maxzoom: 9,
        attribution: 'Imagery: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> (VIIRS NOAA-20, true color)',
      })
      map.addLayer({ id: 'gibs', type: 'raster', source: 'gibs', layout: { visibility: 'none' } }, firstSymbolLayer(map))

      // Municípios (seleção no mapa)
      map.addSource('mun', { type: 'geojson', data: EMPTY, promoteId: 'id' })
      map.addLayer({
        id: 'mun-fill', type: 'fill', source: 'mun',
        paint: { 'fill-color': '#0f2e25', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.1, 0.0] },
      })
      map.addLayer({
        id: 'mun-line', type: 'line', source: 'mun',
        paint: { 'line-color': '#5f7268', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 8, 0.9], 'line-opacity': 0.7 },
      })
      map.addLayer({
        id: 'mun-label', type: 'symbol', source: 'mun', minzoom: 6.2,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'symbol-placement': 'point' },
        paint: { 'text-color': '#44554d', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
      })
      let hoverId: string | number | null = null
      const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8, className: 'mun-tip' })
      map.on('mousemove', 'mun-fill', (e) => {
        const f = e.features?.[0]
        if (!f) return
        if (hoverId !== null) map.setFeatureState({ source: 'mun', id: hoverId }, { hover: false })
        hoverId = f.id ?? null
        if (hoverId !== null) map.setFeatureState({ source: 'mun', id: hoverId }, { hover: true })
        tip.setLngLat(e.lngLat).setHTML(`<strong>${String(f.properties?.name ?? '')}</strong><br><span style="color:#6b7a72">select to analyse</span>`).addTo(map)
      })
      map.on('mouseleave', 'mun-fill', () => {
        if (hoverId !== null) map.setFeatureState({ source: 'mun', id: hoverId }, { hover: false })
        hoverId = null
        tip.remove()
      })
      map.on('click', 'mun-fill', (e) => {
        const onDetection = map.queryRenderedFeatures(e.point, { layers: ['det-points', 'cluster-circles', 'cluster-single'].filter((l) => map.getLayer(l)) })
        if (onDetection.length) return
        const id = e.features?.[0]?.properties?.id
        if (id && onSelectRegionRef.current) onSelectRegionRef.current(String(id))
      })

      map.addSource('boundary', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'boundary-fill', type: 'fill', source: 'boundary', paint: { 'fill-color': '#0f2e25', 'fill-opacity': 0.04 } })
      map.addLayer({ id: 'boundary-casing', type: 'line', source: 'boundary', paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 0.9 } })
      map.addLayer({ id: 'boundary-line', type: 'line', source: 'boundary', paint: { 'line-color': '#17402f', 'line-width': 1.6 } })

      map.addSource('det', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'det-points',
        type: 'circle',
        source: 'det',
        paint: {
          'circle-color': colorExpr,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.2, 6, 3.4, 9, 5.5, 12, 8],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 8, 1.5],
          'circle-opacity': 0.9,
        },
      })
      map.addLayer({
        id: 'det-selected',
        type: 'circle',
        source: 'det',
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-color': 'rgba(0,0,0,0)',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 7, 9, 11, 12, 14],
          'circle-stroke-color': '#14231d',
          'circle-stroke-width': 2.5,
        },
      })

      map.addSource('det-cluster', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 42, clusterMaxZoom: 10 })
      map.addLayer({
        id: 'cluster-circles',
        type: 'circle',
        source: 'det-cluster',
        filter: ['has', 'point_count'],
        layout: { visibility: 'none' },
        paint: {
          'circle-color': '#0f2e25',
          'circle-opacity': 0.82,
          'circle-radius': ['step', ['get', 'point_count'], 12, 25, 16, 100, 21, 500, 27, 2000, 33],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'det-cluster',
        filter: ['has', 'point_count'],
        layout: {
          visibility: 'none',
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      })
      map.addLayer({
        id: 'cluster-single',
        type: 'circle',
        source: 'det-cluster',
        filter: ['!', ['has', 'point_count']],
        layout: { visibility: 'none' },
        paint: { 'circle-color': colorExpr, 'circle-radius': 4, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 },
      })

      const pick = (e: MapLayerMouseEvent) => {
        const f = e.features?.[0]
        if (f) onSelectRef.current(f.properties as unknown as DetectionProps, [e.lngLat.lng, e.lngLat.lat])
      }
      for (const id of ['det-points', 'cluster-single']) {
        map.on('click', id, pick)
        map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''))
      }
      map.on('click', 'cluster-circles', async (e) => {
        const f = e.features?.[0]
        if (!f) return
        const src = map.getSource('det-cluster') as GeoJSONSource
        const zoom = await src.getClusterExpansionZoom(f.properties!.cluster_id as number)
        map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom })
      })
      map.on('mouseenter', 'cluster-circles', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'cluster-circles', () => (map.getCanvas().style.cursor = ''))
      setReady(true)
      setMapError(false)
      // Layout and cached data can settle before the first WebGL frame, especially
      // with React StrictMode and responsive workspaces. Resize after style load.
      requestAnimationFrame(() => { if (mapRef.current === map) { map.resize(); map.triggerRepaint() } })
    })
    mapRef.current = map
    const observer = new ResizeObserver(() => {
      if (mapRef.current === map) { map.resize(); map.triggerRepaint() }
    })
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry])

  // Dados
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const fc = (data ?? EMPTY) as GeoJSON.FeatureCollection
    ;(map.getSource('det') as GeoJSONSource).setData(fc)
    ;(map.getSource('det-cluster') as GeoJSONSource).setData(fc)
    map.triggerRepaint()
  }, [data, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    ;(map.getSource('boundary') as GeoJSONSource).setData(boundary ?? EMPTY)
  }, [boundary, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    ;(map.getSource('mun') as GeoJSONSource).setData(municipalities ?? EMPTY)
  }, [municipalities, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const vis = layers.municipalities === false ? 'none' : 'visible'
    for (const id of ['mun-fill', 'mun-line', 'mun-label']) map.setLayoutProperty(id, 'visibility', vis)
  }, [layers.municipalities, ready])

  // Sobreposições temáticas (inseridas abaixo das detecções)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const wanted = new Set((overlays ?? []).map((o) => o.id))
    for (const id of overlayIds.current) {
      if (!wanted.has(id)) {
        for (const l of [`ov-${id}-fill`, `ov-${id}-line`]) if (map.getLayer(l)) map.removeLayer(l)
        if (map.getSource(`ov-${id}`)) map.removeSource(`ov-${id}`)
      }
    }
    for (const o of overlays ?? []) {
      const sid = `ov-${o.id}`
      const src = map.getSource(sid) as GeoJSONSource | undefined
      if (src) src.setData(o.data)
      else {
        map.addSource(sid, { type: 'geojson', data: o.data })
        map.addLayer({ id: `${sid}-fill`, type: 'fill', source: sid, paint: { 'fill-color': o.color, 'fill-opacity': o.fillOpacity ?? 0.12 } }, 'boundary-fill')
        map.addLayer({
          id: `${sid}-line`, type: 'line', source: sid,
          paint: { 'line-color': o.color, 'line-width': 1.4, ...(o.dashed ? { 'line-dasharray': [2, 1.5] } : {}) },
        }, 'boundary-fill')
      }
      const v = o.visible === false ? 'none' : 'visible'
      map.setLayoutProperty(`${sid}-fill`, 'visibility', v)
      map.setLayoutProperty(`${sid}-line`, 'visibility', v)
    }
    overlayIds.current = [...wanted]
  }, [overlays, ready])

  // Enquadramento ao trocar de região
  const bboxKey = bbox?.join(',')
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !bbox) return
    const padding = { top: 36, bottom: 70, left: 32, right: 32 }
    map.fitBounds(bbox, { padding, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400, maxZoom: 9 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey, ready])

  // Camadas
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const vis = (on: boolean) => (on ? 'visible' : 'none')
    map.setLayoutProperty('det-points', 'visibility', vis(layers.points && !layers.clusters))
    map.setLayoutProperty('det-selected', 'visibility', vis(layers.points && !layers.clusters))
    for (const id of ['cluster-circles', 'cluster-count', 'cluster-single']) map.setLayoutProperty(id, 'visibility', vis(layers.clusters))
    for (const id of ['boundary-fill', 'boundary-casing', 'boundary-line']) map.setLayoutProperty(id, 'visibility', vis(layers.boundary))
  }, [layers, ready])

  // Base: mapa ou imagem VIIRS do dia
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const src = map.getSource('gibs') as maplibregl.RasterTileSource
    src.setTiles([gibsUrl(imageryDate)])
    map.setLayoutProperty('gibs', 'visibility', basemap === 'imagem' ? 'visible' : 'none')
    map.setPaintProperty('boundary-line', 'line-color', basemap === 'imagem' ? '#ffffff' : '#17402f')
    map.setPaintProperty('boundary-casing', 'line-color', basemap === 'imagem' ? '#0f2e25' : '#ffffff')
  }, [basemap, imageryDate, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setFilter('det-selected', ['==', ['get', 'id'], selectedId ?? ''])
  }, [selectedId, ready])

  void selectedRegionId
  return <div className={`map-canvas-wrap ${className}`} data-map-state={mapError ? 'error' : ready ? 'ready' : 'loading'} data-feature-count={data?.features.length ?? 0}>
    <div ref={ref} className="h-full w-full" role="application" aria-label="Satellite observation map; select a detection or municipality" />
    {!ready && <div className="map-status" role="status">{mapError ? <>The basemap could not be loaded. <button onClick={() => setRetry(r => r + 1)}>Retry map</button></> : 'Loading geographic layers…'}</div>}
  </div>
}
