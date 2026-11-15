import { t, useLocale } from '../lib/i18n'
import { useState, type ReactNode } from 'react'
import type { WindRose as WindRoseData } from '../lib/types'
import { ErrorBoundary } from './ErrorBoundary'
import { fmt1 } from '../lib/format'

// Estilo comum para os gráficos Recharts: eixos e grade recessivos, texto em tokens de tinta.
export const axisProps = {
  stroke: '#cfd8d0',
  tick: { fill: '#6b7a72', fontSize: 11, fontFamily: 'inherit' },
  tickLine: false,
} as const
export const gridProps = { stroke: '#e3e9e3', strokeDasharray: '0', vertical: false } as const

export function ChartTooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  useLocale()
  return (
    <div className="rounded-md bg-ink px-2.5 py-2 text-xs text-white shadow-lg">
      <p className="mb-1 font-semibold">{t(title)}</p>
      {rows.map((r) => (
        <p key={r.label} className="num flex items-center gap-1.5">
          {r.color && <span className="inline-block size-2 rounded-full" style={{ background: r.color }} />}
          <span className="text-white/75">{t(r.label)}</span>
          <span className="ml-auto pl-3 font-medium">{t(r.value)}</span>
        </p>
      ))}
    </div>
  )
}

export function ChartFrame({ title, subtitle, children, footer, actions }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; actions?: ReactNode }) {
  useLocale()
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="type-title text-[15px] text-ink">{t(title)}</h3>
          {subtitle && <p className="text-xs text-ink-3">{typeof subtitle === 'string' ? t(subtitle) : subtitle}</p>}
        </div>
        {actions}
      </figcaption>
      <ErrorBoundary label={title || "Chart"}>{children}</ErrorBoundary>
      {footer && <div className="text-[11.5px] leading-relaxed text-ink-3">{footer}</div>}
    </figure>
  )
}

// Rampa sequencial de um só tom (azul de rio), clara -> escura, para classes de velocidade.
const SPEED_RAMP = ['#b7d3f6', '#86b6ef', '#5598e7', '#256abf', '#104281']

/** Rosa dos ventos: frequência (%) por setor de origem, empilhada por classe de velocidade. */
export function WindRose({ data, size = 260 }: { data: WindRoseData; size?: number }) {
  useLocale()
  const [hover, setHover] = useState<number | null>(null)
  const c = size / 2
  const rMax = c - 26
  const totals = data.freq_pct.map((row) => row.reduce((a, b) => a + b, 0))
  const maxTotal = Math.max(1, ...totals)
  const ringStep = maxTotal > 30 ? 10 : maxTotal > 12 ? 5 : 2
  const rings = Array.from({ length: Math.floor(maxTotal / ringStep) }, (_, i) => (i + 1) * ringStep)
  const r = (pct: number) => (Math.sqrt(pct / maxTotal) * rMax)
  const half = (Math.PI / 16) * 0.86

  const wedge = (i: number, r0: number, r1: number) => {
    const a = (i * Math.PI) / 8 - Math.PI / 2
    const p = (rad: number, ang: number) => `${c + rad * Math.cos(ang)},${c + rad * Math.sin(ang)}`
    return `M${p(r0, a - half)} L${p(r1, a - half)} A${r1},${r1} 0 0 1 ${p(r1, a + half)} L${p(r0, a + half)} A${r0},${r0} 0 0 0 ${p(r0, a - half)} Z`
  }

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
      <div className="relative">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
          aria-label={t("Wind rose, {0} hours; prevailing sector {1}", {"0": data.n_hours, "1": data.prevailing_sector ?? '—'})}>
          {rings.map((v) => (
            <circle key={v} cx={c} cy={c} r={r(v)} fill="none" stroke="#e3e9e3" />
          ))}
          {[0, 4, 8, 12].map((i) => {
            const a = (i * Math.PI) / 8 - Math.PI / 2
            return <line key={i} x1={c} y1={c} x2={c + rMax * Math.cos(a)} y2={c + rMax * Math.sin(a)} stroke="#e3e9e3" />
          })}
          {data.freq_pct.map((row, i) => {
            let acc = 0
            return row.map((v, k) => {
              const r0 = r(acc)
              acc += v
              const r1 = r(acc)
              if (v <= 0) return null
              return (
                <path key={`${i}-${k}`} d={wedge(i, r0 + (r0 > 0 ? 1 : 0), r1)} fill={SPEED_RAMP[k]} stroke="#fff" strokeWidth={1}
                  opacity={hover == null || hover === i ? 1 : 0.45}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              )
            })
          })}
          {(['N', 'E', 'S', 'W'] as const).map((lab, j) => {
            const a = (j * Math.PI) / 2 - Math.PI / 2
            return (
              <text key={lab} x={c + (rMax + 14) * Math.cos(a)} y={c + (rMax + 14) * Math.sin(a) + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#44554d">
                {lab}
              </text>
            )
          })}
          {rings.length > 0 && (
            <text x={c + 3} y={c - r(rings[rings.length - 1]) - 3} fontSize={10} fill="#6b7a72">{rings[rings.length - 1]}%</text>
          )}
        </svg>
        {hover != null && (
          <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2">
            <ChartTooltipBox
              title={t("From {0}: {1}% of hours", {"0": data.sectors[hover], "1": fmt1(totals[hover])})}
              rows={data.speed_classes_ms.map((s, k) => ({ label: `${s} m/s`, value: `${fmt1(data.freq_pct[hover][k])}%`, color: SPEED_RAMP[k] }))}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 text-xs text-ink-2">
        <p className="font-semibold text-ink">{t("Speed (m/s)")}</p>
        {data.speed_classes_ms.map((s, k) => (
          <p key={s} className="num flex items-center gap-2">
            <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: SPEED_RAMP[k] }} aria-hidden="true" />
            {s}
          </p>
        ))}
      </div>
    </div>
  )
}

/** Indicador compacto de direção (seta aponta para onde o vento vai). */
export function WindArrow({ fromDeg, size = 40 }: { fromDeg: number; size?: number }) {
  useLocale()
  const to = (fromDeg + 180) % 360
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={t("Wind from {0}°", {"0": Math.round(fromDeg)})}>
      <circle cx="20" cy="20" r="18" fill="#dbe9f8" />
      <g transform={`rotate(${to} 20 20)`}>
        <path d="M20 6 L26 20 L21.5 18.5 L21.5 32 L18.5 32 L18.5 18.5 L14 20 Z" fill="#104281" />
      </g>
    </svg>
  )
}
