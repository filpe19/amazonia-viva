import { sourceCopy } from '../lib/sourceCopy'
import { CalendarClock, History, MapPin, Telescope } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartFrame, ChartTooltipBox, WindArrow, WindRose, axisProps, gridProps } from '../components/charts'
import { Indicator } from '../components/Indicator'
import { Page, Section } from '../components/Page'
import { ErrorState, Loading, Unavailable } from '../components/states'
import { MONTHS_PT_LONG, fmt1, fmtCoord, fmtDate, fmtInt, fmtUtc } from '../lib/format'
import { useWeather } from '../lib/hooks'
import { useRegion } from '../lib/region-context'
import type { DailyWeather } from '../lib/types'

const MONTH_KEYS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const SECTOR_PT: Record<string, string> = {
  N: 'N', NNE: 'NNE', NE: 'NE', ENE: 'ENE', E: 'E', ESE: 'ESE', SE: 'SE', SSE: 'SSE', S: 'S', SSW: 'SSW', SW: 'SW', WSW: 'WSW', W: 'W', WNW: 'WNW', NW: 'NW', NNW: 'NNW',
}

function CategoryKey() {
  const items = [
    { icon: History, label: "Historical record", body: "NASA POWER monthly climatology, 2001–2025 mean." },
    { icon: CalendarClock, label: "Recent analysis", body: "Daily and hourly reanalysis, available with a delay of several days." },
    { icon: Telescope, label: "Forecast", body: "Not integrated. This POWER module does not provide a weather forecast." },
  ]
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {items.map(({ icon: Icon, label, body }) => (
        <li key={label} className="flex gap-2.5 text-sm">
          <Icon className="mt-0.5 size-4 shrink-0 text-canopy-700" aria-hidden="true" />
          <span><span className="font-semibold text-ink">{label}.</span> <span className="text-ink-2">{body}</span></span>
        </li>
      ))}
    </ul>
  )
}

