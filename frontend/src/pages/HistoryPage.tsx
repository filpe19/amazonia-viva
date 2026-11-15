import { sourceCopy } from '../lib/sourceCopy'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import { CalendarHeatmap } from '../components/CalendarHeatmap'
import { AnomalyList, CoverageSection, HarmonizationExperimentSection, YearMonthMatrix } from '../components/HistoryExtras'
import { HarmonizedSection } from '../components/HarmonizedSection'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { ChartFrame, ChartTooltipBox, axisProps, gridProps } from '../components/charts'
import { Segmented } from '../components/controls'
import { Page, Section } from '../components/Page'
import { ErrorState, Loading, Unavailable } from '../components/states'
import { getJson } from '../lib/api'
import { MONTHS_PT, fmt1, fmt2, fmtInt, fmtNum, fmtYearMonth, shortHash } from '../lib/format'
import { useCalendar, useHistoryStatus, useMonthly, useOverlap } from '../lib/hooks'
import { productStyle } from '../lib/products'
import { useRegion } from '../lib/region-context'
import { useSessionState } from '../lib/useSessionState'
import type { ComparePeriods, MonthlyHistory } from '../lib/types'

type SatFilter = 'todos' | 'Aqua' | 'Terra'

function MonthlySeries({ data, color, label }: { data: MonthlyHistory; color: string; label: string }) {
  const rows = data.series.map((s) => ({ ...s, label: fmtYearMonth(s.year_month) }))
  return (
    <ChartFrame title={label} subtitle={`Monthly detections, ${data.years[0]}–${data.years.at(-1)}`}>
      <div className="h-[200px]">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={36} />
            <YAxis {...axisProps} axisLine={false} width={52} tickFormatter={(v) => fmtInt(v)} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as (typeof rows)[number]
              return <ChartTooltipBox title={p.label} rows={[
                { label: "Detections", value: fmtInt(p.n), color },
                { label: "Same-month median", value: fmtNum(p.baseline_median) },
                { label: "Percentile against other years", value: p.percentile_vs_other_years != null ? `${fmtInt(p.percentile_vs_other_years)}` : "fewer than 5 years" },
              ]} />
            }} />
            <Line dataKey="n" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  )
}

