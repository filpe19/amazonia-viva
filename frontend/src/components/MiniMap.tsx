import { useMemo } from 'react'

/**
 * Minimapa em SVG (projeção equirretangular com correção do cosseno da latitude).
 * Imprime bem e não depende de WebGL — usado na Ficha de Atenção Territorial.
 */
export interface MiniLayer {
  id: string
  label: string
  geometries: GeoJSON.Geometry[]
  stroke: string
  fill?: string
  dashed?: boolean
}

export interface MiniPoint { lon: number; lat: number; color: string }

type Ring = number[][]

function ringsOf(g: GeoJSON.Geometry): Ring[] {
  if (g.type === 'Polygon') return g.coordinates as Ring[]
  if (g.type === 'MultiPolygon') return (g.coordinates as Ring[][]).flat()
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(ringsOf)
  return []
}

export function MiniMap({ outline, layers, points, height = 340, ariaLabel }: {
  outline: GeoJSON.Geometry[]
  layers: MiniLayer[]
  points: MiniPoint[]
  height?: number
  ariaLabel: string
}) {
  const geo = useMemo(() => {
    const all = outline.flatMap(ringsOf).flat()
    if (!all.length) return null
    const xs = all.map((c) => c[0])
    const ys = all.map((c) => c[1])
    const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const k = Math.cos((((s + n) / 2) * Math.PI) / 180)
    const W = 1000
    const spanX = (e - w) * k
    const spanY = n - s
    const H = Math.max(300, Math.min(900, (W * spanY) / Math.max(spanX, 1e-9)))
    const pad = 16
    const scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY)
    const ox = (W - spanX * scale) / 2
    const oy = (H - spanY * scale) / 2
    const px = (lon: number) => ox + (lon - w) * k * scale
    const py = (lat: number) => oy + (n - lat) * scale
    const path = (g: GeoJSON.Geometry) =>
      ringsOf(g).map((r) => r.map((c, i) => `${i ? 'L' : 'M'}${px(c[0]).toFixed(1)},${py(c[1]).toFixed(1)}`).join('') + 'Z').join('')
    return { W, H, px, py, path, bbox: [w, s, e, n] }
  }, [outline])

  if (!geo) return null
  const inBox = (p: MiniPoint) => p.lon >= geo.bbox[0] && p.lon <= geo.bbox[2] && p.lat >= geo.bbox[1] && p.lat <= geo.bbox[3]

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${geo.W} ${geo.H}`} className="w-full rounded-[var(--radius-control)] bg-[#f4f6f2]" style={{ maxHeight: height }} role="img" aria-label={ariaLabel}>
        {outline.map((g, i) => <path key={`o${i}`} d={geo.path(g)} fill="#ffffff" stroke="none" />)}
        {layers.map((l) => l.geometries.map((g, i) => (
          <path key={`${l.id}-${i}`} d={geo.path(g)} fill={l.fill ?? 'none'} stroke={l.stroke} strokeWidth={1.4}
            strokeDasharray={l.dashed ? '5 4' : undefined} vectorEffect="non-scaling-stroke" />
        )))}
        {points.filter(inBox).map((p, i) => (
          <circle key={i} cx={geo.px(p.lon)} cy={geo.py(p.lat)} r={4.2} fill={p.color} stroke="#fff" strokeWidth={1} />
        ))}
        {outline.map((g, i) => <path key={`b${i}`} d={geo.path(g)} fill="none" stroke="#17402f" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-2">
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-canopy-800" />IBGE boundary</span>
        {layers.filter((l) => l.geometries.length).map((l) => (
          <span key={l.id} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm border" style={{ borderColor: l.stroke, background: l.fill ?? 'transparent', borderStyle: l.dashed ? 'dashed' : 'solid' }} />
            {l.label}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
