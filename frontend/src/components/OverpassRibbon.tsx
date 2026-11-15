import { t, useLocale } from '../lib/i18n'
import { useMemo, useState } from 'react'
import { computePasses, latestPassByProduct, type Pass } from '../lib/passes'
import { productStyle } from '../lib/products'
import type { DetectionsFC } from '../lib/types'
import { fmtAgo, fmtInt, fmtUtc } from '../lib/format'

/**
 * Faixa de passagens: quando cada satélite observou o território na janela.
 * Cada barra é uma passagem; a altura é proporcional à raiz da contagem de
 * detecções naquela passagem. A linha vertical marca o momento da consulta.
 */
export function OverpassRibbon({ data, products }: { data: DetectionsFC | undefined; products: string[] }) {
  useLocale()
  const [hover, setHover] = useState<{ pass: Pass; x: number } | null>(null)
  const meta = data?.metadata
  const t0 = meta ? Date.parse(meta.window.start_utc) : 0
  const t1 = meta ? Date.parse(meta.window.end_utc) : 1

  const passes = useMemo(() => (data ? computePasses(data.features) : []), [data])
  const latest = useMemo(() => latestPassByProduct(passes), [passes])
  const maxCount = Math.max(1, ...passes.map((p) => p.count))

  const W = 1000
  const laneH = 34
  const labelW = 0
  const lanes = products
  const H = lanes.length * laneH
  const x = (t: number) => labelW + ((t - t0) / (t1 - t0)) * (W - labelW)

  const hours = (t1 - t0) / 3_600_000
  const stepH = hours <= 24 ? 3 : hours <= 48 ? 6 : 24
  const ticks: number[] = []
  if (meta) {
    const first = Math.ceil(t0 / (stepH * 3_600_000)) * stepH * 3_600_000
    for (let t = first; t <= t1; t += stepH * 3_600_000) ticks.push(t)
  }

  if (!meta) return null

  return (
    <div className="relative">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="type-title text-[15px] text-ink">{t("Satellite overpasses with detections")}</h2>
        <p className="text-xs text-ink-3">
          {t("Bars: detection counts per overpass (square-root scale). Times in UTC.")}
        </p>
      </div>
      <div className="grid grid-cols-[minmax(92px,auto)_1fr] gap-x-3">
        <div className="flex flex-col" style={{ paddingTop: 0 }}>
          {lanes.map((pid) => {
            const st = productStyle(pid)
            const lp = latest[pid]
            return (
              <div key={pid} className="flex flex-col justify-center" style={{ height: laneH }}>
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                  <span className="inline-block size-2.5 rounded-full" style={{ background: st.color }} aria-hidden="true" />
                  {st.short}
                </span>
                <span className="num text-[11px] leading-tight text-ink-3">
                  {lp ? t("latest {0}", {"0": fmtUtc(new Date(lp.end).toISOString(), false).replace(' UTC', '')}) : t("no detections")}
                </span>
              </div>
            )
          })}
        </div>
        <div className="relative min-w-0">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-auto w-full" style={{ height: H }} role="img"
            aria-label={t("Timeline of satellite overpasses with detections in the territory")}>
            {lanes.map((pid, i) => (
              <line key={pid} x1={0} x2={W} y1={(i + 1) * laneH - 4} y2={(i + 1) * laneH - 4} stroke="#cfd8d0" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {ticks.map((t) => (
              <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={lanes.length * laneH - 4} stroke="#e1e7e1" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {passes.filter((p) => lanes.includes(p.product)).map((p) => {
              const lane = lanes.indexOf(p.product)
              const base = (lane + 1) * laneH - 4
              const h = 4 + Math.sqrt(p.count / maxCount) * (laneH - 10)
              const cx = x((p.start + p.end) / 2)
              return (
                <rect
                  key={`${p.product}-${p.start}`}
                  x={cx - 3}
                  y={base - h}
                  width={6}
                  height={h}
                  rx={2}
                  fill={productStyle(p.product).color}
                  onMouseEnter={() => setHover({ pass: p, x: cx })}
                  onMouseLeave={() => setHover(null)}
                />
              )
            })}
            {/* agora */}
            <line x1={W - 1} x2={W - 1} y1={0} y2={lanes.length * laneH} stroke="#14231d" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="relative h-4" aria-hidden="true">
            {ticks.map((t) => {
              const iso = new Date(t).toISOString()
              const label = stepH >= 24 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso.slice(11, 16)
              return (
                <span key={`l${t}`} className="num absolute -translate-x-1/2 text-[11px] text-ink-3" style={{ left: `${(x(t) / W) * 100}%` }}>
                  {label}
                </span>
              )
            })}
          </div>
          <span className="absolute -top-0.5 right-0 rounded bg-ink px-1 text-[10px] font-medium text-white">{t("query time")}</span>
          {hover && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-ink px-2 py-1.5 text-xs text-white shadow-lg"
              style={{ left: `${(hover.x / W) * 100}%`, top: 0 }}
              role="tooltip"
            >
              <p className="font-semibold">{t(productStyle(hover.pass.product).label)}</p>
              <p className="num">{fmtUtc(new Date(hover.pass.start).toISOString())}</p>
              <p className="num">{fmtInt(hover.pass.count)} {t("detections in territory")}</p>
              <p className="text-white/70">{fmtAgo(new Date(hover.pass.end).toISOString())}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