function Seasonality({ data, year, color }: { data: MonthlyHistory; year: number; color: string }) {
  const rows = data.baseline_by_month.map((b) => {
    const cur = data.series.find((s) => s.year === year && s.month === b.month)
    return {
      month: MONTHS_PT[b.month - 1],
      band: b.p10 != null && b.p90 != null ? [b.p10, b.p90] : null,
      median: b.median,
      current: cur?.n ?? null,
      pct: cur?.percentile_vs_other_years ?? null,
      n_years: b.n_years,
    }
  })
  return (
    <div className="h-[260px]">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="month" {...axisProps} />
          <YAxis {...axisProps} axisLine={false} width={52} tickFormatter={(v) => fmtInt(v)} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as (typeof rows)[number]
            return <ChartTooltipBox title={`${p.month} ${year}`} rows={[
              { label: String(year), value: fmtInt(p.current), color },
              { label: `Median (${p.n_years} years)`, value: fmtNum(p.median), color: '#44554d' },
              { label: 'P10–P90 range', value: p.band ? `${fmtInt(p.band[0])}–${fmtInt(p.band[1])}` : 'n < 5' },
              { label: "Percentile against other years", value: p.pct != null ? fmtInt(p.pct) : '—' },
            ]} />
          }} />
          <Area dataKey="band" fill="#dde4dc" stroke="none" isAnimationActive={false} />
          <Line dataKey="median" stroke="#44554d" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          <Line dataKey="current" stroke={color} strokeWidth={2.5} dot={{ r: 3.5, fill: color, stroke: '#fff', strokeWidth: 1.5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function ComparePanel({ region, product }: { region: string; product: string }) {
  const [a, setA] = useSessionState('av:history:period-a', { start: '2023-08-01', end: '2023-10-31' })
  const [b, setB] = useSessionState('av:history:period-b', { start: '2024-08-01', end: '2024-10-31' })
  const q = useQuery({
    queryKey: ['compare', region, product, a, b],
    queryFn: ({ signal }) => getJson<ComparePeriods>('/history/compare', { region, product, a_start: a.start, a_end: a.end, b_start: b.start, b_end: b.end }, signal),
    staleTime: 30 * 60_000,
  })
  const field = (v: { start: string; end: string }, set: (x: { start: string; end: string }) => void, label: string) => (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="type-label mb-1 text-xs text-ink-2">{label}</legend>
      <div className="flex items-center gap-1.5">
        <input type="date" value={v.start} onChange={(e) => set({ ...v, start: e.target.value })} className="control bg-surface px-2 py-1.5 text-sm ring-1 ring-rule" aria-label={`${label}: start`} />
        <span className="text-ink-3">to</span>
        <input type="date" value={v.end} onChange={(e) => set({ ...v, end: e.target.value })} className="control bg-surface px-2 py-1.5 text-sm ring-1 ring-rule" aria-label={`${label}: end`} />
      </div>
    </fieldset>
  )
  return (
    <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-end">
      <div className="flex flex-col gap-4">
        {field(a, setA, "Period A")}
        {field(b, setB, "Period B")}
      </div>
      <div>
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} compact /> : q.data && (
          <dl className="grid grid-cols-3 gap-4">
            <div><dt className="text-xs text-ink-3">Period A</dt><dd className="num text-2xl font-semibold">{fmtInt(q.data.a.n)}</dd><dd className="text-xs text-ink-3">{q.data.a.days} days</dd></div>
            <div><dt className="text-xs text-ink-3">Period B</dt><dd className="num text-2xl font-semibold">{fmtInt(q.data.b.n)}</dd><dd className="text-xs text-ink-3">{q.data.b.days} days</dd></div>
            <div><dt className="text-xs text-ink-3">B relative to A</dt><dd className="num text-2xl font-semibold">{q.data.ratio_b_over_a != null ? `${fmt2(q.data.ratio_b_over_a)}×` : '—'}</dd><dd className="num text-xs text-ink-3">{q.data.difference >= 0 ? '+' : ''}{fmtInt(q.data.difference)} detections</dd></div>
            <p className="col-span-3 text-[11.5px] text-ink-3">{q.data.note} Product: {productStyle(product).label}.</p>
          </dl>
        )}
      </div>
    </div>
  )
}

function yearsSpan(status: ReturnType<typeof useHistoryStatus>['data'], pid: string): string {
  const y = status?.products.find((p) => p.product_id === pid)?.years ?? []
  return y.length ? (y.length === 1 ? String(y[0]) : `${y[0]}–${y.at(-1)}`) : "not imported"
}

