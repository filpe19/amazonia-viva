import { t, useLocale } from '../lib/i18n'
import { sourceCopy } from '../lib/sourceCopy'
import { CheckCircle2, CircleHelp, CircleSlash, FileText, MinusCircle, RefreshCw } from 'lucide-react'
import { ComparisonBlock } from '../components/ComparisonBlock'
import { KindBadge } from '../components/KindBadge'
import { Link } from 'react-router-dom'
import { Page } from '../components/Page'
import { ErrorState, Loading, Unavailable } from '../components/states'
import { fmt1, fmtCoord, fmtDate, fmtInt, fmtUtc } from '../lib/format'
import { useImpact, useTerritoryBrief, useTerritoryContext } from '../lib/hooks'
import { productStyle } from '../lib/products'
import { useRegion } from '../lib/region-context'
import type { Signal, TerritoryBrief, WeatherContext } from '../lib/types'

const STATUS = {
  met: { label: "met", Icon: CheckCircle2, cls: 'text-alert' },
  not_met: { label: "not met", Icon: MinusCircle, cls: 'text-canopy-700' },
  unknown: { label: "insufficient data", Icon: CircleHelp, cls: 'text-ink-3' },
  not_applicable: { label: "not applicable", Icon: CircleSlash, cls: 'text-ink-3' },
} as const

