import { sourceCopy } from '../lib/sourceCopy'
import { KindBadge } from './KindBadge'
import { fmtDate, fmtInt, fmtNum } from '../lib/format'
import { productStyle } from '../lib/products'
import type { Comparison } from '../lib/types'

/** Período atual × mesmo período nos anos anteriores, sempre no mesmo instrumento. */
export function ComparisonBlock({ c }: { c: Comparison }) {
  if (!c.available || !c.baseline) {
    return (
      <div className="rounded-[var(--radius-control)] border border-dashed border-rule p-3 text-sm">
        <p className="flex items-center gap-2 font-semibold text-ink">{sourceCopy(c.label)} <KindBadge kind="ausente" compact /></p>
        <p className="text-ink-2">{sourceCopy(c.reason)}</p>
      </div>
    )
  }
  const st = c.baseline.stats
  const rows = Object.entries(c.baseline.totals_by_year)
  const max = Math.max(c.current_count ?? 0, ...rows.map(([, v]) => v), 1)
  const color = productStyle(c.product_current).color
  return (
    <div className="rounded-[var(--radius-control)] bg-lichen/70 p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">{sourceCopy(c.label)}{c.experimental && <span className="rounded-full bg-caution-soft px-1.5 py-0.5 text-[10.5px] font-medium text-caution">experimental</span>}</p>
      <p className="num text-xs text-ink-3">{fmtDate(c.period![0])} to {fmtDate(c.period![1])} ({c.n_days} complete UTC days)</p>
      <div className="mt-2 flex h-24 items-end gap-1" role="img" aria-label={`Current ${c.current_count}; previous years ${rows.map(([y, v]) => `${y}: ${v}`).join(', ')}`}>
        {rows.map(([y, v]) => (
          <div key={y} className="flex flex-1 flex-col items-center gap-0.5">
            <div className={`w-full rounded-t-[3px] ${c.origins?.[y] === 'convertido_modis' ? 'bg-[#d9e0d6]' : 'bg-[#b9c6bc]'}`} style={{ height: `${(v / max) * 80}px` }} title={`${y}: ${fmtNum(v)}${c.origins?.[y] === 'convertido_modis' ? ' (converted MODIS)' : ''}`} />
            <span className="num text-[9.5px] text-ink-3">{rows.length > 12 ? (Number(y) % 5 === 0 ? y.slice(2) : '') : y.slice(2)}</span>
          </div>
        ))}
        <div className="flex flex-1 flex-col items-center gap-0.5">
          <div className="w-full rounded-t-[3px]" style={{ height: `${((c.current_count ?? 0) / max) * 80}px`, background: color }} title={`current: ${c.current_count}`} />
          <span className="text-[9.5px] font-semibold text-ink">current</span>
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-ink-3">Current</dt><dd className="num text-base font-semibold text-ink">{fmtInt(c.current_count)}</dd><dd><KindBadge kind="observacao" compact /></dd></div>
        <div><dt className="text-ink-3">Median ({st.n_years} years)</dt><dd className="num text-base font-semibold text-ink">{fmtNum(st.median)}</dd><dd><KindBadge kind="estimativa" compact /></dd></div>
        <div><dt className="text-ink-3">Position</dt><dd className="num text-base font-semibold text-ink">{c.percentile == null ? '—' : c.percentile >= 100 ? `above all ${st.n_years}` : `P${fmtInt(c.percentile)}`}</dd></div>
      </dl>
      <p className="mt-1 text-[11px] text-ink-3">{c.note ? sourceCopy(c.note) : <>Same instrument: {c.product_current} (near real time) × {c.product_baseline} (archive {st.years[0]}–{st.years.at(-1)}).</>}</p>
    </div>
  )
}

