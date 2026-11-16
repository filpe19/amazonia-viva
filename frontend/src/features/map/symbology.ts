// Simbologia das detecções por satélite: cor = satélite, forma = sensor (círculo VIIRS 375 m, quadrado/losango MODIS 1 km).
// Paleta validada (validador de CVD/contraste do dataviz): NOAA-20, NOAA-21 e MODIS Aqua herdam a identidade do produto;
// MODIS Terra (#b8458a) passa contra os três, com codificação secundária (forma) no par Terra × Aqua.
// O tamanho do símbolo é fixo: não representa o tamanho do fogo, a FRP nem área queimada.
import type * as maplibregl from 'maplibre-gl'
import type { DetectionsFC } from '../../lib/types'
type DetectionFeature = DetectionsFC['features'][number]

export type SatelliteKey = 'NOAA-20' | 'NOAA-21' | 'Aqua' | 'Terra'
export type Shape = 'circle' | 'square' | 'diamond'

export interface SatelliteStyle {
  key: SatelliteKey
  label: string
  short: string
  sensor: 'VIIRS' | 'MODIS'
  product: 'VIIRS_NOAA20_NRT' | 'VIIRS_NOAA21_NRT' | 'MODIS_NRT'
  resolution: string
  color: string
  shape: Shape
}

export const SATELLITES: SatelliteStyle[] = [
  { key: 'NOAA-20', label: 'NOAA-20 · VIIRS', short: 'NOAA-20', sensor: 'VIIRS', product: 'VIIRS_NOAA20_NRT', resolution: '375 m', color: '#c27c0e', shape: 'circle' },
  { key: 'NOAA-21', label: 'NOAA-21 · VIIRS', short: 'NOAA-21', sensor: 'VIIRS', product: 'VIIRS_NOAA21_NRT', resolution: '375 m', color: '#2a78d6', shape: 'circle' },
  { key: 'Aqua', label: 'Aqua · MODIS', short: 'MODIS Aqua', sensor: 'MODIS', product: 'MODIS_NRT', resolution: '1 km', color: '#1a9e6e', shape: 'square' },
  { key: 'Terra', label: 'Terra · MODIS', short: 'MODIS Terra', sensor: 'MODIS', product: 'MODIS_NRT', resolution: '1 km', color: '#b8458a', shape: 'diamond' },
]
export const SATELLITE_KEYS = SATELLITES.map((s) => s.key)
export const satelliteStyle = (key: string) => SATELLITES.find((s) => s.key === key)
/** Produtos FIRMS necessários para os satélites ligados (MODIS Terra e Aqua vêm no mesmo arquivo MODIS_NRT). */
export const productsFor = (sats: string[]) => [...new Set(SATELLITES.filter((s) => sats.includes(s.key)).map((s) => s.product))]

/** Idade da observação: classe usada para a opacidade e o anel do símbolo. */
export type AgeClass = 'recent' | 'day' | 'older'
export const AGE_CLASSES: { key: AgeClass; label: string; maxHours: number }[] = [
  { key: 'recent', label: '≤ 6 h', maxHours: 6 },
  { key: 'day', label: '6–24 h', maxHours: 24 },
  { key: 'older', label: '> 24 h', maxHours: Infinity },
]
export function ageClass(t: string, now: number): AgeClass {
  const iso = t.length === 17 ? t.replace('Z', ':00Z') : t
  const h = (now - Date.parse(iso)) / 3_600_000
  return h <= 6 ? 'recent' : h <= 24 ? 'day' : 'older'
}

/** Filtra por satélite (cliente) e acrescenta a classe de idade; não soma nem funde detecções. */
export function prepareDetections(fc: DetectionsFC | undefined, sats: string[], now = Date.now()): DetectionsFC | undefined {
  if (!fc) return fc
  const features = fc.features
    .filter((f) => sats.includes(f.properties.s ?? ''))
    .map((f) => ({ ...f, properties: { ...f.properties, age: ageClass(f.properties.t, now) } })) as DetectionFeature[]
  return { ...fc, features }
}