function OverlapSection({ region }: { region: string }) {
  const status = useHistoryStatus()
  const [ref, setRef] = useState<'Aqua' | 'Terra' | 'Terra,Aqua'>('Aqua')
  const [other, setOther] = useState<'VIIRS_NOAA20_SP' | 'VIIRS_SNPP_SP'>('VIIRS_NOAA20_SP')
  const q = useOverlap(region, ref, other)
  const c = q.data?.comparison
  const modis = productStyle('MODIS_SP').color
  const snpp = productStyle(other).color
  const otherLabel = other === 'VIIRS_NOAA20_SP' ? 'VIIRS NOAA-20' : 'VIIRS S-NPP'
  // Renomeia `ref`/`other`: o Recharts repassa os campos do ponto ao <path>, e `ref` é reservado no React.
  const points = (c?.series ?? []).map((s) => ({ year_month: s.year_month, modis: s.ref, viirs: s.other, ratio: s.ratio, label: fmtYearMonth(s.year_month) }))
  const maxV = Math.max(1, ...points.map((p) => Math.max(p.modis, p.viirs)))
  const logTicks = [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000].filter((t) => t <= maxV * 1.2)
  return (
    <Section id="sobreposicao" title="MODIS × VIIRS during overlapping years"
      description={<>Same territory and months, with each sensor's counts side by side. This exploratory comparison measures association, but <strong className="font-semibold text-ink">does not</strong> establish a validated fused series.</>}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-ink-2">MODIS reference</span>
        <Segmented label="MODIS reference satellite" size="sm" value={ref} onChange={setRef}
          options={[{ value: 'Aqua', label: 'Aqua', title: "Nominal ~13:30 overpass, near VIIRS" }, { value: 'Terra', label: 'Terra' }, { value: 'Terra,Aqua', label: "Terra & Aqua" }]} />
        <span className="ml-2 text-xs text-ink-2">VIIRS comparado</span>
        <Segmented label="VIIRS comparison product" size="sm" value={other} onChange={setOther}
          options={[{ value: 'VIIRS_NOAA20_SP', label: `NOAA-20 (${yearsSpan(status.data, 'VIIRS_NOAA20_SP')})` }, { value: 'VIIRS_SNPP_SP', label: `S-NPP (${yearsSpan(status.data, 'VIIRS_SNPP_SP')})` }]} />
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : c && q.data && (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <div><dt className="text-xs text-ink-3">Paired months</dt><dd className="num text-2xl font-semibold">{c.months_paired}</dd><dd className="text-xs text-ink-3">{q.data.overlap_years.join(', ')}</dd></div>
            <div><dt className="text-xs text-ink-3">Median VIIRS/MODIS ratio</dt><dd className="num text-2xl font-semibold">{c.ratio_median_active_months != null ? `${fmt1(c.ratio_median_active_months)}×` : '—'}</dd>
              <dd className="num text-xs text-ink-3">{c.ratio_iqr_active_months ? `interquartile range ${fmt1(c.ratio_iqr_active_months[0])}–${fmt1(c.ratio_iqr_active_months[1])}` : `months with ≥ ${c.active_months_threshold} em ambos`}</dd></div>
            <div><dt className="text-xs text-ink-3">Spearman correlation</dt><dd className="num text-2xl font-semibold">{c.spearman_rho != null ? fmt2(c.spearman_rho) : '—'}</dd><dd className="text-xs text-ink-3">monthly rank association</dd></div>
            <div><dt className="text-xs text-ink-3">Pearson em log(1+n)</dt><dd className="num text-2xl font-semibold">{c.pearson_r_log1p != null ? fmt2(c.pearson_r_log1p) : '—'}</dd><dd className="text-xs text-ink-3">logarithmic scale</dd></div>
          </dl>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartFrame title="Paired monthly counts" subtitle="Log axes; line: median ratio"
              footer={<span className="flex flex-wrap gap-3"><span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full" style={{ background: snpp }} />each point is a month</span></span>}>
              <div className="h-[280px]">
                <ResponsiveContainer>
                  <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 16 }}>
                    <CartesianGrid {...gridProps} vertical />
                    <XAxis type="number" dataKey="modis" scale="log" domain={[1, maxV * 1.2]} ticks={logTicks} allowDataOverflow {...axisProps} tickFormatter={(v) => fmtInt(v)}
                      label={{ value: `MODIS ${ref.replace(',', ' & ')} (detections/month)`, position: 'insideBottom', offset: -10, fill: '#6b7a72', fontSize: 11 }} />
                    <YAxis type="number" dataKey="viirs" scale="log" domain={[1, maxV * 1.2]} ticks={logTicks} allowDataOverflow {...axisProps} width={56} tickFormatter={(v) => fmtInt(v)}
                      label={{ value: otherLabel, angle: -90, position: 'insideLeft', fill: '#6b7a72', fontSize: 11, dy: 30 }} />
                    <ZAxis range={[60, 60]} />
                    {c.ratio_median_active_months != null && (
                      <Scatter data={[{ modis: 1, viirs: c.ratio_median_active_months }, { modis: maxV * 1.2, viirs: maxV * 1.2 * c.ratio_median_active_months }]}
                        line={{ stroke: '#44554d', strokeDasharray: '5 4', strokeWidth: 1.5 }} shape={() => <g />} isAnimationActive={false} legendType="none" tooltipType="none" />
                    )}
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const p = payload[0].payload as (typeof points)[number]
                      return <ChartTooltipBox title={p.label} rows={[
                        { label: 'MODIS', value: fmtInt(p.modis), color: modis },
                        { label: otherLabel, value: fmtInt(p.viirs), color: snpp },
                        { label: "Ratio", value: p.ratio != null ? `${fmt1(p.ratio)}×` : '—' },
                      ]} />
                    }} />
                    <Scatter data={points.filter((p) => p.modis > 0 && p.viirs > 0)} fill={snpp} stroke="#fff" strokeWidth={1.5} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </ChartFrame>

            <ChartFrame title={`Ratio ${otherLabel} / MODIS by month`} subtitle="VIIRS detections per MODIS detection">
              <div className="h-[280px]">
                <ResponsiveContainer>
                  <ComposedChart data={points.map((p) => ({ ...p, med: c.ratio_median_active_months }))} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis {...axisProps} axisLine={false} width={40} tickFormatter={(v) => `${v}×`} />
                    <Tooltip cursor={{ fill: '#eef2ee' }} content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const p = payload[0].payload as (typeof points)[number]
                      return <ChartTooltipBox title={p.label} rows={[{ label: "Ratio", value: p.ratio != null ? `${fmt1(p.ratio)}×` : '—' }, { label: 'MODIS', value: fmtInt(p.modis) }, { label: 'VIIRS', value: fmtInt(p.viirs) }]} />
                    }} />
                    <Bar dataKey="ratio" fill={snpp} radius={[3, 3, 0, 0]} maxBarSize={16} />
                    <Line dataKey="med" stroke="#44554d" strokeDasharray="5 4" strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartFrame>
          </div>

          {q.data.spatial && q.data.spatial.months.length > 0 && (
            <ChartFrame title={`Spatial agreement on a common grid of ${String(q.data.spatial.grid_deg).replace('.', ',')}°`}
              subtitle={`Monthly Jaccard index (months with ≥ ${q.data.spatial.min_cells_for_reliable ?? 8} active cells); median ${fmt2(q.data.spatial.jaccard_median_reliable)}`}>
              <div className="h-[180px]">
                <ResponsiveContainer>
                  <LineChart data={q.data.spatial.months.filter((m) => m.reliable !== false).map((m) => ({ ...m, label: fmtYearMonth(m.year_month) }))} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis {...axisProps} axisLine={false} width={40} domain={[0, 1]} />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const p = payload[0].payload as { label: string; jaccard: number | null; cells_ref: number; cells_other: number; spearman_cells: number | null }
                      return <ChartTooltipBox title={p.label} rows={[
                        { label: 'Jaccard', value: fmt2(p.jaccard) }, { label: "MODIS cells", value: fmtInt(p.cells_ref) },
                        { label: "VIIRS cells", value: fmtInt(p.cells_other) }, { label: "Cell-level Spearman", value: fmt2(p.spearman_cells) },
                      ]} />
                    }} />
                    <Line dataKey="jaccard" stroke="#14231d" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartFrame>
          )}

          <ul className="grid gap-2 text-[13px] text-ink-2 md:grid-cols-2">
            {q.data.interpretation_limits.map((l) => (
              <li key={sourceCopy(l)} className="flex gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-caution" aria-hidden="true" />{sourceCopy(l)}</li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}

const PIPELINE: { step: string; status: 'feito' | 'parcial' | 'pendente'; detail: string }[] = [
  { step: "Import annual FIRMS country archives", status: 'feito', detail: "Streamed ingestion; source URL, Last-Modified and SHA-256 retained." },
  { step: 'Clip to official IBGE boundaries', status: 'feito', detail: "Point-in-polygon with detailed IBGE boundaries: Brazil, Pará and its 144 municipalities." },
  { step: "Common temporal aggregation", status: 'feito', detail: "UTC day × satellite × day/night × type × confidence; derived monthly values." },
  { step: "Common spatial aggregation", status: 'feito', detail: "Regular monthly grid: 0.5° for Pará and 0.1° for municipalities, using local Parquet subsets." },
  { step: "Coverage and version audit", status: 'parcial', detail: "Months and file versions audited; granule availability and clouds remain unaudited." },
  { step: "Compare overlapping years", status: 'parcial', detail: "MODIS × NOAA-20 (2021–2025) and S-NPP (2023–2024). Municipal grid: 0.1°. Extend S-NPP history in future work." },
  { step: "Sensitivity analysis", status: 'pendente', detail: "Confidence, presumed vegetation type, day/night, overpass time and Terra/Aqua orbital drift." },
  { step: "Statistical evaluation of fusion", status: 'pendente', detail: "Operational validation remains pending; the existing harmonized series is experimental." },
]

export default function HistoryPage() {
  const { region } = useRegion()
  const [tab, setTab] = useSessionState<'harmonized' | 'observed' | 'methods'>('av:history:tab', 'harmonized')
  useEffect(() => { const apply = () => { if (window.location.hash) setTab('methods') }; apply(); window.addEventListener('hashchange', apply); return () => window.removeEventListener('hashchange', apply) }, [])
  const status = useHistoryStatus()
  const [sat, setSat] = useSessionState<SatFilter>('av:history:satellite','todos')
  const [vegOnly, setVegOnly] = useState(false)
  const modisYears = status.data?.products.find((p) => p.product_id === 'MODIS_SP')?.years ?? []
  const [yearSel, setYearSel] = useSessionState<number | null>('av:history:year',null)
  const year = yearSel ?? modisYears.at(-1) ?? null
  const satParam = sat === 'todos' ? undefined : sat

  const modis = useMonthly({ region, product: 'MODIS_SP', satellites: satParam, vegetation_only: vegOnly, enabled: !status.data?.empty })
  const snppImported = status.data?.products.find((p) => p.product_id === 'VIIRS_SNPP_SP')?.imported
  const snpp = useMonthly({ region, product: 'VIIRS_SNPP_SP', vegetation_only: vegOnly, enabled: Boolean(snppImported) })
  const n20Imported = status.data?.products.find((p) => p.product_id === 'VIIRS_NOAA20_SP')?.imported
  const n20 = useMonthly({ region, product: 'VIIRS_NOAA20_SP', vegetation_only: vegOnly, enabled: Boolean(n20Imported) })
  const [matrixProduct, setMatrixProduct] = useState<'MODIS_SP' | 'VIIRS_NOAA20_SP' | 'VIIRS_SNPP_SP'>('MODIS_SP')
  const matrixData = matrixProduct === 'MODIS_SP' ? modis.data : matrixProduct === 'VIIRS_NOAA20_SP' ? n20.data : snpp.data
  const [calProduct, setCalProduct] = useState<'MODIS_SP' | 'VIIRS_NOAA20_SP' | 'VIIRS_SNPP_SP'>('MODIS_SP')
  const calYears = status.data?.products.find((p) => p.product_id === calProduct)?.years ?? []
  const [calYearSel, setCalYearSel] = useSessionState<number | null>('av:history:calendar-year', null)
  const calYear = calYearSel && calYears.includes(calYearSel) ? calYearSel : calYears.at(-1) ?? null
  const cal = useCalendar({ region, product: calProduct, year: calYear })

  const versionsByYear = useMemo(() => {
    const out: Record<string, { year: number; versions: string[] }[]> = {}
    for (const f of status.data?.source_files ?? []) (out[f.product_id] ??= []).push({ year: f.year, versions: f.version_values })
    return out
  }, [status.data])

  const modisColor = productStyle('MODIS_SP').color
  const snppColor = productStyle('VIIRS_SNPP_SP').color

  return (
    <Page
      title="Fire history"
      intro={<>Read the original sensor records or explore their experimental conversion into a common reference. Observations and estimates are always identified separately.</>}
    >
      <div className="page-tabs" role="tablist" aria-label="History views">{([{id:'harmonized',label:'Experimental calendar'},{id:'observed',label:'Observed records'},{id:'methods',label:'Methods & coverage'}] as const).map(t=><button key={t.id} role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={tab===t.id} tabIndex={tab===t.id ? 0 : -1} onKeyDown={e=>{const ids=['harmonized','observed','methods'] as const;const i=ids.indexOf(tab);const n=e.key==='ArrowRight'?(i+1)%3:e.key==='ArrowLeft'?(i+2)%3:e.key==='Home'?0:e.key==='End'?2:null;if(n!==null){e.preventDefault();setTab(ids[n]);document.getElementById(`tab-${ids[n]}`)?.focus()}}} onClick={()=>setTab(t.id)}>{t.label}</button>)}</div>
      {status.isLoading && <Loading />}
      {status.error && <ErrorState error={status.error} />}
      {status.data?.empty && (
        <Unavailable title="No historical archives available">
          <p>No completed archive is available for this selection. Choose another product or territory.</p>
        </Unavailable>
      )}

      {status.data && !status.data.empty && (
        <>
          {tab === 'harmonized' && <div role="tabpanel" id="panel-harmonized" aria-labelledby="tab-harmonized"><HarmonizedSection region={region} /></div>}
          {tab === 'observed' && <div role="tabpanel" id="panel-observed" aria-labelledby="tab-observed" className="flex flex-col gap-6">


          <Section title="Monthly activity by sensor" description="Each chart represents one product. Vertical scales are independent because sensor sensitivities differ.">
            <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-2">MODIS satellites</span>
                <Segmented label="MODIS satellites" size="sm" value={sat} onChange={setSat}
                  options={[{ value: 'todos', label: "Terra & Aqua" }, { value: 'Aqua', label: 'Aqua' }, { value: 'Terra', label: 'Terra' }]} />
              </div>
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" checked={vegOnly} onChange={(e) => setVegOnly(e.target.checked)} className="size-4 accent-canopy-700" />
                Presumed vegetation only (type 0)
              </label>
            </div>
            <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              {modis.isLoading ? <Loading /> : modis.error ? <ErrorState error={modis.error} /> : modis.data && (
                <MonthlySeries data={modis.data} color={modisColor} label={`MODIS (${sat === 'todos' ? "Terra & Aqua" : sat}), 1 km`} />
              )}
              {!snppImported ? (
                <Unavailable title="VIIRS S-NPP archive unavailable">No completed S-NPP archive is available for this selection.</Unavailable>
              ) : snpp.isLoading ? <Loading /> : snpp.error ? <ErrorState error={snpp.error} /> : snpp.data && (
                <MonthlySeries data={snpp.data} color={snppColor} label="VIIRS S-NPP, 375 m" />
              )}
            </div>
            <div className="mt-8">
              {!n20Imported ? (
                <Unavailable title="VIIRS NOAA-20 archive unavailable">No completed NOAA-20 archive is available for this selection.</Unavailable>
              ) : n20.isLoading ? <Loading /> : n20.error ? <ErrorState error={n20.error} /> : n20.data && (
                <MonthlySeries data={n20.data} color={productStyle('VIIRS_NOAA20_SP').color} label="VIIRS NOAA-20, 375 m (same satellite as recent observations)" />
              )}
            </div>
          </Section>

          <Section title="Is this year unusual for the season?"
            description="Selected MODIS year versus the median and P10–P90 range of the other imported years, month by month. Percentiles require at least five years.">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-2">Year</span>
              <select value={year ?? ''} onChange={(e) => setYearSel(Number(e.target.value))} className="control bg-surface px-2 py-1.5 text-sm ring-1 ring-rule" aria-label="Year">
                {modisYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span className="ml-3 flex items-center gap-4 text-xs text-ink-2">
                <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ background: modisColor }} />{year}</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-0 w-5 border-t-2 border-dashed border-ink-2" />median</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm bg-lichen-deep" />P10–P90</span>
              </span>
            </div>
            {modis.data && year && <ErrorBoundary label="Seasonality"><Seasonality data={modis.data} year={year} color={modisColor} /></ErrorBoundary>}
          </Section>

          <Section title="Year-by-month comparison" description="Each cell represents a month of the same product. Arrows indicate months beyond the other-year P10/P90 range with |robust z| ≥1.5.">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-2">Product</span>
              <Segmented label="Matrix product" size="sm" value={matrixProduct} onChange={setMatrixProduct}
                options={[{ value: 'MODIS_SP', label: `MODIS (${yearsSpan(status.data, 'MODIS_SP')})` }, { value: 'VIIRS_NOAA20_SP', label: `NOAA-20 (${yearsSpan(status.data, 'VIIRS_NOAA20_SP')})` }, { value: 'VIIRS_SNPP_SP', label: `S-NPP (${yearsSpan(status.data, 'VIIRS_SNPP_SP')})` }]} />
            </div>
            {matrixData ? (
              <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <ErrorBoundary label="Year-by-month matrix"><YearMonthMatrix data={matrixData} /></ErrorBoundary>
                <div>
                  <h3 className="type-title mb-2 text-[15px] text-ink">Unusual months ({productStyle(matrixProduct).label})</h3>
                  <AnomalyList anomalies={matrixData.anomalies ?? []} rule={matrixData.anomaly_rule} />
                </div>
              </div>
            ) : <Loading />}
          </Section>

          <Section title={`Detection calendar${calYear ? ` in ${calYear}` : ''}`} description="Detections per UTC day in this territory, one product at a time.">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Segmented label="Calendar product" size="sm" value={calProduct} onChange={(v) => { setCalProduct(v); setCalYearSel(null) }}
                options={[{ value: 'MODIS_SP', label: 'MODIS' }, { value: 'VIIRS_NOAA20_SP', label: 'NOAA-20' }, { value: 'VIIRS_SNPP_SP', label: 'S-NPP' }]} />
              <select value={calYear ?? ''} onChange={(e) => setCalYearSel(Number(e.target.value))} className="control bg-surface px-2 py-1 text-sm ring-1 ring-rule" aria-label="Calendar year">
                {calYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {cal.isLoading ? <Loading /> : cal.error ? <ErrorState error={cal.error} /> : cal.data && (
              <>
                <p className="num mb-3 text-sm text-ink-2">Annual total ({productStyle(calProduct).label}): <strong className="text-ink">{fmtInt(cal.data.total)}</strong></p>
                <ErrorBoundary label="Calendar"><CalendarHeatmap data={cal.data} /></ErrorBoundary>
              </>
            )}
          </Section>

          <Section title="Compare periods" description="The same MODIS Terra/Aqua product in two date intervals.">
            <ComparePanel region={region} product="MODIS_SP" />
          </Section>

          </div>}
          {tab === 'methods' && <div role="tabpanel" id="panel-methods" aria-labelledby="tab-methods" className="flex flex-col gap-6">
          <Section title="Available sensor archives" description="Imported historical records, retained by sensor and processing version. Original-file provenance remains available below.">
            <div className="grid gap-4 md:grid-cols-3">
              {status.data.products.map((p) => {
                const st = productStyle(p.product_id)
                const versions = versionsByYear[p.product_id] ?? []
                const distinct = [...new Set(versions.flatMap((v) => v.versions))]
                return (
                  <div key={p.product_id} className={`rounded-[var(--radius-control)] p-3 ${p.imported ? 'bg-lichen' : 'border border-dashed border-rule'}`}>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                      <span className="inline-block size-2.5 rounded-full" style={{ background: st.color }} aria-hidden="true" />{st.label}
                    </p>
                    {p.imported ? (
                      <>
                        <p className="num mt-1 text-[13px] text-ink-2">{p.years[0]}–{p.years.at(-1)} ({p.files} files, {fmtInt(p.bytes_processed / 1e6)} MB read)</p>
                        <p className="text-[12px] text-ink-3">Satellites: {p.satellites.join(', ')}</p>
                        {distinct.length > 1 && (
                          <p className="mt-2 flex gap-1.5 text-[12px] text-caution">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            <span>Different versions between years: {versions.map((v) => `${v.year}: ${v.versions.join('/')}`).join('; ')}. Possible discontinuity in the series.</span>
                          </p>
                        )}
                      </>
                    ) : <p className="mt-1 text-[13px] text-ink-3">Not imported.</p>}
                    {p.status_note && <p className="mt-1 text-[11.5px] text-ink-3">{sourceCopy(p.status_note)}</p>}
                  </div>
                )
              })}
            </div>
          </Section>

          <OverlapSection region={region} />

          <HarmonizationExperimentSection region={region} />

          <CoverageSection region={region} />

          <Section title="Harmonization pipeline" description="Steps needed to evaluate a statistically validated MODIS–VIIRS series.">
            <ol className="flex flex-col gap-3">
              {PIPELINE.map((p, i) => {
                const Icon = p.status === 'feito' ? CheckCircle2 : p.status === 'parcial' ? CircleDashed : CircleDashed
                return (
                  <li key={sourceCopy(p.step)} className="grid grid-cols-[28px_1fr] gap-3">
                    <span className={`num flex size-7 items-center justify-center rounded-full text-xs font-semibold ${p.status === 'feito' ? 'bg-canopy-900 text-white' : p.status === 'parcial' ? 'bg-caution-soft text-caution' : 'bg-lichen text-ink-3'}`}>{i + 1}</span>
                    <div>
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">{sourceCopy(p.step)}
                        <span className={`inline-flex items-center gap-1 text-xs font-medium ${p.status === 'feito' ? 'text-canopy-700' : p.status === 'parcial' ? 'text-caution' : 'text-ink-3'}`}>
                          <Icon className="size-3.5" aria-hidden="true" />{{feito:"Complete",parcial:"Partial",pendente:"Pending"}[p.status]}
                        </span>
                      </p>
                      <p className="text-[13px] text-ink-2">{sourceCopy(p.detail)}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          </Section>

          <Section title="Source files" description="Every aggregate is traceable to a published NASA FIRMS source file.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[12.5px]">
                <thead className="text-ink-3">
                  <tr><th className="py-1.5 pr-3 font-medium">Product</th><th className="pr-3 font-medium">Year</th><th className="pr-3 font-medium">Version</th><th className="pr-3 text-right font-medium">Rows read</th><th className="pr-3 text-right font-medium">In territory</th><th className="pr-3 font-medium">SHA-256</th><th className="font-medium">Archive</th></tr>
                </thead>
                <tbody className="num divide-y divide-rule/60">
                  {status.data.source_files.map((f) => (
                    <tr key={f.id}>
                      <td className="py-1.5 pr-3">{productStyle(f.product_id).label}</td>
                      <td className="pr-3">{f.year}</td>
                      <td className="pr-3">{f.version_values.join(', ')}</td>
                      <td className="pr-3 text-right">{fmtInt(f.rows_read)}</td>
                      <td className="pr-3 text-right">{fmtInt(f.rows_by_region[region])}</td>
                      <td className="pr-3"><code title={f.sha256}>{shortHash(f.sha256)}</code></td>
                      <td><a className="text-river underline" href={f.url} target="_blank" rel="noreferrer">{f.url.split('/').at(-1)}</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          </div>}
        </>
      )}
    </Page>
  )
}