function Step({ n, title, children, aside }: { n: number; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  useLocale()
  return (
    <li className="territory-step">
      <span className="question-number num" aria-hidden="true">{n}</span>
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="type-title text-xl text-ink">{title}</h2>
          {aside}
        </div>
        {children}
      </div>
    </li>
  )
}

function SignalRow({ s }: { s: Signal }) {
  useLocale()
  const st = STATUS[s.status]
  return (
    <li className="grid gap-1 border-t border-rule/70 py-3 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_200px] sm:gap-4">
      <div>
        <p className="text-sm font-semibold text-ink">{sourceCopy(s.label)}</p>
        <p className="text-[13px] text-ink-2">{t("Criterion:")} {sourceCopy(s.rule)}</p>
        <p className="text-xs text-ink-3">{t("Uncertainty:")} {sourceCopy(s.uncertainty)}</p>
      </div>
      <div className="sm:text-right">
        <p className={`inline-flex items-center gap-1.5 text-sm font-medium ${st.cls}`}><st.Icon className="size-4" aria-hidden="true" />{t(st.label)}</p>
        {s.value && <p className="num text-[13px] text-ink">{sourceCopy(s.value)}</p>}
      </div>
    </li>
  )
}

function TerritoryContextBlock({ region }: { region: string }) {
  useLocale()
  const q = useTerritoryContext(region)
  if (q.isLoading) return <Loading label={t("Loading IBGE and official layers through Censipam…")} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const c = q.data!
  const layers = c.layers.layers ?? []
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-[var(--radius-control)] bg-lichen p-3">
          <p className="flex items-center gap-2 text-[13px] font-semibold">{t("Population (2022 Census)")} <KindBadge kind={c.population.available ? 'observacao' : 'ausente'} compact /></p>
          <p className="num text-2xl font-semibold">{c.population.available ? fmtInt(c.population.population) : '—'}</p>
          <p className="text-[11.5px] text-ink-3">{c.population.available ? t("{0} people/km². Territory total, not affected population.", {"0": fmt1(c.population.density_per_km2)}) : c.population.reason}</p>
        </div>
        <div className="rounded-[var(--radius-control)] bg-lichen p-3">
          <p className="flex items-center gap-2 text-[13px] font-semibold">{t("Overlapping official areas")} <KindBadge kind={c.layers.available ? 'observacao' : 'ausente'} compact /></p>
          <p className="num text-2xl font-semibold">{c.layers.available ? fmtInt(layers.reduce((a, l) => a + (l.items?.length ?? 0), 0)) : '—'}</p>
          <p className="text-[11.5px] text-ink-3">{t("FUNAI, ICMBio, MMA/CNUC and INCRA, through Censipam GeoServer")}</p>
        </div>
        <div className="rounded-[var(--radius-control)] bg-lichen p-3">
          <p className="flex items-center gap-2 text-[13px] font-semibold">{t("Censipam events")} <KindBadge kind={c.censipam.available ? 'indicador_externo' : 'ausente'} compact /></p>
          <p className="num text-2xl font-semibold">{c.censipam.available ? fmtInt(c.censipam.count) : '—'}</p>
          <p className="text-[11.5px] text-ink-3">{c.censipam.available ? Object.entries(c.censipam.by_status ?? {}).map(([k, v]) => `${v} ${sourceCopy(k.toLowerCase())}`).join(', ') : c.censipam.reason}</p>
        </div>
      </div>
      {c.layers.available && (
        <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
          {layers.map((l) => (
            <li key={l.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-ink">{sourceCopy(l.label)}:</span>
              {!l.available ? <span className="text-alert">{sourceCopy(l.reason)}</span> : l.items.length === 0 ? <span className="text-ink-3">{t("no overlaps")}</span> : (
                <span className="text-ink-2">{l.items.slice(0, 3).map((i) => `${i.name} (${fmt1(i.share_of_territory_pct)}%)`).join('; ')}{l.items.length > 3 ? t("; and {0}", {"0": l.items.length - 3}) : ''}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {c.layers.gaps?.map((g) => <p key={sourceCopy(g)} className="text-[11.5px] text-caution">{sourceCopy(g)}</p>)}
      <ImpactSummary region={region} />
    </div>
  )
}

function ImpactSummary({ region }: { region: string }) {
  useLocale()
  const q = useImpact(region)
  if (q.isLoading) return <Loading label={t("Calculating proximity to localities, health facilities and census tracts…")} />
  if (q.error) return <ErrorState error={q.error} compact />
  const d = q.data!
  if (!d.available) return <p className="text-xs text-ink-3">{sourceCopy(d.reason)}</p>
  return (
    <div className="rounded-[var(--radius-control)] border border-rule p-3">
      <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">{t("People and infrastructure near detections (7 days)")} <KindBadge kind="estimativa" compact /></p>
      <ul className="mt-1.5 grid gap-1 text-[13px] text-ink-2 sm:grid-cols-3">
        <li><span className="num font-semibold text-ink">{d.localities?.available ? t("{0} of {1}", {"0": d.localities.within_5km, "1": d.localities.count}) : '—'}</span> {t("localities (IBGE) with a detection within 5 km")}</li>
        <li><span className="num font-semibold text-ink">{d.health?.available ? t("{0} of {1}", {"0": d.health.within_5km, "1": d.health.count_with_coordinates}) : '—'}</span> {t("health facilities (CNES) with a detection within 5 km")}</li>
        <li><span className="num font-semibold text-ink">{d.exposure?.available && d.exposure.population_total ? t("up to {0}", {"0": fmtInt(d.exposure.population_upper_bound)}) : '—'}</span> {t("people in census tracts within 5 km (upper bound)")}</li>
      </ul>
      <p className="mt-1.5 text-[11.5px] text-ink-3">{t("Proximity and potential exposure do not establish damage. See the territory report for detail and original exports.")}</p>
    </div>
  )
}

function WeatherSummary({ w }: { w: TerritoryBrief['weather'] }) {
  useLocale()
  if (!('recent_analysis' in w)) return <Unavailable title={t("Weather conditions unavailable")}>{(w as { reason?: string }).reason}</Unavailable>
  const wx = w as WeatherContext
  const r = wx.recent_analysis
  const pvc = wx.historical.precip_vs_climatology?.last_14d
  const rose = wx.recent_hourly.wind_rose_7d
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
      <div><dt className="text-xs text-ink-3">{t("Maximum temperature at 2 m")}</dt><dd className="num text-2xl font-semibold">{fmt1(r.latest?.T2M_MAX)} <span className="text-sm font-normal text-ink-3">°C</span></dd><dd className="text-xs text-ink-3">{fmtDate(r.last_available_date)}</dd></div>
      <div><dt className="text-xs text-ink-3">{t("Mean relative humidity")}</dt><dd className="num text-2xl font-semibold">{fmt1(r.last_7d?.rh_mean_pct)} <span className="text-sm font-normal text-ink-3">%</span></dd><dd className="text-xs text-ink-3">{t("7 days through")} {fmtDate(r.last_available_date, false)}</dd></div>
      <div><dt className="text-xs text-ink-3">{t("14-day precipitation")}</dt><dd className="num text-2xl font-semibold">{fmt1(r.last_14d?.precip_total_mm)} <span className="text-sm font-normal text-ink-3">mm</span></dd>
        <dd className="text-xs text-ink-3">{pvc?.ratio != null ? t("{0}% of climatology", {"0": fmtInt(pvc.ratio * 100)}) : t("climatology unavailable")}</dd></div>
      <div><dt className="text-xs text-ink-3">{t("Wind at 10 m")}</dt><dd className="num text-2xl font-semibold">{fmt1(rose?.mean_speed_ms)} <span className="text-sm font-normal text-ink-3">m/s</span></dd>
        <dd className="text-xs text-ink-3">{rose?.prevailing_sector ? t("prevailing from {0}", {"0": rose.prevailing_sector}) : '—'}</dd></div>
      <p className="col-span-2 text-[11.5px] text-ink-3 sm:col-span-4">
        {t("NASA POWER (~50 km reanalysis grid) at")} {fmtCoord(wx.point.lat, wx.point.lon)}{t(". Latest available day:")} {fmtDate(r.last_available_date)}.{' '}
        <Link to={`/ambiente?lat=${wx.point.lat}&lon=${wx.point.lon}`} className="text-river underline">{t("View full environmental context")}</Link>
      </p>
    </dl>
  )
}

export default function TerritoryPage() {
  useLocale()
  const { region } = useRegion()
  const q = useTerritoryBrief(region)
  const b = q.data
  return <Page title={t("Territory analysis")} intro={t("Follow five questions from satellite observations to a documented investigation. The shared territory selection is used across all modules.")}>
    <div className="territory-toolbar"><p>{b ? t("Analysis generated {0}", {"0": fmtUtc(b.generated_at)}) : t("Gathering the latest available evidence")}</p><button type="button" onClick={()=>q.refetch()} className="button-secondary"><RefreshCw size={15} className={q.isFetching?'animate-spin':''}/>{t("Refresh analysis")}</button></div>
    {q.isLoading&&<div className="science-section"><Loading label={t("Gathering FIRMS, historical records and NASA POWER…")}/><p className="mt-3 text-sm text-ink-2">{t("Sources have different update schedules. Environmental data may arrive later than satellite detections.")}</p></div>}
    {q.error&&<ErrorState error={q.error} onRetry={()=>q.refetch()}/>}
    {b&&<ol className="territory-questions">
      <Step n={1} title={t("What is happening?")}>
        <p className="section-context">{t("Last 7 days · NASA FIRMS · counts by satellite")}</p>
        <div className="territory-observations">{(b.recent.products ?? []).map(p=><div key={p.product_id}><h3><i style={{background:productStyle(p.product_id).color}}/>{t(productStyle(p.product_id).label)}</h3><strong>{p.available?fmtInt(p.count):'—'}</strong><p>{p.latest_observation_utc?fmtUtc(p.latest_observation_utc):p.available?t("No detections in this window"):t("Source unavailable")}</p></div>)}</div>
        <p className="mt-4 text-xs text-ink-2">{t("Discrete satellite observations, not a count of individual fires. Clouds, overpass timing and repeated views affect these records.")}</p>
        <Link to={`/?regiao=${region}`} className="text-river text-xs underline mt-3 inline-block">{t("Inspect the observation map")}</Link>
      </Step>
      <Step n={2} title={t("Is this activity unusual?")}>
        <p className="section-context">{t("Compare the same period with earlier years. Original sensor comparisons and experimental equivalents are identified separately.")}</p>
        <div className="grid gap-4 xl:grid-cols-2">{b.comparisons.map(c=><ComparisonBlock key={c.product_baseline} c={c}/>)}</div>
        <p className="mt-4 text-xs text-ink-2">{t("A high historical percentile describes unusual observed activity. It is not a probability of fire, damage or future spread.")}</p>
        <Link to={`/historico?regiao=${region}`} className="text-river text-xs underline mt-3 inline-block">{t("Read the calendar and conversion limitations")}</Link>
      </Step>
      <Step n={3} title={t("What environmental conditions are present?")}>
        <p className="section-context">{t("NASA POWER reanalysis · representative grid point · no forecast")}</p>
        <WeatherSummary w={b.weather}/>
      </Step>
      <Step n={4} title={t("Which areas need further investigation?")}>
        <p className="section-context">{t("Official boundaries and proximity provide context. Distance alone does not establish that a community is threatened.")}</p>
        <TerritoryContextBlock region={region}/>
        {!!b.persistent_cells?.length&&<div className="investigation-note"><h3>{t("Repeated observations warrant checking")}</h3><p>{b.persistent_cells.length} {t("grid cells meet the backend's persistence criterion. Confirm imagery, observation coverage and local reports before drawing conclusions.")}</p><ul>{b.persistent_cells.slice(0,5).map(c=><li key={c.cell_sw.join(',')}>{c.cell_sw.join(', ')}° · {c.days_with_detection} {t("days with detections · grid size")} {c.size_deg}°</li>)}</ul></div>}
        <details className="method-disclosure"><summary>{t("Exploratory investigation criteria")}</summary><p className="my-3 text-xs text-ink-2">{t("These existing screening rules support investigation and preparation. They are not a calibrated risk index, a threat classification or operational instructions.")}</p><ul>{b.attention.signals.map(s=><SignalRow key={s.id} s={s}/>)}</ul></details>
      </Step>
      <Step n={5} title={t("What evidence supports the analysis?")}>
        <p className="section-context">{t("NASA FIRMS observations and archives; NASA POWER environmental context; IBGE boundaries and census; official territorial sources distributed through Censipam.")}</p>
        <p className="text-sm text-ink-2">{t("Check source versions, acquisition times, missing observations and the distinction between measured counts and converted estimates. Correlation and proximity do not establish causality or confirmed damage.")}</p>
        <details className="method-disclosure" open><summary>{t("Scientific limitations")}</summary><ul className="mt-3 list-disc pl-5 text-xs text-ink-2 space-y-2">{b.limitations.map(l=><li key={sourceCopy(l)}>{sourceCopy(l)}</li>)}</ul></details>
        <div className="mt-5 flex flex-wrap gap-3"><Link to={`/ficha/${region}?regiao=${region}`} className="button-primary"><FileText size={16}/>{t("Open territory report")}</Link><Link to={`/evidencias?regiao=${region}`} className="button-secondary">{t("Evidence & exports")}</Link></div>
      </Step>
    </ol>}
  </Page>
}