/** Propriedades de agregação: contagem por satélite dentro de cada grupo (nunca a soma tratada como incêndios). */
export const CLUSTER_PROPERTIES = Object.fromEntries(
  SATELLITES.map((s) => [`n_${s.key.replace('-', '')}`, ['+', ['case', ['==', ['get', 's'], s.key], 1, 0]]]),
) as Record<string, maplibregl.ExpressionSpecification>

export const colorBySatellite = [
  'match', ['get', 's'], ...SATELLITES.flatMap((s) => [s.key, s.color]), '#6b7a72',
] as unknown as maplibregl.ExpressionSpecification

export const AGE_OPACITY = ['match', ['get', 'age'], 'recent', 1, 'day', 0.9, 0.55] as unknown as maplibregl.ExpressionSpecification

/** Ícone desenhado em canvas (pré-colorido, com contorno branco) para os símbolos MODIS. */
export function shapeIcon(shape: Shape, color: string, px = 22, ring?: string): ImageData {
  const c = document.createElement('canvas')
  c.width = c.height = px
  const g = c.getContext('2d')!
  const m = px / 2
  const r = px * 0.34
  const path = () => {
    g.beginPath()
    if (shape === 'circle') g.arc(m, m, r, 0, Math.PI * 2)
    else if (shape === 'square') g.rect(m - r * 0.9, m - r * 0.9, r * 1.8, r * 1.8)
    else { g.moveTo(m, m - r * 1.2); g.lineTo(m + r * 1.2, m); g.lineTo(m, m + r * 1.2); g.lineTo(m - r * 1.2, m); g.closePath() }
  }
  path()
  g.fillStyle = color
  g.fill()
  g.lineWidth = px * 0.09
  g.strokeStyle = '#ffffff'
  g.stroke()
  if (ring) { g.lineWidth = px * 0.06; g.strokeStyle = ring; path(); g.stroke() }
  return g.getImageData(0, 0, px, px)
}

export const iconName = (key: string, recent = false) => `det-${key}${recent ? '-recent' : ''}`

/** Registra os ícones sob demanda (sobrevive a trocas de estilo via styleimagemissing). */
export function ensureIcon(map: maplibregl.Map, id: string) {
  if (map.hasImage(id)) return
  const m = /^det-(NOAA-20|NOAA-21|Aqua|Terra)(-recent)?$/.exec(id)
  if (!m) return
  const s = satelliteStyle(m[1])!
  map.addImage(id, shapeIcon(s.shape, s.color, 44, m[2] ? '#14231d' : undefined), { pixelRatio: 2 })
}

/** Ícone de sede municipal (estrela de cinco pontas, contorno branco). */
export function seatIcon(px = 44): ImageData {
  const c = document.createElement('canvas')
  c.width = c.height = px
  const g = c.getContext('2d')!
  const m = px / 2
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? px * 0.42 : px * 0.18
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    g.lineTo(m + r * Math.cos(a), m + r * Math.sin(a))
  }
  g.closePath()
  g.fillStyle = '#14231d'
  g.fill()
  g.lineWidth = px * 0.08
  g.strokeStyle = '#ffffff'
  g.stroke()
  return g.getImageData(0, 0, px, px)
}

/** Ícone SVG/HTML equivalente para legendas (mesma forma e cor do mapa). */
export function shapeSvg(shape: Shape, color: string, size = 12, faded = false, ring = false): string {
  const s = size, m = s / 2, r = s * 0.36
  const op = faded ? 0.55 : 1
  const stroke = ring ? '#14231d' : '#ffffff'
  const body = shape === 'circle'
    ? `<circle cx="${m}" cy="${m}" r="${r}"/>`
    : shape === 'square'
      ? `<rect x="${m - r * 0.9}" y="${m - r * 0.9}" width="${r * 1.8}" height="${r * 1.8}"/>`
      : `<polygon points="${m},${m - r * 1.2} ${m + r * 1.2},${m} ${m},${m + r * 1.2} ${m - r * 1.2},${m}"/>`
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true"><g fill="${color}" fill-opacity="${op}" stroke="${stroke}" stroke-width="${ring ? 1.4 : 1.2}">${body}</g></svg>`
}
