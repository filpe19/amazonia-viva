import { t, useLocale } from '../lib/i18n'
import { AlertTriangle, ChevronDown, ChevronRight, Download, Info } from 'lucide-react'
import type * as maplibregl from 'maplibre-gl'
import { useEffect, useMemo, useState } from 'react'
import { Segmented } from '../components/controls'
import { OverpassRibbon } from '../components/OverpassRibbon'
import { Loading, ErrorState } from '../components/states'
import { ObservationTable } from '../features/map/ObservationTable'
import { DetectionMap, type Basemap, type MapLayers, type MapOverlay } from '../features/map/DetectionMap'
import { ATTENTION_CATEGORY, filterSignal } from '../features/situation/AttentionTab'
import { TI_ALERT_STYLE } from '../features/situation/IndigenousPanel'
import { LEVEL_STYLE } from '../features/situation/HotspotPanel'
import { useImageryInfo } from '../features/situation/imagery'
import { framePadding } from '../features/map/DetectionMap'
import { prepareDetections, productsFor, SATELLITE_KEYS, satelliteStyle, type SatelliteKey } from '../features/map/symbology'
import { IntelPanel, type IntelTab } from '../features/situation/IntelPanel'
import { DEFAULT_LAYERS, type LayerId } from '../features/situation/layerCatalog'
import { MapLegend, type LegendEntry } from '../features/situation/MapLegend'
import { MapToolbar } from '../features/situation/MapToolbar'
import { countByMunicipality, fwiTiles, powerCell, yesterdayUtc } from '../features/situation/geo'
import { apiUrl } from '../lib/api'
import { fmt1, fmtAgo, fmtDate, fmtInt, fmtUtc } from '../lib/format'
import { sourceCopy } from '../lib/sourceCopy'
import { useAttention, useBoundary, useDeter, useHistoryDetections, useHotspots, useIndigenous, useMapLayers, useDetections, useHistoryGrid, useImpact, useMunicipalities, useRegions, useSeats, useTerritoryContext } from '../lib/hooks'
import { useRegion } from '../lib/region-context'
import { useSessionState } from '../lib/useSessionState'
import type { AttentionSignal, DayNight, DetectionProps, DetectionsFC, HotspotItem, IndigenousItem, WindowLabel } from '../lib/types'

const WINDOW_LABEL: Record<WindowLabel, string> = { '24h': 'last 24 hours', '48h': 'last 48 hours', '7d': 'last 7 days' }
export const PROTECTED_STYLE: Record<string, { color: string; fill: string; label: string }> = {
  ucs_federais: { color: '#1a7a52', fill: '#1a9e6e', label: 'Federal conservation units' },
  ucs_estaduais: { color: '#4c8c2b', fill: '#6aa84f', label: 'State conservation units' },
  terras_indigenas: { color: '#8a3b12', fill: '#b5651d', label: 'Indigenous lands' },
  quilombolas: { color: '#7a4b9e', fill: '#9b6bbf', label: 'Quilombola territories' },
}
// Rampas com significados distintos: recorrência (marrom, arquivo), distribuição (ardósia, janela atual), FWI (legenda oficial).
const RECURRENCE_RAMP = ['#f3e6da', '#e3c3a5', '#cf9a70', '#b26d42', '#8a4520', '#5e2a0f']
const DISTRIBUTION_RAMP = ['#e3e8ee', '#b9c4d1', '#8796ab', '#5a6b84', '#33435c']
const RECURRENCE_SERIES = { VIIRS_NOAA20_SP: 'NOAA-20 · 2021–2025', MODIS_SP: 'MODIS · 2001–2025' } as const
type RecurrenceProduct = keyof typeof RECURRENCE_SERIES
// Classes DETER: cores distintas da paleta de satélites (âmbar, azul, verde, magenta).
export const DETER_STYLE: Record<string, { color: string; label: string }> = {
  deforestation: { color: '#9c4a1a', label: 'Deforestation (clear-cut or with vegetation)' },
  burn_scar: { color: '#3d3d3d', label: 'Forest fire scar' },
  degradation: { color: '#a07d45', label: 'Degradation' },
  selective_logging: { color: '#6f6233', label: 'Selective logging' },
  mining: { color: '#5b4a8a', label: 'Mining' },
}
const ATTENTION_RED = '#c1121f'
const HIST_OFFSETS = [0, 1, 2, 5, 10] as const
const AREA_STYLE: Record<string, { color: string; fill: string; label: string }> = {
  indigenous: { color: '#8a3b12', fill: '#b5651d', label: 'Indigenous land' },
  conservation: { color: '#1a7a52', fill: '#1a9e6e', label: 'Conservation unit' },
  quilombola: { color: '#7a4b9e', fill: '#9b6bbf', label: 'Quilombola territory' },
  settlement: { color: '#8a6a1d', fill: '#c9a24a', label: 'Federal settlement' },
}
const TARGET_COLOR: Record<string, string> = { city: '#0f2e25', locality: '#56645c', indigenous: '#8a3b12', conservation: '#1a7a52', quilombola: '#7a4b9e', road: '#7d5a2c' }
const esc = (v: unknown) => String(v ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string))
const tip = (title: unknown, sub: string, extra = '') => `<strong>${esc(title)}</strong><br><span style="color:#5c6d64">${sub}</span>${extra ? `<br><span style="color:#26352e">${extra}</span>` : ''}`

function ring(lon: number, lat: number, km: number): GeoJSON.Feature {
  const pts: [number, number][] = []
  for (let a = 0; a <= 360; a += 6) {
    const r = (a * Math.PI) / 180
    pts.push([lon + (km * Math.sin(r)) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (km * Math.cos(r)) / 110.574])
  }
  return { type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: { km } }
}
function offset(lon: number, lat: number, km: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180
  return [lon + (km * Math.sin(r)) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (km * Math.cos(r)) / 110.574]
}
function featBbox(g: GeoJSON.Geometry): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90
  const walk = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === 'number') { w = Math.min(w, c[0] as number); e = Math.max(e, c[0] as number); s = Math.min(s, c[1] as number); n = Math.max(n, c[1] as number) } else if (Array.isArray(c)) c.forEach(walk) }
  walk((g as { coordinates?: unknown }).coordinates)
  return [w, s, e, n]
}
const WINDOW_DAYS: Record<WindowLabel, number> = { '24h': 1, '48h': 2, '7d': 7 }

/** Setor a favor do vento (triagem geométrica, não previsão de propagação). */
function windWedge(lon: number, lat: number, towardDeg: number, km = 20, half = 30): GeoJSON.Feature {
  const pts: [number, number][] = [[lon, lat]]
  for (let a = towardDeg - half; a <= towardDeg + half; a += 5) {
    const r = (a * Math.PI) / 180
    pts.push([lon + (km * Math.sin(r)) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (km * Math.cos(r)) / 110.574])
  }
  pts.push([lon, lat])
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} }
}

function quantileBreaks(values: number[], n: number): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b)
  if (!v.length) return []
  const out: number[] = []
  for (let i = 1; i < n; i++) out.push(v[Math.min(v.length - 1, Math.floor((i / n) * v.length))])
  return [...new Set([1, ...out])].sort((a, b) => a - b)
}

