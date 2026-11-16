// Utilidades geográficas leves (cliente): distância geodésica e ponto-em-polígono.
const R = 6371.0088

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function inRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function pointInGeometry(lon: number, lat: number, g: GeoJSON.Geometry | null | undefined): boolean {
  if (!g) return false
  if (g.type === 'Polygon') return inRing(lon, lat, g.coordinates[0]) && !g.coordinates.slice(1).some((h) => inRing(lon, lat, h))
  if (g.type === 'MultiPolygon') return g.coordinates.some((p) => inRing(lon, lat, p[0]) && !p.slice(1).some((h) => inRing(lon, lat, h)))
  if (g.type === 'GeometryCollection') return g.geometries.some((x) => pointInGeometry(lon, lat, x))
  return false
}

/** Célula da grade nativa do NASA POWER (GEOS-IT/MERRA-2: 0,5° lat × 0,625° lon) que contém o ponto. */
export function powerCell(lon: number, lat: number): GeoJSON.FeatureCollection {
  const la = Math.round(lat / 0.5) * 0.5
  const lo = Math.round(lon / 0.625) * 0.625
  const ring = [[lo - 0.3125, la - 0.25], [lo + 0.3125, la - 0.25], [lo + 0.3125, la + 0.25], [lo - 0.3125, la + 0.25], [lo - 0.3125, la - 0.25]]
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { lat: la, lon: lo } }] }
}

export function yesterdayUtc(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
}

export const FWI_LEGEND_URL = 'https://maps.effis.emergency.copernicus.eu/gwis?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetLegendGraphic&LAYER=ecmwf.fwi&FORMAT=image/png&STYLE=default'
export function fwiTiles(date: string): string[] {
  return [`https://maps.effis.emergency.copernicus.eu/gwis?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=ecmwf.fwi&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&TIME=${date}`]
}

/** Rumo inicial (graus) do ponto 1 ao ponto 2 e o setor de 8 pontos correspondente. */
export function bearing(lon1: number, lat1: number, lon2: number, lat2: number): { deg: number; sector: string } {
  const toRad = (d: number) => (d * Math.PI) / 180
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1))
  const deg = (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
  return { deg, sector: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8] }
}

/**
 * Distância (km) do ponto à borda de um polígono: projeção azimutal equidistante local
 * (adequada para dezenas de km) e menor distância aos segmentos. 0 quando o ponto está dentro.
 */
export function distanceToGeometryKm(lon: number, lat: number, g: GeoJSON.Geometry | null | undefined): number | null {
  if (!g) return null
  if (pointInGeometry(lon, lat, g)) return 0
  const rings: number[][][] = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []
  if (!rings.length) return null
  const k = Math.cos((lat * Math.PI) / 180)
  const proj = (p: number[]) => [((p[0] - lon) * Math.PI / 180) * R * k, ((p[1] - lat) * Math.PI / 180) * R]
  let best = Infinity
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = proj(ring[i - 1])
      const [bx, by] = proj(ring[i])
      const dx = bx - ax, dy = by - ay
      const len = dx * dx + dy * dy
      const tt = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0
      best = Math.min(best, Math.hypot(ax + tt * dx, ay + tt * dy))
    }
  }
  return Number.isFinite(best) ? best : null
}

/** Horário local do Pará (America/Belem, UTC−3, sem horário de verão). */
export function belemTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'pt-BR' ? 'pt-BR' : 'en-GB', { timeZone: 'America/Belem', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

/** bbox [w, s, e, n] de uma geometria (para pré-filtro). */
export function geometryBbox(g: GeoJSON.Geometry): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') { const [x, y] = c as number[]; w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y) }
    else if (Array.isArray(c)) c.forEach(walk)
  }
  walk((g as { coordinates?: unknown }).coordinates)
  return [w, s, e, n]
}

/** Município (feição) que contém o ponto, com pré-filtro por bbox. */
export function municipalityAt(lon: number, lat: number, munis: GeoJSON.FeatureCollection | undefined, boxes?: Map<GeoJSON.Feature, [number, number, number, number]>): GeoJSON.Feature | undefined {
  return munis?.features.find((f) => {
    const b = boxes?.get(f) ?? geometryBbox(f.geometry)
    return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && pointInGeometry(lon, lat, f.geometry)
  })
}

/** Contagem de pontos por município (uma única fonte/satélite por vez — nunca somar sensores). */
export function countByMunicipality(points: { lon: number; lat: number }[], munis: GeoJSON.FeatureCollection | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  if (!munis) return out
  const boxes = new Map(munis.features.map((f) => [f, geometryBbox(f.geometry)] as const))
  for (const p of points) {
    const f = municipalityAt(p.lon, p.lat, munis, boxes)
    const id = f?.properties?.id as string | undefined
    if (id) out[id] = (out[id] ?? 0) + 1
  }
  return out
}

/** Interpreta a confiança conforme o produto (VIIRS: classes; MODIS: 0–100 → classes do guia MODIS C6.1). */
export function interpretConfidence(sensor: string, cls: string | null, pct: number | null): { value: string; meaning: string } {
  if (sensor === 'VIIRS') {
    const c = (cls ?? '').toLowerCase()
    return { value: c || '—', meaning: c === 'high' ? 'VIIRS high: saturated or strongly anomalous pixel' : c === 'low' ? 'VIIRS low: weak anomaly, including possible sun glint or false alarm' : 'VIIRS nominal: clear thermal anomaly' }
  }
  if (pct == null) return { value: '—', meaning: 'MODIS confidence not reported' }
  return { value: `${pct}%`, meaning: pct < 30 ? 'MODIS low (0–29%)' : pct < 80 ? 'MODIS nominal (30–79%)' : 'MODIS high (80–100%)' }
}

/** Coordenada digitada como “latitude, longitude” em graus decimais → [lon, lat]; null se inválida. */
export function parseCoordinate(text: string): [number, number] | null {
  const m = text.trim().replace(/[;]/g, ',').match(/^(-?\d+(?:[.,]\d+)?)\s*[, ]\s*(-?\d+(?:[.,]\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1].replace(',', '.'))
  const lon = Number(m[2].replace(',', '.'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return [lon, lat]
}
