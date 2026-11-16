// Mapa de evidências da Ficha Territorial: base discreta, sede, referências, contorno em destaque,
// detecções por satélite e polígonos oficiais. Para impressão/PDF, o canvas vira imagem (preserveDrawingBuffer).
import * as maplibregl from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { t, useLocale } from '../../lib/i18n'
import type { DetectionsFC } from '../../lib/types'
import { colorBySatellite, ensureIcon, seatIcon } from './symbology'

export interface EvidencePolygonLayer { id: string; label: string; geometries: GeoJSON.Geometry[]; stroke: string; fill?: string; dashed?: boolean }

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const PLACE_LABELS = ['label_city', 'label_city_capital', 'label_town', 'label_village', 'label_other']

export function EvidenceMap({ boundary, bbox, polygons, detections, seats, regionId, localities, municipalities, ariaLabel, onError }: {
  boundary?: GeoJSON.FeatureCollection
  bbox?: [number, number, number, number]
  polygons: EvidencePolygonLayer[]
  detections?: DetectionsFC
  seats?: GeoJSON.FeatureCollection
  regionId: string
  localities?: { name: string; type?: string | null; lon: number; lat: number }[]
  municipalities?: GeoJSON.FeatureCollection
  ariaLabel: string
  onError?: () => void
}) {
  useLocale()
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    if (!ref.current || !bbox) return
    const map = new maplibregl.Map({
      container: ref.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      bounds: bbox,
      fitBoundsOptions: { padding: { top: 28, bottom: 28, left: 24, right: 24 } },
      interactive: false,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    })
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-left')
    map.on('styleimagemissing', (e) => {
      if (e.id === 'seat-star' && !map.hasImage('seat-star')) map.addImage('seat-star', seatIcon(44), { pixelRatio: 2 })
      else ensureIcon(map, e.id)
    })
    map.on('error', (e) => { if (!map.isStyleLoaded()) onErrorRef.current?.(); console.warn('[evidence-map]', e.error?.message ?? e) })
    map.once('load', () => {
      const set = (id: string, p: string, v: unknown) => { if (map.getLayer(id)) map.setPaintProperty(id, p as never, v as never) }
      set('background', 'background-color', '#f3f5f1'); set('water', 'fill-color', '#cddfea'); set('waterway', 'line-color', '#a9c8dc')
      for (const id of PLACE_LABELS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none') // nomes vêm do IBGE
      const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
      map.addSource('mun', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'mun-line', type: 'line', source: 'mun', paint: { 'line-color': '#8a9a91', 'line-width': 0.7 } }, firstSymbol)
      map.addSource('poly', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'poly-fill', type: 'fill', source: 'poly', paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': ['case', ['==', ['get', 'fill'], 'none'], 0, 1] } }, firstSymbol)
      map.addLayer({ id: 'poly-line', type: 'line', source: 'poly', filter: ['!=', ['get', 'dashed'], true], paint: { 'line-color': ['get', 'stroke'], 'line-width': 1.1 } }, firstSymbol)
      map.addLayer({ id: 'poly-line-dash', type: 'line', source: 'poly', filter: ['==', ['get', 'dashed'], true], paint: { 'line-color': ['get', 'stroke'], 'line-width': 1.1, 'line-dasharray': [2, 1.5] } }, firstSymbol)
      map.addSource('boundary', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'boundary-casing', type: 'line', source: 'boundary', paint: { 'line-color': '#ffffff', 'line-width': 5 } }, firstSymbol)
      map.addLayer({ id: 'boundary-line', type: 'line', source: 'boundary', paint: { 'line-color': '#0f2e25', 'line-width': 2.2 } }, firstSymbol)
      map.addLayer({ id: 'mun-label', type: 'symbol', source: 'mun', filter: ['!=', ['get', 'id'], regionId],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': 10, 'text-optional': true },
        paint: { 'text-color': '#7a8a81', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } })
      map.addSource('loc', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'loc-dot', type: 'circle', source: 'loc', paint: { 'circle-radius': 2.2, 'circle-color': '#56645c', 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.8 } })
      map.addSource('det', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'det-viirs', type: 'circle', source: 'det', filter: ['match', ['get', 's'], ['NOAA-20', 'NOAA-21'], true, false],
        paint: { 'circle-color': colorBySatellite, 'circle-radius': 3.4, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 0.9 } })
      map.addLayer({ id: 'det-modis', type: 'symbol', source: 'det', filter: ['match', ['get', 's'], ['Aqua', 'Terra'], true, false],
        layout: { 'icon-image': ['concat', 'det-', ['get', 's']], 'icon-size': 0.55, 'icon-allow-overlap': true, 'icon-ignore-placement': true } })
      map.addLayer({ id: 'loc-label', type: 'symbol', source: 'loc', filter: ['==', ['get', 'type'], 'Vila'],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'text-offset': [0, 0.7], 'text-anchor': 'top', 'text-optional': true },
        paint: { 'text-color': '#26352e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } })
      map.addSource('seats', { type: 'geojson', data: EMPTY })
      map.addLayer({ id: 'seats', type: 'symbol', source: 'seats',
        layout: { 'icon-image': 'seat-star', 'icon-size': ['case', ['==', ['get', 'region_id'], regionId], 0.62, 0.4], 'icon-allow-overlap': true,
          'text-field': ['get', 'name'], 'text-font': ['case', ['==', ['get', 'region_id'], regionId], ['literal', ['Noto Sans Bold']], ['literal', ['Noto Sans Regular']]],
          'text-size': ['case', ['==', ['get', 'region_id'], regionId], 12.5, 10.5], 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true,
          'symbol-sort-key': ['case', ['==', ['get', 'region_id'], regionId], 0, 1] },
        paint: { 'text-color': '#0f2e25', 'text-halo-color': '#ffffff', 'text-halo-width': 1.8 } })
      setReady(true)
    })
    mapRef.current = map
    let timer = 0
    map.on('idle', () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { try { setSnapshot(map.getCanvas().toDataURL('image/png')) } catch { setSnapshot(null) } }, 150)
    })
    return () => { window.clearTimeout(timer); map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bbox?.join(','), regionId])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const src = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource | undefined
    src('boundary')?.setData(boundary ?? EMPTY)
    src('mun')?.setData(municipalities ?? EMPTY)
    src('poly')?.setData({ type: 'FeatureCollection', features: polygons.flatMap((l) => l.geometries.map((g) => ({ type: 'Feature' as const, geometry: g, properties: { id: l.id, stroke: l.stroke, fill: l.fill ?? 'none', dashed: Boolean(l.dashed) } }))) })
    src('det')?.setData((detections ?? EMPTY) as GeoJSON.FeatureCollection)
    src('seats')?.setData(seats ?? EMPTY)
    src('loc')?.setData({ type: 'FeatureCollection', features: (localities ?? []).filter((l) => l.type !== 'Cidade' && l.type !== 'Capital').map((l) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [l.lon, l.lat] }, properties: { name: l.name, type: l.type ?? '' } })) })
  }, [ready, boundary, municipalities, polygons, detections, seats, localities])

  return (
    <div className="evidence-map" role="img" aria-label={ariaLabel}>
      <div ref={ref} className="evidence-canvas" />
      {snapshot && <img src={snapshot} alt="" className="evidence-print" />}
      <span className="north-arrow" aria-label={t('North')}>▲<b>N</b></span>
    </div>
  )
}
