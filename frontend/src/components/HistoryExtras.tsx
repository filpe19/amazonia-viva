import { t, useLocale } from '../lib/i18n'
import { sourceCopy } from '../lib/sourceCopy'
import { ArrowDown, ArrowUp, FlaskConical } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartFrame, ChartTooltipBox, axisProps, gridProps } from './charts'
import { Segmented } from './controls'
import { KindBadge } from './KindBadge'
import { Section } from './Page'
import { ErrorState, Loading, Unavailable } from './states'
import { monthNames, fmt1, fmt2, fmtInt, fmtNum, fmtYearMonth, shortHash } from '../lib/format'
import { useCoverage, useHarmonizationExperiment } from '../lib/hooks'
import { productStyle } from '../lib/products'
import type { Anomaly, MonthlyHistory } from '../lib/types'

// Rampa sequencial de um só tom (ocre) para magnitude; zero em cinza neutro.
const RAMP = ['#f6e6c6', '#ecc98a', '#dca552', '#c27c0e', '#955d08', '#633c03']
const ZERO = '#e6ebe5'
const pctLabel = (p: number | null | undefined) => (p == null ? '—' : p >= 100 ? t("above all previous years") : p <= 0 ? t("below all previous years") : `P${fmtInt(p)}`)

/** Matriz ano × mês do mesmo produto: magnitude por cor, anomalias marcadas com seta. */
export function YearMonthMatrix({ data }: { data: MonthlyHistory }) {
  useLocale()
  const [hover, setHover] = useState<string | null>(null)
  const byKey = useMemo(() => new Map(data.series.map((s) => [s.year_month, s])), [data])
  const anomalies = useMemo(() => new Map((data.anomalies ?? []).map((a) => [a.year_month, a])), [data])
  const max = Math.max(1, ...data.series.map((s) => s.n))
  const colorFor = (n: number) => (n <= 0 ? ZERO : RAMP[Math.min(RAMP.length - 1, Math.floor(Math.sqrt(n / max) * RAMP.length))])
  const h = hover ? byKey.get(hover) : null
  const ha = hover ? anomalies.get(hover) : null
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[3px] text-[11px]" aria-label={t("Detections by year and month")}>
          <thead>
            <tr><th className="w-12" />{monthNames().map((m) => <th key={m} className="w-12 font-medium text-ink-3">{m}</th>)}</tr>
          </thead>
          <tbody>
            {data.years.map((y) => (
              <tr key={y}>
                <th className="num pr-1 text-right font-medium text-ink-2">{y}</th>
                {monthNames().map((_, i) => {
                  const ym = `${y}-${String(i + 1).padStart(2, '0')}`
                  const s = byKey.get(ym)
                  const a = anomalies.get(ym)
                  const n = s?.n ?? 0
                  return (
                    <td key={ym} onMouseEnter={() => setHover(ym)} onMouseLeave={() => setHover(null)}
                      className={`num relative h-8 w-12 rounded-[4px] text-center align-middle ${hover === ym ? 'ring-2 ring-ink' : a ? 'ring-2 ring-ink/70' : ''}`}
                      style={{ background: colorFor(n), color: n / max > 0.35 ? '#fff' : '#14231d' }}
                      title={t("{0} {1}: {2} detections", {"0": monthNames('long')[i], "1": y, "2": n})}>
                      <span className="text-[10.5px]">{n >= 1000 ? `${fmt1(n / 1000)}k` : n}</span>
                      {a && (a.direction === 'acima'
                        ? <ArrowUp className="absolute right-0 top-0 size-3" aria-label={t("above the usual range")} />
                        : <ArrowDown className="absolute right-0 top-0 size-3" aria-label={t("below the usual range")} />)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">{t("no detections")} <span className="inline-block size-3 rounded-sm" style={{ background: ZERO }} /></span>
        <span className="flex items-center gap-1">{t("fewer")} {RAMP.map((c) => <span key={c} className="inline-block size-3 rounded-sm" style={{ background: c }} />)} {t("more")}</span>
        <span className="flex items-center gap-1"><ArrowUp className="size-3" /> {t("above the same-month P90 and robust z ≥ 1.5")}</span>
        <span className="flex items-center gap-1"><ArrowDown className="size-3" /> {t("below P10 and robust z ≤ −1.5")}</span>
      </div>
      <p className="num min-h-[1.5em] text-xs text-ink-2" aria-live="polite">
        {h ? <>{fmtYearMonth(h.year_month)}: <strong className="text-ink">{fmtInt(h.n)}</strong> {t("detections; other-year median")} {fmtNum(ha?.median_other_years ?? h.baseline_median)}{t("; position")} {pctLabel(h.percentile_vs_other_years)}{ha?.robust_z != null ? <>{t("; robust z")} {fmt2(ha.robust_z)}</> : null}.</> : t("Select a month to inspect its value and comparison.")}
      </p>
    </div>
  )
}

export function AnomalyList({ anomalies, rule }: { anomalies: Anomaly[]; rule?: string }) {
  useLocale()
  if (!anomalies.length) return <p className="text-sm text-ink-3">{t("No flagged months, or insufficient comparison years.")}</p>
  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-[320px] overflow-auto" tabIndex={0} role="region" aria-label="Scrollable list">
        <table className="w-full text-left text-[12.5px]">
          <thead className="sticky top-0 bg-surface text-ink-3"><tr><th className="py-1 pr-2 font-medium">{t("Month")}</th><th className="pr-2 text-right font-medium">{t("Detections")}</th><th className="pr-2 text-right font-medium">{t("Other-year median")}</th><th className="pr-2 text-right font-medium">{t("Position")}</th><th className="text-right font-medium">{t("robust z")}</th></tr></thead>
          <tbody className="num divide-y divide-rule/60">
            {[...anomalies].reverse().map((a) => (
              <tr key={a.year_month}>
                <td className="py-1 pr-2"><span className="inline-flex items-center gap-1">{a.direction === 'acima' ? <ArrowUp className="size-3.5 text-alert" aria-hidden="true" /> : <ArrowDown className="size-3.5 text-river" aria-hidden="true" />}{fmtYearMonth(a.year_month)}</span></td>
                <td className="pr-2 text-right">{fmtInt(a.n)}</td>
                <td className="pr-2 text-right">{fmtNum(a.median_other_years)}</td>
                <td className="pr-2 text-right">{pctLabel(a.percentile)}</td>
                <td className="text-right">{a.robust_z == null ? '—' : fmt2(a.robust_z)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rule && <p className="text-[11px] text-ink-3">{sourceCopy(rule)}</p>}
    </div>
  )
}

export function HarmonizationExperimentSection({ region }: { region: string }) {
  useLocale()
  const [other, setOther] = useState<'VIIRS_NOAA20_SP' | 'VIIRS_SNPP_SP'>('VIIRS_NOAA20_SP')
  const q = useHarmonizationExperiment(region, other)
  const modis = productStyle('MODIS_SP').color
  const viirs = productStyle(other).color
  const otherLabel = other === 'VIIRS_NOAA20_SP' ? 'VIIRS NOAA-20' : 'VIIRS S-NPP'
  const d = q.data
  const rows = (d?.normalized.months ?? []).map((m) => ({ ...m, label: fmtYearMonth(m.year_month) }))
  const sum = d?.loyo.summary
  return (
    <Section id="experimento" title={t("Experiment: common aggregation and evaluation")}
      description={<>{t("Same territory and calendar month. Each sensor is divided by its own overlap-period mean (a dimensionless index): compare the")} <em>{t("shape")}</em> {t("of the series without adding or converting counts. Then evaluate a MODIS-to-VIIRS ratio conversion outside the training sample.")}</>}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs text-ink-2"><FlaskConical className="size-4 text-canopy-700" aria-hidden="true" /> {t("Experimental; no validated fusion")}</span>
        <KindBadge kind="estimativa" compact />
        <Segmented label={t("Experimental VIIRS product")} size="sm" value={other} onChange={setOther}
          options={[{ value: 'VIIRS_NOAA20_SP', label: 'NOAA-20' }, { value: 'VIIRS_SNPP_SP', label: 'S-NPP' }]} />
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : d && (
        <div className="flex flex-col gap-6">
          <ChartFrame title={t("Relative index by sensor (period mean = 1)")}
            subtitle={t("MODIS Aqua & {0}, {1}–{2}; median difference between indices: {3}", {"0": otherLabel, "1": d.overlap_years[0], "2": d.overlap_years.at(-1), "3": fmt2(d.normalized.median_abs_index_difference)})}
            footer={<span className="flex flex-wrap gap-4">
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ background: modis }} />{t("MODIS Aqua (mean")} {fmtNum(d.normalized.ref_mean)}{t("/month)")}</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ background: viirs }} />{otherLabel} {t("(mean")} {fmtNum(d.normalized.other_mean)}{t("/month)")}</span>
            </span>}>
            <div className="h-[240px]">
              <ResponsiveContainer>
                <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={28} />
                  <YAxis {...axisProps} axisLine={false} tickFormatter={v=>fmtNum(v)} width={36} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload as (typeof rows)[number]
                    return <ChartTooltipBox title={t(p.label)} rows={[
                      { label: "MODIS (index)", value: fmt2(p.ref_index), color: modis },
                      { label: `${otherLabel} (index)`, value: fmt2(p.other_index), color: viirs },
                    ]} />
                  }} />
                  <Line dataKey="ref_index" stroke={modis} strokeWidth={2} dot={false} />
                  <Line dataKey="other_index" stroke={viirs} strokeWidth={2} dot={false} strokeDasharray="6 3" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartFrame>

          {!d.loyo.available ? <Unavailable title={t("Evaluation unavailable")}>{sourceCopy(d.loyo.reason)}</Unavailable> : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div>
                <h3 className="type-title text-[15px] text-ink">{t("Out-of-sample error (leave one year out)")}</h3>
                <p className="mt-1 text-xs text-ink-3">{t("Active months (≥")} {d.loyo.active_min} {t("detections in both sensors). APE = absolute percentage error against observed")} {otherLabel} {t("count.")}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  {(['constante', 'sazonal'] as const).map((k) => (
                    <div key={k} className="rounded-[var(--radius-control)] bg-lichen p-3">
                      <dt className="text-xs text-ink-3">{k === 'constante' ? t("Constant ratio") : t("Seasonal ratio")}</dt>
                      <dd className="num text-2xl font-semibold">{sum?.[k] ? `${fmtInt(sum[k]!.median_ape * 100)}%` : '—'}</dd>
                      <dd className="num text-[11.5px] text-ink-2">{t("Median APE; P90")} {sum?.[k] ? `${fmtInt(sum[k]!.p90_ape * 100)}%` : '—'} ({sum?.[k]?.n_months ?? 0} {t("months)")}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">{sourceCopy(d.loyo.interpretation)} {t("A modest median error with a large P90 means individual converted months may have large errors.")}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-[12.5px]">
                  <thead className="text-ink-3"><tr><th className="py-1.5 pr-2 font-medium">{t("Held-out year")}</th><th className="pr-2 text-right font-medium">{t("Months")}</th><th className="pr-2 text-right font-medium">{t("Training ratio")}</th><th className="pr-2 text-right font-medium">{t("Constant-ratio APE")}</th><th className="text-right font-medium">{t("Seasonal-ratio APE")}</th></tr></thead>
                  <tbody className="num divide-y divide-rule/60">
                    {d.loyo.per_year?.map((y) => (
                      <tr key={y.year}>
                        <td className="py-1.5 pr-2">{y.year}</td>
                        <td className="pr-2 text-right">{y.n_test_months}</td>
                        <td className="pr-2 text-right">{y.ratio_constante_treino != null ? `${fmt2(y.ratio_constante_treino)}×` : '—'}</td>
                        <td className="pr-2 text-right">{y.constante ? t("{0}% (max. {1}%)", {"0": fmtInt(y.constante.median_ape * 100), "1": fmtInt(y.constante.max_ape * 100)}) : '—'}</td>
                        <td className="text-right">{y.sazonal ? t("{0}% (max. {1}%)", {"0": fmtInt(y.sazonal.median_ape * 100), "1": fmtInt(y.sazonal.max_ape * 100)}) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="rounded-[var(--radius-control)] bg-caution-soft p-3 text-[12.5px] text-ink">{sourceCopy(d.statement)}</p>
        </div>
      )}
    </Section>
  )
}

export function CoverageSection({ region }: { region: string }) {
  useLocale()
  const q = useCoverage(region)
  return (
    <Section id="cobertura" title={t("Coverage, processing and uncertainty")}
      description={t("What each archive covers: years, days with detections, processing versions and nominal overpass time.")}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : q.data && (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 lg:grid-cols-3">
            {q.data.products.map((p) => (
              <div key={p.product_id} className={`rounded-[var(--radius-control)] p-3 ${p.available ? 'bg-lichen' : 'border border-dashed border-rule'}`}>
                <p className="flex items-center gap-1.5 text-sm font-semibold"><span className="inline-block size-2.5 rounded-full" style={{ background: productStyle(p.product_id).color }} />{p.instrument}</p>
                <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11.5px] text-ink-2">
                  <dt className="text-ink-3">{t("Resolution")}</dt><dd>{p.resolution}</dd>
                  <dt className="text-ink-3">{t("Algorithm")}</dt><dd>{p.algorithm}</dd>
                  <dt className="text-ink-3">{t("Overpass")}</dt><dd>{p.overpass_local}</dd>
                  <dt className="text-ink-3">{t("Archive")}</dt><dd>{sourceCopy(p.processing)}</dd>
                </dl>
                {!p.available && <p className="mt-1.5 text-xs text-ink-3">{sourceCopy(p.reason)}</p>}
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[12.5px]">
              <thead className="text-ink-3"><tr><th className="py-1.5 pr-3 font-medium">{t("Product")}</th><th className="pr-3 font-medium">{t("Year")}</th><th className="pr-3 text-right font-medium">{t("Detections in territory")}</th><th className="pr-3 text-right font-medium">{t("Days with detections")}</th><th className="pr-3 text-right font-medium">{t("Months with detections")}</th><th className="pr-3 font-medium">{t("Version")}</th><th className="font-medium">{t("SHA-256")}</th></tr></thead>
              <tbody className="num divide-y divide-rule/60">
                {q.data.products.filter((p) => p.available).flatMap((p) => (p.per_year ?? []).map((y) => (
                  <tr key={`${p.product_id}-${y.year}`}>
                    <td className="py-1 pr-3">{t(productStyle(p.product_id).label)}</td>
                    <td className="pr-3">{y.year}</td>
                    <td className="pr-3 text-right">{fmtInt(y.detections_in_territory)}</td>
                    <td className="pr-3 text-right">{y.days_with_detection}</td>
                    <td className="pr-3 text-right">{y.months_with_detection}</td>
                    <td className="pr-3">{y.versions.join(', ')}</td>
                    <td><code title={y.sha256}>{shortHash(y.sha256, 10)}</code></td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-2">{t("Overlap with MODIS:")} {Object.entries(q.data.overlap_years_with_modis).map(([k, v]) => t("{0} {1}–{2} ({3} years)", {"0": productStyle(k).label, "1": v[0], "2": v.at(-1), "3": v.length})).join('; ') || 'none'}.</p>
          <ul className="grid gap-1.5 text-[12.5px] text-ink-2 md:grid-cols-2">
            {q.data.uncertainties.map((u) => <li key={sourceCopy(u)} className="flex gap-2"><span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-caution" aria-hidden="true" />{sourceCopy(u)}</li>)}
          </ul>
        </div>
      )}
    </Section>
  )
}