export default function EnvironmentPage() {
  const { region } = useRegion()
  const [params, setParams] = useSearchParams()
  const lat = params.get('lat') ? Number(params.get('lat')) : undefined
  const lon = params.get('lon') ? Number(params.get('lon')) : undefined
  const custom = lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)
  const [draft, setDraft] = useState({ lat: lat?.toString() ?? '', lon: lon?.toString() ?? '' })

  const q = useWeather(custom ? { lat, lon, days: 30 } : { region, days: 30 })
  const d = q.isPlaceholderData ? undefined : q.data
  const rec = d?.recent_analysis
  const hourly = d?.recent_hourly
  const hist = d?.historical
  const latestDate = rec?.last_available_date

  const clim = useMemo(() => {
    if (!hist?.monthly) return {}
    return hist.monthly
  }, [hist])

  const series = useMemo(
    () =>
      (rec?.series ?? []).map((s: DailyWeather) => {
        const m = MONTH_KEYS[Number(s.date.slice(5, 7)) - 1]
        return { ...s, label: fmtDate(s.date, false), climPrecip: clim[m]?.PRECTOTCORR ?? null, climT2m: clim[m]?.T2M ?? null, climRh: clim[m]?.RH2M ?? null }
      }),
    [rec, clim],
  )

  const pvc = hist?.precip_vs_climatology?.last_14d
  const period30 = rec?.last_30d?.period
  const recentSrc = `NASA POWER, daily reanalysis (${(rec?.sources ?? []).join(', ') || 'GEOS-IT'})`
  const monthNow = latestDate ? MONTHS_PT_LONG[Number(latestDate.slice(5, 7)) - 1] : ''

  const applyPoint = (e: React.FormEvent) => {
    e.preventDefault()
    const la = Number(draft.lat.replace(',', '.'))
    const lo = Number(draft.lon.replace(',', '.'))
    if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180) setParams({ lat: String(la), lon: String(lo) })
  }

  return (
    <Page
      title="Environmental context"
      intro={
        <>
          Meteorological reanalysis at a representative point. Values describe a grid cell of roughly 50 km, not a measurement at the detection location.
        </>
      }
      aside={
        <div className="panel flex w-full flex-col gap-3 p-4 lg:w-[360px]">
          {!custom ? (
            <>
              <p className="text-xs text-ink-3">Representative point: centroid of the IBGE territorial boundary.</p>
            </>
          ) : (
            <div className="flex items-start justify-between gap-2 text-sm">
              <p className="flex items-center gap-1.5 font-medium text-ink"><MapPin className="size-4 text-canopy-700" aria-hidden="true" /> {fmtCoord(lat!, lon!)}</p>
              <button type="button" className="control px-2 py-1 text-xs text-ink-2 ring-1 ring-rule hover:bg-lichen" onClick={() => setParams({})}>
                Use selected territory
              </button>
            </div>
          )}
          <form onSubmit={applyPoint} className="grid grid-cols-2 items-end gap-2">
            <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-2">Latitude
              <input inputMode="decimal" value={draft.lat} onChange={(e) => setDraft((v) => ({ ...v, lat: e.target.value }))} placeholder="-2.4431"
                className="control bg-surface px-2 py-1.5 text-sm ring-1 ring-rule" />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-2">Longitude
              <input inputMode="decimal" value={draft.lon} onChange={(e) => setDraft((v) => ({ ...v, lon: e.target.value }))} placeholder="-54.7083"
                className="control bg-surface px-2 py-1.5 text-sm ring-1 ring-rule" />
            </label>
            <button type="submit" className="control col-span-2 bg-canopy-900 px-3 py-2 text-sm font-medium text-white hover:bg-canopy-800">Query this point</button>
          </form>
          {region === 'brasil' && !custom && (
            <p className="text-xs text-caution">One point does not represent all of Brazil. Select a coordinate or a smaller territory.</p>
          )}
        </div>
      }
    >
      <Section tone="plain">
        <CategoryKey />
      </Section>

      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && Object.keys(d.errors).length > 0 && (
        <div className="flex flex-col gap-2">
          {Object.entries(d.errors).map(([k, e]) => (
            <Unavailable key={k} title={`Some data are unavailable (${k})`}>{sourceCopy(e.message)}</Unavailable>
          ))}
        </div>
      )}

      <Section title="Latest available day" description={latestDate ? <>Reanalysis for {fmtDate(latestDate)} (local solar time), {rec?.latency_days} days before today.</> : undefined}>
        <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
          <Indicator title="Maximum air temperature at 2 m" value={fmt1(rec?.latest?.T2M_MAX)} unit="°C" loading={q.isLoading}
            unavailable={rec && !rec.available ? "Recent data unavailable" : null}
            source={recentSrc} period={latestDate ? fmtDate(latestDate) : '—'}
            note={rec?.last_30d?.t2m_max_mean_c != null ? <>30-day mean of daily maxima: {fmt1(rec.last_30d.t2m_max_mean_c)} °C</> : undefined} />
          <Indicator title="Relative humidity at 2 m (daily mean)" value={fmt1(rec?.latest?.RH2M)} unit="%" loading={q.isLoading}
            source={recentSrc} period={latestDate ? fmtDate(latestDate) : '—'}
            note={clim[MONTH_KEYS[Number(latestDate?.slice(5, 7) ?? 1) - 1]]?.RH2M != null
              ? <>Normal for {monthNow}: {fmt1(clim[MONTH_KEYS[Number(latestDate!.slice(5, 7)) - 1]].RH2M)}%</> : undefined} />
          <Indicator title="Wind at 10 m" loading={q.isLoading}
            value={<span className="flex items-center gap-2">{fmt1(hourly?.wind_rose_7d?.mean_speed_ms)}{hourly?.wind_rose_7d?.resultant_direction_from_deg != null && <WindArrow fromDeg={hourly.wind_rose_7d.resultant_direction_from_deg} size={30} />}</span>}
            unit="m/s, hourly mean"
            unavailable={hourly && !hourly.available ? "Hourly data unavailable" : null}
            source="NASA POWER, hourly reanalysis (UTC)"
            period={hourly?.last_available_hour_utc ? `7 days through ${fmtUtc(hourly.last_available_hour_utc)}` : '—'}
            note={hourly?.wind_rose_7d?.prevailing_sector ? <>Prevailing from {SECTOR_PT[hourly.wind_rose_7d.prevailing_sector]} (direction of origin)</> : undefined} />
          <Indicator title="14-day accumulated precipitation" value={fmt1(rec?.last_14d?.precip_total_mm)} unit="mm" loading={q.isLoading}
            source={`${recentSrc} ; climatology 2001–2025`}
            period={rec?.last_14d ? `${fmtDate(rec.last_14d.period[0])} to ${fmtDate(rec.last_14d.period[1])}` : '—'}
            note={pvc?.ratio != null ? <>{fmtInt(pvc.ratio * 100)}% of climatological expectation ({fmt1(pvc.climatology_expected_mm)} mm)</> : undefined} />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Section title="Wind rose" description="Hourly frequency by wind origin and speed class, over the latest 7 available days.">
          {q.isLoading ? <Loading /> : hourly?.available && hourly.wind_rose_7d ? (
            <>
              <WindRose data={hourly.wind_rose_7d} />
              <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
                {fmtInt(hourly.wind_rose_7d.n_hours)} hours of reanalysis at 10 m. {hourly.wind_rose_7d.convention} Radius scales with the square root of frequency.
              </p>
            </>
          ) : <Unavailable title="Hourly data unavailable">NASA POWER did not return hourly data for this point.</Unavailable>}
        </Section>

        <Section title="Daily precipitation and climatology" description="Bars: daily reanalysis precipitation. Line: climatological daily mean for the month (2001–2025).">
          {q.isLoading ? <Loading /> : series.length ? (
            <ChartFrame title="" subtitle={`mm/day, ${period30 ? `${fmtDate(period30[0])} to ${fmtDate(period30[1])}` : ''}`}>
              <div className="h-[230px]">
                <ResponsiveContainer>
                  <ComposedChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis {...axisProps} axisLine={false} width={44} />
                    <Tooltip cursor={{ fill: '#eef2ee' }} content={({ active, payload }) => active && payload?.length ? (
                      <ChartTooltipBox title={fmtDate((payload[0].payload as DailyWeather).date)} rows={[
                        { label: "Precipitation", value: `${fmt1((payload[0].payload as DailyWeather).PRECTOTCORR)} mm`, color: '#2a78d6' },
                        { label: "Climatology", value: `${fmt1((payload[0].payload as { climPrecip: number }).climPrecip)} mm`, color: '#44554d' },
                      ]} />) : null} />
                    <Bar dataKey="PRECTOTCORR" fill="#2a78d6" radius={[3, 3, 0, 0]} maxBarSize={14} />
                    <Line dataKey="climPrecip" stroke="#44554d" strokeWidth={2} strokeDasharray="5 4" dot={false} type="stepAfter" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </ChartFrame>
          ) : <Unavailable title="Recent daily series unavailable" />}
        </Section>
      </div>

      <Section title="Temperature and humidity over the last 30 days" description="Variables with different units are displayed separately. Dashed line: the same variable's monthly climatological mean (2001–2025).">
        {q.isLoading ? <Loading /> : series.length ? (
          <div className="grid gap-6 md:grid-cols-2">
            {([
              { key: 'T2M', clim: 'climT2m', title: "Daily mean temperature at 2 m", unit: '°C', color: '#14231d' },
              { key: 'RH2M', clim: 'climRh', title: 'Relative humidity at 2 m', unit: '%', color: '#14231d' },
            ] as const).map((v) => (
              <ChartFrame key={v.key} title={v.title} subtitle={v.unit}>
                <div className="h-[190px]">
                  <ResponsiveContainer>
                    <LineChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={24} />
                      <YAxis {...axisProps} axisLine={false} width={44} domain={['auto', 'auto']} />
                      <Tooltip content={({ active, payload }) => active && payload?.length ? (
                        <ChartTooltipBox title={fmtDate((payload[0].payload as DailyWeather).date)} rows={[
                          { label: "Reanalysis", value: `${fmt1((payload[0].payload as Record<string, number>)[v.key])} ${v.unit}` },
                          { label: "Monthly normal", value: `${fmt1((payload[0].payload as Record<string, number>)[v.clim])} ${v.unit}` },
                        ]} />) : null} />
                      <Line dataKey={v.key} stroke={v.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      <Line dataKey={v.clim} stroke="#6b7a72" strokeWidth={1.5} strokeDasharray="5 4" dot={false} type="stepAfter" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ChartFrame>
            ))}
          </div>
        ) : <Unavailable title="Recent daily series unavailable" />}
      </Section>

      {d && (
        <Section title="Sources for this view">
          <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-[180px_1fr]">
            <dt className="text-ink-3">Query point</dt>
            <dd className="num text-ink">{fmtCoord(d.point.lat, d.point.lon)} ({sourceCopy(d.point.basis)})</dd>
            <dt className="text-ink-3">Data type</dt>
            <dd className="text-ink-2">{sourceCopy(d.grid_note)}</dd>
            {rec?.provenance && (<><dt className="text-ink-3">Daily series</dt>
              <dd className="break-all text-ink-2"><a className="text-river underline" href={rec.provenance.request_url} target="_blank" rel="noreferrer">{rec.provenance.request_url}</a><br />retrieved at {fmtUtc(rec.provenance.fetched_at)}{rec.provenance.stale ? "(cached copy; source unavailable)" : ''}</dd></>)}
            {hourly?.provenance && (<><dt className="text-ink-3">Hourly series</dt>
              <dd className="break-all text-ink-2"><a className="text-river underline" href={hourly.provenance.request_url} target="_blank" rel="noreferrer">{hourly.provenance.request_url}</a></dd></>)}
            {hist?.provenance && (<><dt className="text-ink-3">Climatology</dt>
              <dd className="break-all text-ink-2">{hist.range}<br /><a className="text-river underline" href={hist.provenance.request_url} target="_blank" rel="noreferrer">{hist.provenance.request_url}</a></dd></>)}
            <dt className="text-ink-3">Forecast</dt>
            <dd className="text-ink-2">{sourceCopy(d.forecast.note)}</dd>
          </dl>
        </Section>
      )}
    </Page>
  )
}