export default function CurrentSituation() {
  const { locale } = useLocale()
  const { region, setRegion } = useRegion()
  const [win, setWin] = useSessionState<WindowLabel>('av:activity:window', '24h')
  const [daynight, setDaynight] = useSessionState<DayNight>('av:activity:daynight', 'all')
  const [sats, setSats] = useSessionState<string[]>('av:activity:sats', SATELLITE_KEYS)
  const [storedLayers, setLayerOn] = useSessionState<Partial<Record<LayerId, boolean>>>('av:situation:layers:v2', DEFAULT_LAYERS)
  const layerOn = { ...DEFAULT_LAYERS, ...storedLayers } as Record<LayerId, boolean>
  const [basemap, setBasemap] = useSessionState<Basemap>('av:map:basemap', 'analytical')
  const [imageryDate, setImageryDate] = useState(yesterdayUtc())
  const [fwiOpacity, setFwiOpacity] = useSessionState<number>('av:map:fwi-opacity', 0.35)
  const [recurrenceProduct, setRecurrenceProduct] = useSessionState<RecurrenceProduct>('av:map:recurrence', 'VIIRS_NOAA20_SP')
  const [distSat, setDistSat] = useSessionState<SatelliteKey>('av:map:distribution-sat', 'NOAA-20')
  const [tab, setTab] = useState<IntelTab>('attention')
  const [attFocus, setAttFocus] = useState<string | null>(null)
  const [tiFocus, setTiFocus] = useState<string | null>(null)
  const [alertView, setAlertView] = useSessionState<'hotspots' | 'indigenous' | 'all'>('av:alerts:view:v2', 'hotspots')
  const [histOffset, setHistOffset] = useSessionState<number>('av:activity:hist-offset', 0)
  const [hsFocus, setHsFocus] = useState<string | null>(null)
  const [expanded, setExpanded] = useSessionState<boolean>('av:map:expanded', false)
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState<DetectionProps | null>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const regions = useRegions()
  const regionInfo = regions.data?.regions.find((r) => r.id === region)
  const stateInfo = regions.data?.regions.find((r) => r.id === 'para')
  const isMunicipality = regionInfo?.level === 'municipio'
  const isState = regionInfo?.level === 'estado'
  const boundary = useBoundary(region)
  const muni = useMunicipalities('para')
  const products = productsFor(sats)
  // Modo histórico (estudo): mesmo período de N anos atrás, arquivo FIRMS do Pará.
  const histAllowed = region === 'para' || regionInfo?.parent === 'para'
  const hist = useMemo(() => {
    if (!histOffset || !histAllowed) return null
    const end = new Date(Date.now() - 86_400_000)
    end.setUTCFullYear(end.getUTCFullYear() - histOffset)
    const start = new Date(end.getTime() - (WINDOW_DAYS[win] - 1) * 86_400_000)
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), years: histOffset }
  }, [histOffset, histAllowed, win])
  const det = useDetections({ region, window: win, products, daynight })
  const histDet = useHistoryDetections(region, hist)
  const nrtData = det.isPlaceholderData ? undefined : det.data
  const histData = useMemo<DetectionsFC | undefined>(() => (hist && histDet.data ? { ...histDet.data, features: histDet.data.features.filter((f) => daynight === 'all' || f.properties.dn === daynight) } as unknown as DetectionsFC : undefined), [hist, histDet.data, daynight])
  const data = hist ? histData : nrtData
  const meta = hist ? undefined : nrtData?.metadata
  const shown = useMemo(() => prepareDetections(data, sats), [data, sats])
  const grid = useHistoryGrid(region, recurrenceProduct, Boolean(regionInfo) && regionInfo?.level !== 'pais' && regionInfo?.level !== 'bioma' && (layerOn.recurrence || selected != null))
  const ctx = useTerritoryContext(region)
  const impact = useImpact(region)
  const seats = useSeats('para', layerOn.seats || selected != null)
  useEffect(() => setSelected(null), [region, win, daynight, sats.join(',')])
  useEffect(() => { setAttFocus(null); setTiFocus(null) }, [region, win])
  const indigenous = useIndigenous(region, win, Boolean(regionInfo))
  const tiData = indigenous.data && indigenous.data.region?.id === region && indigenous.data.available ? indigenous.data : undefined
  const tiItems = useMemo(() => (tiData?.items ?? []).filter((i) => i.satellites.some((x) => sats.includes(x))), [tiData, sats])
  const tiFocused = tiItems.find((i) => i.id === tiFocus) ?? null
  const amazon = useBoundary('amazonia')
  const mapLayers = useMapLayers(region, Boolean(regionInfo) && (layerOn.protected || layerOn.roads || layerOn.settlements || layerOn.hotspots))
  const hotspots = useHotspots(region, win, hist, Boolean(regionInfo))
  const hsData = hotspots.data && hotspots.data.region?.id === region && hotspots.data.available && Boolean(hotspots.data.historical) === Boolean(hist) ? hotspots.data : undefined
  const hsItems = useMemo(() => (hsData?.items ?? []).filter((i) => Object.keys(i.proportion.by_satellite).some((x) => sats.includes(x))), [hsData, sats])
  const hsFocused = hsItems.find((i) => i.id === hsFocus) ?? null
  useEffect(() => setHsFocus(null), [region, win, histOffset])
  const frameHs = (i: HotspotItem) => {
    if (!map) return
    const [w, so, e, n] = i.bbox
    const pad = 0.12
    map.fitBounds([w - pad, so - pad, e + pad, n + pad], { padding: framePadding(map), maxZoom: 12.5, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500 })
  }
  const focusHs = (id: string | null) => { setHsFocus(id); const i = hsItems.find((x) => x.id === id); if (i) frameHs(i) }
  const frameTi = (i: IndigenousItem) => {
    if (!map) return
    const [w, so, e, n] = i.detections_bbox
    map.fitBounds([w - 0.02, so - 0.02, e + 0.02, n + 0.02], { padding: framePadding(map), maxZoom: 12, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500 })
  }
  const focusTi = (id: string | null) => { setTiFocus(id); const i = tiItems.find((x) => x.id === id); if (i) frameTi(i) }
  const attention = useAttention(region, win, regionInfo?.level === 'estado' || regionInfo?.level === 'municipio')
  const attData = attention.data && attention.data.region?.id === region ? attention.data : undefined
  const attSignals = useMemo(() => (attData?.signals ?? []).map((x) => filterSignal(x, sats)).filter((x): x is AttentionSignal => x != null), [attData, sats])
  const attMain = useMemo(() => attSignals.filter((x) => x.relation !== 'near'), [attSignals])
  const focusSignal = attSignals.find((x) => x.id === attFocus) ?? null
  const deter = useDeter(region, Boolean(isMunicipality) && layerOn.deter)
  const imagery = useImageryInfo(map, basemap === 'imagery')
  const frameSignal = (x: AttentionSignal) => {
    if (!map || !x.bbox) return
    const [w, so, e, n] = x.bbox
    const pad = 0.004
    map.fitBounds([w - pad, so - pad, e + pad, n + pad], { padding: framePadding(map), maxZoom: 13.5, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500 })
  }
  const focus = (id: string | null) => {
    setAttFocus(id)
    const x = attSignals.find((y) => y.id === id)
    if (x) frameSignal(x)
  }
  const fwiDate = yesterdayUtc()
  // Sonda um tile real do WMS do GWIS ao ligar a camada: só é marcada como disponível se a fonte responder.
  const [fwiProbe, setFwiProbe] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  useEffect(() => {
    if (!layerOn.fwi || fwiProbe !== 'idle') return
    setFwiProbe('loading')
    const img = new Image()
    const timer = window.setTimeout(() => setFwiProbe('unavailable'), 15000)
    img.onload = () => { window.clearTimeout(timer); setFwiProbe('ready') }
    img.onerror = () => { window.clearTimeout(timer); setFwiProbe('unavailable') }
    img.src = fwiTiles(fwiDate)[0].replace('{bbox-epsg-3857}', '-6261721,-626172,-5009377,0')
    return () => window.clearTimeout(timer)
  }, [layerOn.fwi]) // eslint-disable-line react-hooks/exhaustive-deps

  // Agregação só em escala estadual/regional; num município as detecções são sempre individuais.
  const layerMap: MapLayers = { points: layerOn.detections, aggregate: layerOn.clusters && !isMunicipality, boundary: true, municipalities: layerOn.municipalities }
  const toggleSat = (key: SatelliteKey, on: boolean) => setSats((cur) => (on ? [...new Set([...cur, key])] : cur.filter((s) => s !== key)))
  const pick = (p: DetectionProps | null) => { setSelected(p); if (p) setTab('observation') }
  const recent = useMemo(() => [...(shown?.features ?? [])].sort((a, b) => b.properties.t.localeCompare(a.properties.t)).slice(0, 6).map((f) => f.properties), [shown])
  const weatherPoint: [number, number] | undefined = regionInfo ? [regionInfo.centroid[0], regionInfo.centroid[1]] : undefined
  const detectionsBbox = useMemo<[number, number, number, number] | undefined>(() => {
    const f = shown?.features ?? []
    if (!f.length) return undefined
    let w = 180, s = 90, e = -180, n = -90
    for (const x of f) { const [lo, la] = x.geometry.coordinates; w = Math.min(w, lo); e = Math.max(e, lo); s = Math.min(s, la); n = Math.max(n, la) }
    const pad = 0.02
    return [w - pad, s - pad, e + pad, n + pad]
  }, [shown])

  // Distribuição por município: um satélite por vez (nunca somar sensores).
  const distCounts = useMemo(() => {
    if (!isState || !data) return null
    const pts = data.features.filter((f) => f.properties.s === distSat).map((f) => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
    return countByMunicipality(pts, muni.data)
  }, [isState, data, distSat, muni.data])
  const distBreaks = useMemo(() => (distCounts ? quantileBreaks(Object.values(distCounts), DISTRIBUTION_RAMP.length) : []), [distCounts])
  const munValues = useMemo(() => {
    if (!layerOn.distribution || !distCounts || !distBreaks.length) return null
    const stops: [number, string][] = [[0, 'rgba(0,0,0,0)'], ...distBreaks.map((b, i) => [b, DISTRIBUTION_RAMP[Math.min(i, DISTRIBUTION_RAMP.length - 1)]] as [number, string])]
    return { values: distCounts, stops }
  }, [layerOn.distribution, distCounts, distBreaks])
  const ranking = useMemo(() => {
    if (!distCounts || !muni.data) return []
    const names = new Map(muni.data.features.map((f) => [String(f.properties?.id), String(f.properties?.name)]))
    return Object.entries(distCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ id, name: names.get(id) ?? id, n }))
  }, [distCounts, muni.data])

  const overlays = useMemo<MapOverlay[]>(() => {
    const out: MapOverlay[] = [
      { id: 'fwi', kind: 'raster', tiles: fwiTiles(fwiDate), color: '#000', opacity: fwiOpacity, visible: layerOn.fwi && fwiProbe !== 'unavailable', attribution: 'FWI: Copernicus GWIS (ECMWF)' },
    ]
    if (grid.data) {
      const max = Math.max(1, grid.data.metadata.max_total)
      const stops = RECURRENCE_RAMP.flatMap((c, i) => [Math.round(((i / (RECURRENCE_RAMP.length - 1)) ** 2) * max), c])
      out.push({ id: 'recurrence', kind: 'polygon', data: grid.data, color: '#8a4520', fillOpacity: 0.55, visible: layerOn.recurrence,
        fillColor: ['interpolate', ['linear'], ['get', 'total'], ...stops] as never })
    }
    if (grid.data) out[out.length - 1].tooltip = (p) => tip(`${fmtInt(Number(p.total))} ${t('archived detections')}`, t('Historical recurrence cell'), p.years_active != null ? t('active in {0} years', { 0: String(p.years_active) }) : '')
    if (mapLayers.data) {
      const catColor = ['match', ['get', 'category'], ...Object.entries(AREA_STYLE).flatMap(([k, v]) => [k, v.color]), '#44554d'] as never
      const catFill = ['match', ['get', 'category'], ...Object.entries(AREA_STYLE).flatMap(([k, v]) => [k, v.fill]), '#44554d'] as never
      const areaTip = (p: Record<string, unknown>) => {
        const c = String(p.category)
        if (c === 'indigenous') return tip(p.name, `${t('Indigenous land')} · FUNAI`, [p.peoples, p.phase ? sourceCopy(String(p.phase)) : '', p.unit].filter(Boolean).map(esc).join(' · '))
        if (c === 'conservation') return tip(p.name, `${t('Conservation unit')} · ${esc(p.source)}`, [p.category_name, p.group, p.created ? `${t('created')} ${p.created}` : ''].filter(Boolean).map(esc).join(' · '))
        if (c === 'quilombola') return tip(p.name, `${t('Quilombola territory')} · INCRA`, p.families ? `${esc(p.families)} ${t('families')}` : '')
        return tip(p.name, `${t('Federal settlement')} · INCRA`, p.families ? `${esc(p.families)} ${t('families')}` : '')
      }
      const areas = mapLayers.data.areas.features
      out.push({ id: 'areas', kind: 'polygon', color: catColor, fillColor: catFill, fillOpacity: 0.1, lineWidth: 1.2, visible: layerOn.protected, tooltip: areaTip,
        label: { field: 'name', minzoom: 8.2, size: 11 },
        data: { type: 'FeatureCollection', features: areas.filter((f) => f.properties?.category !== 'settlement') } })
      out.push({ id: 'settlements', kind: 'polygon', color: '#8a6a1d', fillColor: '#c9a24a', fillOpacity: 0.05, dashed: true, visible: layerOn.settlements, tooltip: areaTip,
        data: { type: 'FeatureCollection', features: areas.filter((f) => f.properties?.category === 'settlement') } })
      out.push({ id: 'roads', kind: 'polygon', color: '#7d5a2c', fillOpacity: 0, lineWidth: 2, visible: layerOn.roads, data: mapLayers.data.roads,
        tooltip: (p) => tip(p.name, `${t('Federal road')} · DNIT`, [p.legend, p.surface === 'PAV' ? t('paved') : p.surface === 'N_PAV' ? t('unpaved') : p.surface, p.from && p.to ? `${p.from} → ${p.to}` : ''].filter(Boolean).map(esc).join(' · ')) })
    }
    if (weatherPoint) out.push({ id: 'power', kind: 'polygon', data: powerCell(weatherPoint[0], weatherPoint[1]), color: '#2a78d6', fillOpacity: 0.04, dashed: true, visible: layerOn.power })
    const imp = impact.data
    if (imp?.available && imp.localities?.items) {
      const rank = ['match', ['get', 'type'], 'Cidade', 0, 'Vila', 1, 2] as never
      out.push({ id: 'localities', kind: 'circle', color: '#ffffff', fillColor: '#56645c', radius: 2.6, minzoom: 9, visible: layerOn.localities,
        data: { type: 'FeatureCollection', features: imp.localities.items.filter((i) => i.type !== 'Cidade' && i.type !== 'Capital').map((i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [i.lon, i.lat] }, properties: { name: i.name, type: i.type ?? '', km: i.nearest_detection_km } })) },
        label: { field: 'name', minzoom: 9.6, size: ['match', ['get', 'type'], 'Vila', 12, 10.5] as never, sortKey: rank },
        tooltip: (p) => `<strong>${p.name}</strong><br><span style="color:#6b7a72">${p.type} · IBGE BC250 · ${t('nearest detection')} ${p.km ?? '—'} km</span>` })
    }
    const viewHs = Boolean(hist) || alertView === 'hotspots'
    if (hsData) {
      const lvColor = ['match', ['get', 'level'], ...Object.entries(LEVEL_STYLE).flatMap(([k, v]) => [k, v.color]), '#6b7a72'] as never
      const showHs = layerOn.hotspots && (viewHs || tab !== 'attention' || hsFocused != null)
      const hsTip = (p: Record<string, unknown>) => tip(t(LEVEL_STYLE[String(p.level) as HotspotItem['level']]?.label ?? ''), `${p.pixels} ${t('pixels')} · ${p.passes} ${t('overpasses')} · ~${p.area} km²`,
        [p.wind ? `${t('Wind (model)')} ${p.wind}` : '', p.target ? esc(p.target) : ''].filter(Boolean).join('<br>') + `<br><em style="color:#6b7a72">${t('Click for impact details')}</em>`)
      out.push({ id: 'hs-hulls', kind: 'polygon', color: lvColor, fillColor: lvColor, fillOpacity: 0.14, lineWidth: 1.2, visible: showHs,
        data: { type: 'FeatureCollection', features: hsItems.filter((i) => i.hull).map((i) => ({ type: 'Feature', geometry: i.hull!, properties: { level: i.level } })) } })
      const sectorOf = (deg: number) => ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8]
      // Anel por grau (não cobre o símbolo do satélite no centro)
      out.push({ id: 'hs-points', kind: 'circle', color: lvColor, radius: 12, strokeWidth: 3, visible: showHs, circleColor: 'rgba(255,255,255,0.01)' as never, tooltip: hsTip,
        onClick: (p) => { setTab('attention'); setAlertView('hotspots'); focusHs(String(p.id)) },
        data: { type: 'FeatureCollection', features: hsItems.map((i) => {
          const top = [...i.targets.inside, ...i.targets.downwind, ...i.targets.near][0]
          return { type: 'Feature', geometry: { type: 'Point', coordinates: i.centroid }, properties: { level: i.level, id: i.id, pixels: i.proportion.pixels, passes: i.proportion.overpasses,
            area: fmt1(i.proportion.area_km2), wind: i.wind ? `${fmt1(i.wind.speed_ms)} m/s → ${sectorOf(i.wind.toward_deg)}` : '',
            target: top ? `${top.name} (${top.inside ? t('inside') : `${top.km} km`}${top.downwind ? `, ${t('downwind')}` : ''})` : '' } }
        }) } })
      const f = hsFocused
      const tgs = f ? [...f.targets.inside, ...f.targets.downwind, ...f.targets.near.filter((x) => x.km <= 10 || x.type === 'city')] : []
      out.push({ id: 'hs-wedge', kind: 'polygon', color: '#d9480f', fillColor: '#d9480f', fillOpacity: 0.1, lineWidth: 1.4, dashed: true, visible: Boolean(f?.wind),
        tooltip: () => tip(t('Downwind sector'), t('20 km, ±30° around the model wind direction'), t('Geometric screening, not a spread forecast')),
        data: { type: 'FeatureCollection', features: f?.wind ? [windWedge(f.centroid[0], f.centroid[1], f.wind.toward_deg)] : [] } })
      // Anéis de distância (5/10/20 km), seta do vento e realce dos territórios e rodovias no caminho
      out.push({ id: 'hs-rings', kind: 'polygon', color: '#26352e', fillOpacity: 0, lineWidth: 0.8, dashed: true, visible: Boolean(f),
        data: { type: 'FeatureCollection', features: f ? [5, 10, 20].map((km) => ring(f.centroid[0], f.centroid[1], km)) : [] } })
      out.push({ id: 'hs-ring-labels', kind: 'circle', color: 'rgba(0,0,0,0)', fillColor: 'rgba(0,0,0,0)', radius: 0, strokeWidth: 0, visible: Boolean(f), label: { field: 'label', minzoom: 0, size: 10.5 },
        data: { type: 'FeatureCollection', features: f ? [5, 10, 20].map((km) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: offset(f.centroid[0], f.centroid[1], km, 180) }, properties: { label: `${km} km` } })) : [] } })
      const wEnd = f?.wind ? offset(f.centroid[0], f.centroid[1], 8, f.wind.toward_deg) : null
      out.push({ id: 'hs-wind', kind: 'polygon', color: '#a63a08', fillOpacity: 0, lineWidth: 3, visible: Boolean(wEnd),
        data: { type: 'FeatureCollection', features: f?.wind && wEnd ? [
          { type: 'Feature', geometry: { type: 'LineString', coordinates: [f.centroid, wEnd] }, properties: {} },
          { type: 'Feature', geometry: { type: 'LineString', coordinates: [offset(wEnd[0], wEnd[1], 1.6, f.wind.toward_deg + 150), wEnd, offset(wEnd[0], wEnd[1], 1.6, f.wind.toward_deg - 150)] }, properties: {} },
        ] : [] } })
      const impactNames = new Set(tgs.filter((x) => ['indigenous', 'conservation', 'quilombola'].includes(x.type)).map((x) => x.name))
      const roadNames = new Set(tgs.filter((x) => x.type === 'road').map((x) => x.name))
      const near = f ? [f.centroid[0] - 0.3, f.centroid[1] - 0.3, f.centroid[0] + 0.3, f.centroid[1] + 0.3] : null
      out.push({ id: 'hs-impact-areas', kind: 'polygon', color: '#c1121f', fillColor: '#c1121f', fillOpacity: 0.16, lineWidth: 2.6, visible: impactNames.size > 0,
        tooltip: (p) => tip(p.name, t('In the way of this hotspot'), t(AREA_STYLE[String(p.category)]?.label ?? '')),
        data: { type: 'FeatureCollection', features: (mapLayers.data?.areas.features ?? []).filter((x) => impactNames.has(String(x.properties?.name))) } })
      out.push({ id: 'hs-impact-roads', kind: 'polygon', color: '#d9480f', fillOpacity: 0, lineWidth: 5, visible: roadNames.size > 0,
        tooltip: (p) => tip(p.name, t('Federal road near this hotspot'), esc(p.legend)),
        data: { type: 'FeatureCollection', features: near ? (mapLayers.data?.roads.features ?? []).filter((x) => { if (!roadNames.has(String(x.properties?.name))) return false; const b = featBbox(x.geometry); return b[0] <= near[2] && b[2] >= near[0] && b[1] <= near[3] && b[3] >= near[1] }) : [] } })
      out.push({ id: 'hs-lines', kind: 'polygon', color: '#26352e', fillOpacity: 0, lineWidth: 1, dashed: true, visible: tgs.length > 0,
        data: { type: 'FeatureCollection', features: tgs.map((x) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [f!.centroid, [x.lon, x.lat]] }, properties: {} })) } })
      out.push({ id: 'hs-targets', kind: 'circle', color: '#ffffff', radius: 6, strokeWidth: 2, visible: tgs.length > 0,
        circleColor: ['match', ['get', 'type'], ...Object.entries(TARGET_COLOR).flatMap(([k, v]) => [k, v]), '#26352e'] as never,
        label: { field: 'label', minzoom: 0, size: 11.5 },
        data: { type: 'FeatureCollection', features: tgs.map((x) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] }, properties: { type: x.type, label: `${x.name} · ${x.inside ? t('inside') : `${x.km} km`}${x.downwind ? ` · ${t('downwind')}` : ''}` } })) } })
    }
    if (amazon.data) out.push({ id: 'amazon', kind: 'polygon', data: amazon.data, color: '#0f5132', fillColor: 'rgba(0,0,0,0)', fillOpacity: 0, lineWidth: 1.6, dashed: true, visible: layerOn.amazon })
    const viewTi = !hist && alertView === 'indigenous'
    const showTi = layerOn.attention && ((tab === 'attention' && viewTi) || tiFocused != null)
    if (tiData) {
      const alertColor = ['match', ['get', 'alert'], ...Object.entries(TI_ALERT_STYLE).flatMap(([k, v]) => [k, v.color]), '#b5651d'] as never
      out.push({ id: 'ti-alerts', kind: 'polygon', color: alertColor, fillColor: alertColor, fillOpacity: 0.1, lineWidth: 2, visible: showTi,
        tooltip: (p) => tip(p.name, t(TI_ALERT_STYLE[String(p.alert) as IndigenousItem['alert']]?.label ?? '')),
        label: { field: 'name', minzoom: regionInfo?.level === 'bioma' ? 4.5 : 6, size: 11.5 },
        data: { type: 'FeatureCollection', features: tiItems.filter((i) => i.geometry).map((i) => ({ type: 'Feature', geometry: i.geometry!, properties: { id: i.id, name: i.name, alert: i.alert } })) } })
      const tiRefs = tiFocused ? [...tiFocused.inside.detections, ...tiFocused.surroundings.detections].filter((d) => sats.includes(d.s)) : []
      out.push({ id: 'ti-dets', kind: 'circle', color: ATTENTION_RED, fillColor: 'rgba(193,18,31,0.08)', radius: 9, strokeWidth: 1.6, visible: tiRefs.length > 0,
        data: { type: 'FeatureCollection', features: tiRefs.map((d) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [d.lon, d.lat] }, properties: {} })) } })
    }
    const showAtt = !hist && layerOn.attention && ((tab === 'attention' && alertView === 'all') || focusSignal != null)
    if (attData) {
      // Escala estadual: só territórios protegidos (sem foco) e halos apenas do sinal selecionado, para não saturar o mapa.
      const ids = new Set(attMain.filter((x) => isMunicipality || ['indigenous', 'conservation', 'quilombola'].includes(x.category)).map((x) => x.target.id))
      const catColor = ['match', ['get', 'category'], ...Object.entries(ATTENTION_CATEGORY).flatMap(([k, v]) => [k, v.color]), '#44554d'] as never
      out.push({ id: 'att-targets', kind: 'polygon', color: catColor, fillColor: catColor, fillOpacity: 0.07, lineWidth: 1.8, visible: showAtt,
        data: { type: 'FeatureCollection', features: attData.targets.features.filter((f) => ids.has(String(f.properties?.id))) } })
      const focusTarget = focusSignal ? attData.targets.features.filter((f) => f.properties?.id === focusSignal.target.id) : []
      out.push({ id: 'att-focus-target', kind: 'polygon', color: ATTENTION_RED, fillColor: ATTENTION_RED, fillOpacity: 0.06, lineWidth: 3, visible: focusTarget.length > 0,
        data: { type: 'FeatureCollection', features: focusTarget } })
      const refs = new Map<string, { lon: number; lat: number; s: string }>()
      for (const x of focusSignal ? [focusSignal] : isMunicipality ? attMain : []) for (const d of x.detections) refs.set(`${d.p}|${d.id}`, d)
      out.push({ id: 'att-dets', kind: 'circle', color: ATTENTION_RED, fillColor: 'rgba(193,18,31,0.08)', radius: 9, strokeWidth: 1.6, visible: showAtt,
        data: { type: 'FeatureCollection', features: [...refs.values()].map((d) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [d.lon, d.lat] }, properties: { s: d.s } })) } })
      const pt = focusSignal?.target.lon != null ? [{ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [focusSignal.target.lon, focusSignal.target.lat!] }, properties: { name: focusSignal.target.name } }] : []
      out.push({ id: 'att-focus-point', kind: 'circle', color: ATTENTION_RED, fillColor: '#ffffff', radius: 5.5, strokeWidth: 2.5, visible: pt.length > 0,
        data: { type: 'FeatureCollection', features: pt }, label: { field: 'name', minzoom: 0, size: 13 } })
    }
    if (deter.data?.features.length) {
      const grp = ['match', ['get', 'group'], ...Object.entries(DETER_STYLE).flatMap(([k, v]) => [k, v.color]), '#555555'] as never
      out.push({ id: 'deter', kind: 'polygon', color: grp, fillColor: grp, fillOpacity: 0.2, lineWidth: 0.8, visible: layerOn.deter && Boolean(isMunicipality), data: deter.data,
        tooltip: (p) => tip(t(DETER_STYLE[String(p.group)]?.label ?? String(p.label)), `INPE DETER · ${t('image')} ${fmtDate(String(p.view_date))}`, `${fmt1(Number(p.area_km2))} km² · ${esc(p.satellite)}`) })
    }
    if (imp?.available && imp.health?.items) {
      out.push({ id: 'health', kind: 'symbol', text: '+', color: '#7b1d4e', visible: layerOn.health,
        data: { type: 'FeatureCollection', features: imp.health.items.map((i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [i.lon, i.lat] }, properties: { name: i.name, type: i.type ?? '', km: i.nearest_detection_km } })) },
        tooltip: (p) => `<strong>${p.name}</strong><br><span style="color:#6b7a72">${p.type} · CNES · ${t('nearest detection')} ${p.km ?? '—'} km</span>` })
    }
    return out
  }, [grid.data, ctx.data, impact.data, mapLayers.data, layerOn.roads, layerOn.hotspots, attData, attMain, focusSignal, tab, hsData, hsItems, hsFocused, hist, tiData, tiItems, tiFocused, alertView, amazon.data, layerOn.amazon, regionInfo?.level, deter.data, layerOn.attention, layerOn.deter, isMunicipality, layerOn.fwi, layerOn.recurrence, layerOn.settlements, layerOn.protected, layerOn.power, layerOn.localities, layerOn.health, weatherPoint?.[0], weatherPoint?.[1], fwiDate, fwiOpacity, fwiProbe]) // eslint-disable-line react-hooks/exhaustive-deps

  const layerStatus = {
    detections: { state: det.error ? 'unavailable' : det.isFetching && !data ? 'loading' : (shown?.features.length ? 'ready' : 'empty'), date: meta ? fmtUtc(meta.platform_data_fetched_at) : undefined },
    clusters: { state: 'ready' },
    distribution: { state: !isState ? 'unavailable' : muni.isLoading || !data ? 'loading' : distBreaks.length ? 'ready' : 'empty', note: !isState ? t('Available at state scale: select Pará.') : undefined },
    recurrence: { state: grid.error ? 'unavailable' : grid.isLoading ? 'loading' : !grid.data && !layerOn.recurrence ? 'ready' : grid.data?.features.length ? 'ready' : 'empty', date: grid.data ? `${grid.data.metadata.years[0]}–${grid.data.metadata.years[1]}` : undefined,
      note: grid.error ? t('Archive grid unavailable for this territory.') : undefined },
    fwi: { state: fwiProbe === 'unavailable' ? 'unavailable' : fwiProbe === 'loading' ? 'loading' : 'ready', date: fwiDate, note: fwiProbe === 'unavailable' ? t('Copernicus GWIS did not respond; the layer is hidden.') : undefined },
    power: { state: weatherPoint ? 'ready' : 'loading' },
    seats: { state: seats.error ? 'unavailable' : seats.isLoading ? 'loading' : seats.data?.features.length ? 'ready' : layerOn.seats ? 'empty' : 'ready', date: seats.data ? fmtDate(seats.data.metadata.fetched_at) : undefined },
    protected: { state: mapLayers.error ? 'unavailable' : mapLayers.isLoading ? 'loading' : mapLayers.data?.areas.features.some((f) => f.properties?.category !== 'settlement') ? 'ready' : 'empty',
      count: mapLayers.data?.areas.features.filter((f) => f.properties?.category !== 'settlement').length || undefined },
    settlements: { state: !isMunicipality ? 'unavailable' : mapLayers.error ? 'unavailable' : mapLayers.isLoading ? 'loading' : mapLayers.data?.areas.features.some((f) => f.properties?.category === 'settlement') ? 'ready' : 'empty',
      note: !isMunicipality ? t('Available when a municipality is selected.') : undefined },
    roads: { state: mapLayers.error ? 'unavailable' : mapLayers.isLoading ? 'loading' : mapLayers.data?.roads.features.length ? 'ready' : 'empty', count: mapLayers.data?.roads.features.length || undefined },
    hotspots: { state: hotspots.error ? 'unavailable' : hotspots.isLoading ? 'loading' : hsItems.length ? 'ready' : 'empty', count: hsItems.length || undefined },
    localities: { state: !isMunicipality ? 'unavailable' : impact.error ? 'unavailable' : impact.isLoading ? 'loading' : impact.data?.localities?.available ? 'ready' : 'unavailable', note: !isMunicipality ? t('Available when a municipality is selected.') : undefined },
    amazon: { state: amazon.error ? 'unavailable' : amazon.isLoading ? 'loading' : 'ready' },
    attention: { state: attention.error ? 'unavailable' : attention.isLoading ? 'loading' : attMain.length ? 'ready' : 'empty', count: attMain.length || undefined,
      note: t('Highlights show while the Alerts tab is open or a signal is selected.') },
    deter: { state: !isMunicipality ? 'unavailable' : deter.error ? 'unavailable' : deter.isLoading ? 'loading' : !layerOn.deter ? 'ready' : deter.data?.features.length ? 'ready' : 'empty',
      count: deter.data?.features.length || undefined, date: deter.data?.metadata?.fetched_at ? fmtDate(deter.data.metadata.fetched_at) : undefined,
      note: !isMunicipality ? t('Available when a municipality is selected.') : deter.error ? t('INPE TerraBrasilis did not respond.') : undefined },
    footprints: { state: !isMunicipality ? 'unavailable' : 'ready', note: !isMunicipality ? t('Available when a municipality is selected (from zoom 10).') : undefined },
    health: { state: !isMunicipality ? 'unavailable' : impact.error ? 'unavailable' : impact.isLoading ? 'loading' : impact.data?.health?.available ? 'ready' : 'unavailable', note: !isMunicipality ? t('Available when a municipality is selected.') : undefined },
  } as const

  const counts = Object.fromEntries(SATELLITE_KEYS.map((k) => {
    if (hist) return [k, histData ? histData.features.filter((f) => f.properties.s === k).length : null]
    const s = satelliteStyle(k)!
    const p = meta?.products.find((x) => x.product_id === s.product)
    return [k, p && p.available ? (p.by_satellite?.[k] ?? 0) : null]
  })) as Partial<Record<SatelliteKey, number | null>>
  const sq = (fill: string, border: string, dashed = false) => <i className={`sq ${dashed ? 'dashed' : ''}`} style={{ background: fill, borderColor: border }} />
  const entries: LegendEntry[] = [
    ...(layerOn.distribution && munValues ? [{ key: 'dist', swatch: <span className="ramp-mini">{DISTRIBUTION_RAMP.map((c) => <i key={c} style={{ background: c }} />)}</span>, label: t('Detections per municipality ({0})', { 0: satelliteStyle(distSat)?.short ?? distSat }), note: distBreaks.map((b, i) => `${fmtInt(b)}${i === distBreaks.length - 1 ? '+' : ''}`).join(' · ') }] : []),
    ...(layerOn.recurrence && grid.data ? [{ key: 'rec', swatch: <span className="ramp-mini">{RECURRENCE_RAMP.map((c) => <i key={c} style={{ background: c }} />)}</span>, label: t('Recurrence, {0}', { 0: RECURRENCE_SERIES[recurrenceProduct] }), note: `0–${fmtInt(grid.data.metadata.max_total)} ${t('detections per cell')}` }] : []),
    ...(layerOn.fwi && fwiProbe !== 'unavailable' ? [{ key: 'fwi', swatch: <span className="ramp-mini fwi" />, label: t('FWI danger class, {0}', { 0: fwiDate }), note: t('Weather-driven danger, not fire extent') }] : []),
    ...(layerOn.protected && mapLayers.data ? Object.entries(AREA_STYLE).filter(([k]) => k !== 'settlement' && mapLayers.data!.areas.features.some((f) => f.properties?.category === k)).map(([k, v]) => ({ key: k, swatch: sq(`${v.fill}40`, v.color), label: t(v.label) })) : []),
    ...(layerOn.roads && mapLayers.data?.roads.features.length ? [{ key: 'roads', swatch: <i className="sq" style={{ height: 3, background: '#7d5a2c', borderColor: '#7d5a2c' }} />, label: t('Federal road (DNIT)') }] : []),
    ...(layerOn.hotspots && hsItems.length ? Object.entries(LEVEL_STYLE).filter(([k]) => k !== 'sem_alvo' && hsItems.some((i) => i.level === k)).map(([k, v]) => ({ key: `hs-${k}`, swatch: <i className="dot" style={{ background: 'transparent', border: `2.5px solid ${v.color}`, width: 12, height: 12 }} />, label: t(v.label), note: t('hotspot') })) : []),
    ...(layerOn.settlements ? [{ key: 'set', swatch: sq('transparent', '#8a6a1d', true), label: t('Federal settlements') }] : []),
    ...(layerOn.seats ? [{ key: 'seat', swatch: <b className="star">★</b>, label: t('Municipal seat (IBGE)') }] : []),
    ...(layerOn.localities && isMunicipality ? [{ key: 'loc', swatch: <i className="dot loc" />, label: t('Locality (IBGE)'), note: t('from zoom 9') }] : []),
    ...(layerOn.health && isMunicipality ? [{ key: 'hea', swatch: <b className="plus">+</b>, label: t('Health facility (CNES)') }] : []),
    ...(layerOn.attention && (tab === 'attention' || focusSignal) && attMain.length ? [{ key: 'att', swatch: <i className="dot att-halo" />, label: t('Detection meeting an alert criterion'), note: t('platform cross-check, not an official alert') }] : []),
    ...(layerOn.deter && isMunicipality && deter.data?.features.length ? Object.entries(DETER_STYLE).filter(([k]) => deter.data!.features.some((f) => f.properties?.group === k)).map(([k, v]) => ({ key: `deter-${k}`, swatch: sq(`${v.color}55`, v.color), label: t(v.label), note: 'INPE DETER, 12 m' })) : []),
    ...(layerOn.attention && tiData && tiItems.some((i) => i.geometry) && ((tab === 'attention' && (alertView === 'indigenous' || regionInfo?.level === 'bioma' || regionInfo?.level === 'pais')) || tiFocused) ? Object.entries(TI_ALERT_STYLE).filter(([k]) => tiItems.some((i) => i.alert === k && i.geometry)).map(([k, v]) => ({ key: `ti-${k}`, swatch: sq(`${v.color}22`, v.color), label: t(v.label), note: t('Indigenous land (FUNAI/OTCA)') })) : []),
    ...(layerOn.amazon ? [{ key: 'amz', swatch: sq('transparent', '#0f5132', true), label: t('Amazon boundary (9 countries)') }] : []),
    ...(layerOn.footprints && isMunicipality ? [{ key: 'fp', swatch: sq('transparent', '#6b7a72', true), label: t('Pixel area (scan × track)'), note: t('from zoom 10') }] : []),
    ...(layerOn.power ? [{ key: 'pow', swatch: sq('transparent', '#2a78d6', true), label: t('NASA POWER cell') }] : []),
  ]

  return (
    <div className="situation">
      <div className={`situation-grid ${expanded ? 'expanded' : ''}`}>
        <section className="situation-map" aria-label={t('Situation map')}>
          <DetectionMap data={shown} boundary={boundary.data} bbox={regionInfo?.bbox} layers={layerMap} basemap={basemap} imageryDate={imageryDate}
            selectedId={selected?.id ?? null} onSelect={pick} municipalities={muni.data} selectedRegionId={region}
            onSelectRegion={(id) => { setSelected(null); setRegion(id) }} overlays={overlays} seats={layerOn.seats ? seats.data : undefined}
            munValues={munValues} footprints={Boolean(isMunicipality) && layerOn.footprints} onMap={setMap} className="situation-canvas" />

          <div className="map-hud" role="toolbar" aria-label={t('Map filters')}>
            <div className="hud-title">
              <nav className="crumbs" aria-label={t('Geographic level')}>
                {regionInfo && regionInfo.level !== 'bioma' ? <><button type="button" onClick={() => { setSelected(null); setRegion('amazonia') }}>{t('Amazon')}</button><ChevronRight size={11} aria-hidden="true" /></> : null}
                {isMunicipality ? <><button type="button" onClick={() => { setSelected(null); setRegion('para') }}>Pará</button><ChevronRight size={11} aria-hidden="true" /></> : null}
                <strong>{regionInfo?.name ?? '…'}</strong>
              </nav>
              <span>{hist ? `${fmtDate(hist.start)} – ${fmtDate(hist.end)}` : t(WINDOW_LABEL[win])}{shown ? ` · ${fmtInt(shown.features.length)} ${t('detections shown')}` : ''}</span>
            </div>
            {(hsData || tiData || attData) && (
              <button type="button" className={`hud-attention ${(tiData?.summary.lands_with_fire_inside || attMain.length) ? '' : 'none'}`} onClick={() => setTab('attention')} title={t('Open alerts')}>
                <AlertTriangle size={14} aria-hidden="true" />
                {hsData && <><span className="num">{fmtInt(hsData.summary.by_level.alto)}</span><span>{t('high-alert hotspots')}</span></>}
                {tiData && !hist && <><span className="hud-sep" aria-hidden="true" /><span className="num">{fmtInt(tiItems.filter((i) => i.alert !== 'surroundings').length)}</span><span>{t('Indigenous lands with fire')}</span></>}
                {attData && !hist && <><span className="hud-sep" aria-hidden="true" /><span className="num">{fmtInt(attMain.length)}</span><span>{t(attMain.length === 1 ? 'alert signal' : 'alert signals')}</span></>}
              </button>
            )}
            <Segmented label={t('Observation window')} size="sm" value={win} onChange={setWin} options={[{ value: '24h', label: '24 h' }, { value: '48h', label: '48 h' }, { value: '7d', label: '7 d' }]} />
            <label className={`hud-hist ${hist ? 'on' : ''}`} title={histAllowed ? t('Same period in past years (FIRMS archive, Pará)') : t('Archive imported for Pará and its municipalities')}>
              <span>{t('Period')}</span>
              <select value={histAllowed ? histOffset : 0} disabled={!histAllowed} onChange={(e) => setHistOffset(Number(e.target.value))} aria-label={t('Compare with the same period in past years')}>
                {HIST_OFFSETS.map((y) => <option key={y} value={y}>{y === 0 ? t('Now') : t('{0} year(s) ago', { 0: y })}</option>)}
              </select>
            </label>
            <Segmented label={t('Day or night')} size="sm" value={daynight} onChange={setDaynight} options={[{ value: 'all', label: 'All' }, { value: 'D', label: 'Day' }, { value: 'N', label: 'Night' }]} />
            <a className="hud-export" href={products.length ? apiUrl('/detections/export.csv', { region, window: win, products: products.join(','), daynight }) : undefined} aria-label={t('Export CSV')}><Download size={14} /><span>CSV</span></a>
            <div className="map-chips" role="group" aria-label={t('Quick layers')}>
            {([
              ['hotspots', 'Hotspots', '#9b0e18', true],
              ['protected', 'Indigenous lands & protected areas', '#8a3b12', true],
              ['settlements', 'Settlements', '#8a6a1d', Boolean(isMunicipality)],
              ['roads', 'Federal roads', '#7d5a2c', true],
              ['seats', 'Cities', '#0f2e25', true],
              ['localities', 'Localities', '#56645c', Boolean(isMunicipality)],
              ['deter', 'DETER', '#3d3d3d', Boolean(isMunicipality)],
              ['fwi', 'Fire danger (FWI)', '#e00000', true],
            ] as [LayerId, string, string, boolean][]).map(([id, label, color, ok]) => (
              <button key={id} type="button" aria-pressed={layerOn[id] && ok} disabled={!ok} data-chip={id} title={ok ? undefined : t('Available when a municipality is selected.')}
                onClick={() => setLayerOn((cur) => ({ ...DEFAULT_LAYERS, ...cur, [id]: !layerOn[id] }))}>
                <i style={{ background: color }} aria-hidden="true" />{t(label)}
              </button>
            ))}
          </div>

          </div>


          <MapToolbar map={map} regionBbox={regionInfo?.bbox} stateBbox={stateInfo?.bbox} detectionsBbox={detectionsBbox} basemap={basemap} setBasemap={setBasemap}
            imageryDate={imageryDate} setImageryDate={setImageryDate} municipalities={muni.data} expanded={expanded} setExpanded={setExpanded} />

          {hist && (
            <p className="imagery-badge hist-badge" role="status">{t('Study mode: {0} – {1} ({2} year(s) ago), FIRMS archive. MODIS since 2001; VIIRS NOAA-20 since 2021. Counts per satellite are comparable with today only within the same instrument.', { 0: fmtDate(hist.start), 1: fmtDate(hist.end), 2: hist.years })}
              {histDet.isLoading ? ` ${t('Loading archive…')}` : histDet.data ? ` ${fmtInt(histDet.data.metadata.count)} ${t('detections')}.` : ''}</p>
          )}
          {basemap === 'imagery' && (
            <p className="imagery-badge" role="status" data-imagery-state={imagery.state}>
              {imagery.state === 'ready' ? t('High-resolution imagery: {0}, {1} m, captured {2} (Esri World Imagery). Not current imagery: detections are from the selected window.', { 0: `${imagery.provider ?? ''}${imagery.sensor ? ` ${imagery.sensor}` : ''}`, 1: (imagery.resolution_m ?? 0).toLocaleString(locale === 'pt-BR' ? 'pt-BR' : 'en-US'), 2: fmtDate(imagery.date) })
                : imagery.state === 'loading' ? t('Looking up the capture date of this image…')
                : imagery.state === 'error' ? t('Capture date unavailable for this view (Esri metadata did not respond).')
                : t('Zoom in (≥ 11) to see houses and roads; at this scale the mosaic is 15 m TerraColor without a single date.')}
            </p>
          )}
          {basemap === 'satellite' && (
            <p className="imagery-badge" role="status">{t('Satellite basemap: NASA GIBS, VIIRS NOAA-20 true colour of {0} (UTC). Daily swath: clouds and orbit gaps are real; not a live image.', { 0: fmtDate(imageryDate) })}</p>
          )}

          <div className="map-clock" aria-live="polite">
            <span><em>{t('Latest observation')}</em><strong className="num">{fmtUtc(meta?.latest_observation_utc)}</strong>{meta?.latest_observation_utc && <small>{fmtAgo(meta.latest_observation_utc)}</small>}</span>
            <span><em>{t('Synced from NASA FIRMS')}</em><strong className="num">{fmtUtc(meta?.platform_data_fetched_at)}</strong><small>{t('source latency up to ~3 h')}</small></span>
          </div>

          {det.error && !data && <div className="map-error"><ErrorState error={det.error} compact onRetry={() => det.refetch()} /></div>}
          {det.isFetching && <div className="map-busy"><Loading label={t('Updating satellite observations…')} /></div>}
          {sats.length === 0 && <div className="map-error"><p className="map-empty-note">{t('All satellites are hidden. Turn one on in the legend.')}</p></div>}

          <MapLegend sats={sats} onToggleSat={toggleSat} counts={counts} loading={det.isFetching && !data} entries={entries} detectionsOn={layerOn.detections} />
        </section>

        <IntelPanel tab={tab} setTab={setTab} region={region} regionName={regionInfo?.name ?? region} meta={meta} metaError={det.error} windowLabel={t(WINDOW_LABEL[win])}
          selected={selected} recent={recent} onPick={pick} onClose={() => { setSelected(null); setTab('territory') }}
          layers={layerOn} onToggleLayer={(id, v) => setLayerOn((cur) => ({ ...DEFAULT_LAYERS, ...cur, [id]: v }))}
          layerStatus={layerStatus as never} grid={grid.data} gridProduct={recurrenceProduct}
          municipalities={muni.data} seats={seats.data} isState={isState} ranking={ranking} rankingSat={distSat}
          onSelectRegion={(id) => { setSelected(null); setRegion(id) }}
          controls={{
            fwiOpacity, setFwiOpacity,
            recurrenceProduct, setRecurrenceProduct: (p: string) => setRecurrenceProduct(p as RecurrenceProduct), recurrenceOptions: RECURRENCE_SERIES,
            distSat, setDistSat: (s: string) => setDistSat(s as SatelliteKey),
            basemap, setBasemap,
            applyPreset: (p) => setLayerOn((cur) => ({ ...DEFAULT_LAYERS, ...cur, ...p })),
          }}
          attention={attention} attentionCount={attData ? attMain.length : undefined} tabBadge={hsData ? hsData.summary.by_level.alto : tiData ? tiItems.filter((i) => i.alert !== 'surroundings').length : attData ? attMain.length : undefined} sats={sats} focusId={attFocus} onFocus={focus} onFrame={frameSignal}
          regionLevel={regionInfo?.level} hotspots={hotspots} hsFocus={hsFocus} onHsFocus={focusHs} onHsFrame={frameHs} historical={Boolean(hist)}
          indigenous={indigenous} alertView={alertView} setAlertView={setAlertView} tiFocus={tiFocus} onTiFocus={focusTi} onTiFrame={frameTi}
          onZoomTo={(lon, lat) => map?.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 11) })} />
      </div>

      <div className="situation-below">
        <div className="scientific-caption"><Info size={16} /><p>{t('A detection is a thermal-anomaly pixel, not an individual fire or a burned-area measurement. No detection does not establish that no fire occurred.')} <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">{t('Source: NASA FIRMS')}</a></p></div>
        {shown && sats.length > 0 && <ObservationTable data={shown} onSelect={(p) => { pick(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />}
        <details className="timeline-section"><summary>{t('Satellite observation timeline')} <ChevronDown size={16} /></summary><div>{meta && products.length ? <OverpassRibbon data={shown} products={products} /> : <p>{t('No observations to display.')}</p>}</div></details>
      </div>
    </div>
  )
}
