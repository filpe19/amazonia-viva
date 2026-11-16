import { AlertTriangle, CircleSlash, Crosshair, Download, ExternalLink, FileText, Flame, Globe2, Info, Layers3, MapPin, Search, Thermometer, TreePine, Users, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { KindBadge } from '../../components/KindBadge'
import { ErrorState, Loading } from '../../components/states'
import { fmt1, fmtAgo, fmtCoord, fmtDate, fmtInt, fmtNum, fmtUtc, monthNames } from '../../lib/format'
import { useDetectionDetail, useHarmonized, useImpact, useTerritoryBrief, useTerritoryContext, useWeather } from '../../lib/hooks'
import { t, useLocale } from '../../lib/i18n'
import { productStyle } from '../../lib/products'
import type { BriefV2, DetectionProps, DetectionRecord, DetectionsMeta, InfoKind } from '../../lib/types'
import { bearing, belemTime, distanceToGeometryKm, haversineKm, interpretConfidence, municipalityAt, pointInGeometry, FWI_LEGEND_URL } from './geo'
import { SATELLITES, satelliteStyle, shapeSvg } from '../map/symbology'
import { sourceCopy } from '../../lib/sourceCopy'
import { useEffect, useRef, useState } from 'react'
import { LAYER_GROUPS, LAYER_PRESETS, LAYERS, type LayerId } from './layerCatalog'
import type { Basemap } from '../map/DetectionMap'
import { BASEMAPS } from './MapToolbar'
import { AttentionTab } from './AttentionTab'
import { IndigenousPanel } from './IndigenousPanel'
import { HotspotPanel } from './HotspotPanel'
import { DataReliability } from './DataReliability'
import { HeatSourceBlock } from './HeatSourceBlock'
import type { AttentionReport, AttentionSignal, HotspotItem, HotspotReport, IndigenousItem, IndigenousReport } from '../../lib/types'

export type IntelTab = 'attention' | 'territory' | 'observation' | 'layers'

function Block({ icon, title, scope, kind, children }: { icon: ReactNode; title: string; scope: string; kind?: InfoKind; children: ReactNode }) {
  return (
    <section className="intel-block">
      <header>
        <span className="intel-icon" aria-hidden="true">{icon}</span>
        <div><h3>{t(title)}</h3><p>{scope}</p></div>
        {kind ? <KindBadge kind={kind} compact /> : <span />}
      </header>
      {children}
    </section>
  )
}

function Row({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return <div className="intel-row"><dt>{typeof label === 'string' ? t(label) : label}</dt><dd><span className="num">{value}</span>{note && <small>{note}</small>}</dd></div>
}

function NotAssessed({ label, why }: { label: string; why: string }) {
  return <div className="intel-row muted"><dt>{t(label)}</dt><dd><span className="inline-flex items-center gap-1"><CircleSlash size={12} aria-hidden="true" />{t('Not assessed')}</span><small>{t(why)}</small></dd></div>
}

const COMPARISON_LABEL: Record<string, string> = { MODIS_SP: 'MODIS (Terra & Aqua)', VIIRS_NOAA20_SP: 'VIIRS NOAA-20', HARMONIZED: 'Harmonized series (experimental)' }
const cmpLabel = (id: string, fallback: string) => t(COMPARISON_LABEL[id] ?? fallback)
const pctText = (p: number | null | undefined, n?: number) => (p == null ? '—' : p >= 100 ? t('above all {0} years', { 0: n ?? '' }) : t('percentile {0}', { 0: Math.round(p) }))

// ------------------------------------------------------------------ Território
function TerritoryTab({ region, regionName, meta, metaError, windowLabel, ranking, rankingSat, onSelectRegion }: { region: string; regionName: string; meta?: DetectionsMeta; metaError?: unknown; windowLabel: string
  ranking?: { id: string; name: string; n: number }[]; rankingSat?: string; onSelectRegion?: (id: string) => void }) {
  useLocale()
  const brief = useTerritoryBrief(region)
  const impact = useImpact(region)
  const ctx = useTerritoryContext(region)
  const harm = useHarmonized(region)
  const b = brief.data as BriefV2 | undefined
  const wx = b && 'recent_analysis' in b.weather ? b.weather : null
  const thisMonth = new Date().getUTCMonth() + 1
  const base = harm.data?.baseline_by_month.find((x) => x.month === thisMonth)
  const pvc = wx?.historical.precip_vs_climatology?.last_14d
  const layers = ctx.data?.layers.layers ?? []
  const PROTECTED_IDS = ['ucs_federais', 'ucs_estaduais', 'terras_indigenas', 'quilombolas']
  const protectedLayers = layers.filter((l) => PROTECTED_IDS.includes(l.id))
  // Contagem só é conhecida quando todas as camadas oficiais responderam; nunca mostrar zero para desconhecido.
  const protectedMissing = PROTECTED_IDS.filter((id) => !protectedLayers.find((l) => l.id === id)?.available)
  const protectedItems = protectedLayers.flatMap((l) => l.items ?? [])
  const protectedDet = protectedItems.reduce((a, i) => a + Object.values(i.detections_7d_by_product ?? {}).reduce((x, y) => x + y, 0), 0)
  const protectedShare = protectedItems.reduce((a, i) => a + (i.share_of_territory_pct ?? 0), 0)
  const settlementLayer = layers.find((l) => l.id === 'assentamentos')
  const settlements = settlementLayer?.items ?? []
  const imp = impact.data
  const brig = imp?.infrastructure?.brigades?.items?.[0]
  const recent7 = b?.recent.products ?? []
  const days = Array.from(new Set(recent7.flatMap((p) => Object.keys(p.by_day_utc ?? {})))).sort()
  const maxDay = Math.max(1, ...recent7.flatMap((p) => Object.values(p.by_day_utc ?? {})))
  return (
    <div className="intel-stack">
      <Block icon={<Flame size={16} />} title="Fire activity" scope={`${regionName} · ${windowLabel}`} kind="observacao">
        {metaError ? <ErrorState error={metaError} compact /> : null}
        <dl>
          {(meta?.products ?? []).flatMap((p) => SATELLITES.filter((s) => s.product === p.product_id).map((s) => {
            const n = p.by_satellite?.[s.key] ?? 0
            return (
              <Row key={s.key} label={<span className="sat-row"><span dangerouslySetInnerHTML={{ __html: shapeSvg(s.shape, s.color, 12) }} />{s.label} <small>{s.resolution}</small></span>} value={p.available ? fmtInt(n) : '—'}
                note={p.available ? (p.latest_observation_utc && n ? (p.product_id === 'MODIS_NRT' ? <>{t('MODIS file latest')} {fmtUtc(p.latest_observation_utc)}</> : <>{t('latest')} {fmtUtc(p.latest_observation_utc)} · {fmtAgo(p.latest_observation_utc)}</>) : t('none in this window')) : sourceCopy(p.error?.message ?? '')} />
            )
          }))}
          {(meta?.products ?? []).length > 0 && <p className="intel-note">{t('Counts are per satellite and are never added together: the same fire can be seen by several satellites.')}</p>}
          {(meta?.products ?? []).filter((p) => p.frp_mw?.median != null).map((p) => (
            <Row key={`frp-${p.product_id}`} label={t('FRP, {0}', { 0: productStyle(p.product_id).short })} value={`${fmt1(p.frp_mw!.median)} / ${fmt1(p.frp_mw!.max)} MW`}
              note={t('median / max. per detection')} />
          ))}
        </dl>
        {days.length > 0 && (
          <figure className="spark" aria-label={t('Daily detections, last 7 days, by satellite')}>
            {days.map((d) => (
              <div key={d} className="spark-day" title={d}>
                <div className="spark-bars">{recent7.map((p) => { const n = p.by_day_utc?.[d] ?? 0; return <span key={p.product_id} style={{ height: `${Math.max(n ? 2 : 0, (n / maxDay) * 38)}px`, background: productStyle(p.product_id).color }} title={`${productStyle(p.product_id).short} ${d}: ${n}`} /> })}</div>
                <small>{d.slice(8, 10)}</small>
              </div>
            ))}
            <figcaption>{t('Detections per UTC day, last 7 days (today partial)')}</figcaption>
          </figure>
        )}
        <h4>{t('Compared with history (same calendar days)')}</h4>
        {brief.isLoading ? <Loading label={t('Comparing with the archive…')} /> : brief.error ? <ErrorState error={brief.error} compact /> : (
          <dl>
            {(b?.comparisons ?? []).map((c) => (
              <Row key={c.product_baseline} label={cmpLabel(c.product_baseline, c.label)}
                value={c.available ? `${fmtInt(c.current_count)} vs ${fmtInt(c.baseline?.stats.median)}` : '—'}
                note={c.available ? <>{t('now vs median of')} {c.baseline?.stats.n_years} {t('years')} · {pctText(c.percentile, c.baseline?.stats.n_years)}{c.experimental ? ` · ${t('experimental')}` : ''}</> : sourceCopy(c.reason ?? '')} />
            ))}
          </dl>
        )}
        {harm.error && <p className="intel-note">{t('Harmonized seasonal context unavailable.')}</p>}
        {base?.median != null && (
          <p className="intel-note">{t('Seasonal context:')} {monthNames()[thisMonth - 1]} {t('historically has a median of')} <strong className="num">{fmtInt(base.median)}</strong> {t('NOAA-20-equivalent detections')} ({base.years[0]}–{base.years.at(-1)}{base.p10 != null ? `, P10–P90 ${fmtInt(base.p10)}–${fmtInt(base.p90)}` : ''}). <KindBadge kind="estimativa" compact /></p>
        )}
      </Block>

      {ranking && ranking.length > 0 && (
        <Block icon={<MapPin size={16} />} title="Where in the state?" scope={`${t('Top municipalities')} · ${satelliteStyle(rankingSat ?? '')?.label ?? rankingSat} · ${windowLabel}`} kind="observacao">
          <ol className="rank-list">
            {ranking.map((r) => (
              <li key={r.id}><button type="button" onClick={() => onSelectRegion?.(r.id)}><span>{r.name}</span><b className="num">{fmtInt(r.n)}</b></button></li>
            ))}
          </ol>
          <p className="intel-note">{t('One satellite at a time, counted inside IBGE municipal boundaries. Select a municipality to investigate.')}</p>
        </Block>
      )}

      <Block icon={<Thermometer size={16} />} title="Meteorological hazard" scope={wx?.recent_analysis.last_available_date ? `${t('NASA POWER, up to')} ${fmtDate(wx.recent_analysis.last_available_date)}` : t('NASA POWER reanalysis')} kind="estimativa">
        {brief.isLoading ? <Loading /> : brief.error ? <ErrorState error={brief.error} compact /> : !wx ? <p className="intel-note">{t('Weather source unavailable.')}</p> : (
          <dl>
            <Row label="Rain, last 14 days" value={`${fmt1(wx.recent_analysis.last_14d?.precip_total_mm)} mm`} note={pvc?.ratio != null ? t('{0}% of the 2001–2025 climatology', { 0: Math.round(pvc.ratio * 100) }) : undefined} />
            <Row label="Relative humidity, 7-day mean" value={`${fmt1(wx.recent_analysis.last_7d?.rh_mean_pct)} %`} />
            <Row label="Max. air temperature" value={`${fmt1(wx.recent_analysis.latest?.T2M_MAX)} °C`} note={fmtDate(wx.recent_analysis.last_available_date)} />
            <Row label="Wind at 10 m, 7 days" value={`${fmt1(wx.recent_hourly.wind_rose_7d?.mean_speed_ms)} m/s`} note={wx.recent_hourly.wind_rose_7d?.prevailing_sector ? t('mostly from {0}', { 0: wx.recent_hourly.wind_rose_7d.prevailing_sector }) : undefined} />
          </dl>
        )}
        <div className="intel-row"><dt>{t('Fire Weather Index')}</dt><dd><span>{t('Map layer (Copernicus GWIS · ECMWF)')}</span><small>{t('Turn on in Layers. External modeled danger class; values per point are not offered by the service.')}</small></dd></div>
      </Block>

      <Block icon={<Users size={16} />} title="Potential human exposure" scope={`${regionName} · ${t('VIIRS detections, last 7 days')}`} kind="estimativa">
        {impact.isLoading ? <Loading label={t('Measuring distances to localities and health facilities…')} /> : impact.error ? <ErrorState error={impact.error} compact /> : !imp ? <p className="intel-note">{t('Exposure data unavailable.')}</p> : !imp.available ? <p className="intel-note">{imp.reason ? sourceCopy(imp.reason) : t('Exposure is computed for municipalities.')}</p> : (
          <dl>
            <Row label="Resident population (Census 2022)" value={fmtInt(imp.exposure?.population_total)} note={t('whole municipality, not people affected')} />
            <Row label="Localities with a detection ≤ 5 km" value={imp.localities?.available ? `${imp.localities.within_5km} / ${imp.localities.count}` : '—'} note="IBGE BC250 2025" />
            <Row label="Health facilities with a detection ≤ 5 km" value={imp.health?.available ? `${imp.health.within_5km} / ${imp.health.count_with_coordinates}` : '—'} note="CNES" />
            <Row label="Residents in census tracts ≤ 5 km" value={imp.exposure?.available ? `≤ ${fmtInt(imp.exposure.population_upper_bound)}` : '—'} note={t('upper bound: whole tracts touching the radius')} />
            {brig && <Row label="Nearest fire brigade" value={`${fmt1(brig.distance_from_centroid_km)} km`} note={`${brig.name.replace(/_/g, ' ')} (${brig.municipality}) · ${t('straight line from the centroid')}`} />}
          </dl>
        )}
      </Block>

      <Block icon={<TreePine size={16} />} title="Potential environmental impact" scope={`${regionName} · ${t('official territories')}`} kind="observacao">
        {ctx.isLoading ? <Loading /> : ctx.error ? <ErrorState error={ctx.error} compact /> : !ctx.data?.layers.available ? <p className="intel-note">{ctx.data?.layers.reason ? sourceCopy(ctx.data.layers.reason) : t('Official territorial layers unavailable.')}</p> : (
          <dl>
            <Row label="Protected areas & Indigenous lands"
              value={protectedMissing.length ? (protectedItems.length ? `≥ ${protectedItems.length}` : '—') : `${protectedItems.length}`}
              note={<>{protectedItems.length ? `${fmt1(protectedShare)}% ${t('of the territory')} · ${fmtInt(protectedDet)} ${t('VIIRS detections inside (7 days)')}` : protectedMissing.length ? '' : t('none overlapping')}
                {protectedMissing.length > 0 && <>{protectedItems.length ? ' · ' : ''}{t('{0} of 4 official layers did not respond', { 0: protectedMissing.length })}</>}</>} />
            <Row label="Federal settlements" value={settlementLayer?.available ? `${settlements.length}` : '—'}
              note={!settlementLayer?.available ? t('INCRA layer did not respond') : settlements.length ? `${fmtInt(settlements.reduce((a, i) => a + Object.values(i.detections_7d_by_product ?? {}).reduce((x, y) => x + y, 0), 0))} ${t('VIIRS detections inside (7 days)')}` : undefined} />
            <NotAssessed label="Burned area" why="No burned-area product (e.g. MODIS MCD64A1) is integrated." />
            <NotAssessed label="Vegetation cover" why="No land-cover layer is integrated in this version." />
          </dl>
        )}
      </Block>

      <section className="intel-legend-note">
        <p><strong>{t('Hazard')}</strong> {t('weather-driven danger (modeled).')} <strong>{t('Exposure')}</strong> {t('people and assets near detections (computed).')} <strong>{t('Vulnerability')}</strong> {t('not assessed.')} <strong>{t('Observed damage')}</strong> {t('not assessed.')}</p>
        <Link to={`/ficha/${region}`} className="button-primary w-full justify-center">{t('Generate territorial attention report')}</Link>
      </section>
    </div>
  )
}

// ------------------------------------------------------------------ Observação
const ATTRS: { key: keyof DetectionRecord; label: string; unit?: string }[] = [
  { key: 'bright_ti4_k', label: 'bright_ti4 (I-4 brightness temperature)', unit: 'K' },
  { key: 'bright_ti5_k', label: 'bright_ti5 (I-5 brightness temperature)', unit: 'K' },
  { key: 'brightness_k', label: 'brightness (band 21/22 temperature)', unit: 'K' },
  { key: 'bright_t31_k', label: 'bright_t31 (band 31 temperature)', unit: 'K' },
  { key: 'frp_mw', label: 'frp (fire radiative power)', unit: 'MW' },
  { key: 'scan_km', label: 'scan (pixel size along scan)', unit: 'km' },
  { key: 'track_km', label: 'track (pixel size along track)', unit: 'km' },
  { key: 'confidence_raw', label: 'confidence (as published)' },
  { key: 'daynight', label: 'daynight' },
  { key: 'acq_date', label: 'acq_date (UTC)' },
  { key: 'acq_time', label: 'acq_time (UTC, HHMM)' },
  { key: 'satellite', label: 'satellite (code)' },
  { key: 'instrument', label: 'instrument' },
  { key: 'version', label: 'version' },
]

function downloadJson(name: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

function ObservationTab({ sel, region, regionName, recent, onPick, onClose, grid, gridProduct, municipalities, seats, onZoomTo }: {
  sel: DetectionProps | null; region: string; regionName: string; recent: DetectionProps[]; onPick: (p: DetectionProps) => void; onClose: () => void
  grid?: GeoJSON.FeatureCollection; gridProduct?: string; municipalities?: GeoJSON.FeatureCollection; seats?: GeoJSON.FeatureCollection
  onZoomTo?: (lon: number, lat: number) => void
}) {
  const { locale } = useLocale()
  const detail = useDetectionDetail(sel?.p ?? null, sel?.id ?? null)
  const d = detail.data
  // Contexto do município que contém o ponto (mesmo quando a visão é estadual).
  const muni = d ? municipalityAt(d.longitude, d.latitude, municipalities) : undefined
  const ctxRegion = (muni?.properties?.id as string | undefined) ?? region
  const ctxName = (muni?.properties?.name as string | undefined) ?? regionName
  const wx = useWeather(d ? { lat: d.latitude, lon: d.longitude, days: 30 } : { region })
  const brief = useTerritoryBrief(ctxRegion)
  const ctx = useTerritoryContext(ctxRegion)
  const impact = useImpact(ctxRegion)
  const harm = useHarmonized(ctxRegion)
  if (!sel) {
    return (
      <div className="intel-stack">
        <p className="intel-empty"><Crosshair size={18} aria-hidden="true" /> {t('Select a point on the map to investigate an observation.')}</p>
        {recent.length > 0 && <div className="recent-list"><h4>{t('Most recent observations')}</h4>{recent.map((r) => {
          const s = satelliteStyle(r.s)
          return <button key={r.id} type="button" onClick={() => onPick(r)}><span dangerouslySetInnerHTML={{ __html: shapeSvg(s?.shape ?? 'circle', s?.color ?? productStyle(r.p).color, 11) }} />{s?.short ?? productStyle(r.p).short}<span className="num">{fmtUtc(r.t.length === 17 ? r.t.replace('Z', ':00Z') : r.t)}</span><span className="num">{r.frp != null ? `${fmt1(r.frp)} MW` : ''}</span></button>
        })}</div>}
      </div>
    )
  }
  const sat = satelliteStyle(sel.s)
  const st = productStyle(sel.p)
  const cell = d && grid && ctxRegion === region ? grid.features.find((f) => pointInGeometry(d.longitude, d.latitude, f.geometry)) : undefined
  const seat = d ? seats?.features.find((f) => f.properties?.region_id === ctxRegion) : undefined
  const seatXY = seat ? (seat.geometry as GeoJSON.Point).coordinates : null
  const seatKm = d && seatXY ? haversineKm(d.longitude, d.latitude, seatXY[0], seatXY[1]) : null
  const rawDir = d && seatXY ? bearing(seatXY[0], seatXY[1], d.longitude, d.latitude).sector : null
  const seatDir = rawDir && locale === 'pt-BR' ? ({ E: 'L', SE: 'SE', SW: 'SO', W: 'O', NW: 'NO' } as Record<string, string>)[rawDir] ?? rawDir : rawDir
  const territories = d ? (ctx.data?.layers.layers ?? []).flatMap((l) => (l.items ?? []).map((i) => ({ name: i.name, layer: sourceCopy(l.label), km: distanceToGeometryKm(d.longitude, d.latitude, i.geometry) })))
    .filter((x) => x.km != null && x.km <= 10).sort((a, b) => (a.km ?? 0) - (b.km ?? 0)).slice(0, 3) : []
  const near = (items?: { name: string; lon: number; lat: number; type?: string | null }[]) => d && items ? items.map((i) => ({ ...i, km: haversineKm(d.longitude, d.latitude, i.lon, i.lat) })).sort((a, b) => a.km - b.km) : []
  const locs = near(impact.data?.localities?.items)
  const hs = near(impact.data?.health?.items)
  const month = d ? Number(d.acq_date.slice(5, 7)) : 0
  const base = harm.data?.baseline_by_month.find((x) => x.month === month)
  const ape = harm.data?.validation?.summary?.sazonal
  const rec = wx.data?.recent_analysis
  const pvc = wx.data?.historical.precip_vs_climatology?.last_14d
  const signals = (brief.data as BriefV2 | undefined)?.attention.signals ?? []
  const conf = d ? interpretConfidence(d.sensor, d.confidence_class, d.confidence_pct) : null
  const seriesLabel = gridProduct === 'MODIS_SP' ? 'MODIS, 2001–2025' : 'NOAA-20, 2021–2025'
  const exportEvidence = () => {
    if (!d) return
    downloadJson(`evidencia_${d.product_id}_${d.detection_id}.json`, {
      generated_at: new Date().toISOString(),
      note: 'Thermal-anomaly pixel from NASA FIRMS; not an individual fire, perimeter or burned area. Distances are great-circle (haversine) or local-projection to polygon edges.',
      detection: d,
      position: { municipality: ctxName, municipality_id: ctxRegion, seat: seat ? { name: seat.properties?.name, km: seatKm, direction_from_seat: seatDir, source: 'IBGE BC250 2025' } : null,
        nearest_localities: locs.slice(0, 3).map((l) => ({ name: l.name, type: l.type, km: Number(l.km.toFixed(2)) })), territories_within_10km: territories },
      historical: { cell: cell?.properties ?? null, series: seriesLabel, harmonized_month_median: base ?? null, harmonization_loyo_median_ape_fraction: ape?.median_ape ?? null },
      environment: rec ? { source: 'NASA POWER', last_available_date: rec.last_available_date, rh_pct: rec.latest?.RH2M, tmax_c: rec.latest?.T2M_MAX, rain_14d_mm: rec.last_14d?.precip_total_mm, wind_ms_7d: wx.data?.recent_hourly.wind_rose_7d?.mean_speed_ms } : null,
    })
  }
  return (
    <div className="intel-stack observation">
      <header className="obs-head">
        <div><p><span dangerouslySetInnerHTML={{ __html: shapeSvg(sat?.shape ?? 'circle', sat?.color ?? st.color, 13) }} />{sat?.label ?? st.label} · {sat?.resolution ?? st.resolution}</p><h3>{t('Thermal detection')}</h3><small className="num">{fmtAgo(sel.t.length === 17 ? sel.t.replace('Z', ':00Z') : sel.t)}</small></div>
        <button type="button" onClick={onClose} aria-label={t('Close observation')}><X size={16} /></button>
      </header>

      <Block icon={<Crosshair size={15} />} title="A · Observation" scope={t('NASA FIRMS record, original attributes')} kind="observacao">
        {detail.isLoading ? <Loading /> : d ? <>
          <dl>
            <Row label="Satellite / sensor" value={`${d.satellite_name} · ${d.instrument}`} note={`${d.product?.collection ?? ''} ${d.product?.processing ?? ''} · ${d.product ? `${d.product.resolution_m} m` : st.resolution} ${t('nominal pixel')}`} />
            <Row label="Observed (UTC)" value={fmtUtc(d.acq_datetime_utc)} note={`${belemTime(d.acq_datetime_utc, locale)} ${t('local time (Pará, UTC−3)')} · ${d.daynight === 'D' ? t('daytime overpass') : t('night-time overpass')}`} />
            <Row label="Coordinates" value={fmtCoord(d.latitude, d.longitude)} note={`${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)} · WGS84 · ${t('pixel centre')}`} />
            <Row label="Confidence" value={conf?.value ?? '—'} note={conf ? t(conf.meaning) : undefined} />
            <Row label="Fire radiative power" value={d.frp_mw != null ? `${fmt1(d.frp_mw)} MW` : t('not reported')} note={t('Radiant energy at overpass; not a perimeter or burned area')} />
          </dl>
          <details className="raw-attrs">
            <summary>{t('Original attributes ({0})', { 0: d.product_id })}</summary>
            <table><tbody>
              {ATTRS.filter((a) => d[a.key] != null && d[a.key] !== '').map((a) => <tr key={a.key}><th>{a.label}</th><td className="num">{String(d[a.key])}{a.unit ? ` ${a.unit}` : ''}</td></tr>)}
            </tbody></table>
            <p className="intel-note">{t('Fields not provided by this product are omitted, not shown as zero.')}</p>
          </details>
        </> : <p className="intel-note">{t('Observation no longer in the 7-day near-real-time file.')}</p>}
      </Block>

      <HeatSourceBlock product={sel.p} id={sel.id} />

      <Block icon={<MapPin size={15} />} title="B · Geographic position" scope={`${ctxName} · IBGE`} kind="estimativa">
        {d ? <dl>
          <Row label="Municipality" value={ctxName} note={muni ? t('point inside the IBGE municipal boundary') : t('outside the municipalities of Pará')} />
          <Row label="Municipal seat" value={seatKm != null ? `${fmt1(seatKm)} km` : '—'} note={seat ? `${String(seat.properties?.name)} · ${t('detection lies {0} of the seat', { 0: seatDir ?? '—' })} · IBGE BC250` : t('Seat position not loaded.')} />
          {locs[0] && <Row label="Nearest locality" value={`${fmt1(locs[0].km)} km`} note={`${locs[0].name} · ${sourceCopy(locs[0].type ?? '')} · IBGE BC250`} />}
          <Row label="Official territories ≤ 10 km" value={territories.length ? territories.map((x) => `${x.name}${x.km === 0 ? ` (${t('inside')})` : ` (${fmt1(x.km)} km)`}`).join('; ') : (ctx.isLoading ? '…' : t('none'))}
            note={territories.length ? territories.map((x) => x.layer).filter((v, i, a) => a.indexOf(v) === i).join(', ') : t('protected areas, Indigenous lands, quilombola territories and settlements')} />
        </dl> : <Loading />}
        <p className="intel-note">{t('Great-circle distances; distance to a territory is measured to its boundary.')}</p>
      </Block>

      <Block icon={<Flame size={15} />} title="C · Historical context" scope={`${ctxName} · ${t('archive')}`} kind="estimativa">
        <dl>
          <Row label={t('This grid cell, {0}', { 0: seriesLabel })} value={cell ? `${fmtInt(cell.properties?.total as number)} ${t('detections')}` : '—'}
            note={cell ? t('active in {0} of {1} years · 0.1° cell (~11 km)', { 0: cell.properties?.years_active as number, 1: (grid as unknown as { metadata?: { n_years?: number } })?.metadata?.n_years ?? '—' }) : t('Cell without archived detections, grid not loaded or outside the selected territory.')} />
          {base?.median != null && <Row label={t('{0}, territory median', { 0: monthNames()[month - 1] })} value={fmtNum(base.median)} note={`${t('NOAA-20-equivalent detections')} · ${base.years[0]}–${base.years.at(-1)} · ${t('experimental')}`} />}
          {ape && <Row label="Harmonization uncertainty" value={`${fmt1(ape.median_ape * 100)}%`} note={t('median error, leave-one-year-out (P90 {0}%)', { 0: fmt1(ape.p90_ape * 100) })} />}
          {(brief.data as BriefV2 | undefined)?.comparisons.filter((c) => c.available && !c.experimental).map((c) => (
            <Row key={c.product_baseline} label={cmpLabel(c.product_baseline, c.label)} value={pctText(c.percentile, c.baseline?.stats.n_years)} note={`${t('last')} ${c.n_days} ${t('complete days vs same days in')} ${c.baseline?.stats.n_years} ${t('years')}`} />
          ))}
        </dl>
      </Block>

      <Block icon={<Thermometer size={15} />} title="D · Environmental context" scope={rec?.last_available_date ? `${t('NASA POWER at this point, up to')} ${fmtDate(rec.last_available_date)}` : 'NASA POWER'} kind="estimativa">
        {wx.isLoading ? <Loading /> : wx.error ? <ErrorState error={wx.error} compact /> : rec?.available ? <dl>
          <Row label="Wind at 10 m" value={`${fmt1(wx.data?.recent_hourly.wind_rose_7d?.mean_speed_ms)} m/s`} note={wx.data?.recent_hourly.wind_rose_7d?.prevailing_sector ? t('mostly from {0} (7 days)', { 0: wx.data.recent_hourly.wind_rose_7d.prevailing_sector }) : undefined} />
          <Row label="Max. air temperature" value={`${fmt1(rec.latest?.T2M_MAX)} °C`} note={fmtDate(rec.last_available_date)} />
          <Row label="Relative humidity" value={`${fmt1(rec.latest?.RH2M)} %`} />
          <Row label="Rain, last 14 days" value={`${fmt1(rec.last_14d?.precip_total_mm)} mm`} note={pvc?.ratio != null ? t('{0}% of climatology', { 0: Math.round(pvc.ratio * 100) }) : undefined} />
          <Row label="Fire Weather Index" value={t('map layer only')} note={t('Copernicus GWIS offers no per-point value; turn on the FWI layer to read the official class.')} />
        </dl> : <p className="intel-note">{t('Weather source unavailable.')}</p>}
        <p className="intel-note">{t('Reanalysis grid cell (~55 × 69 km), days of latency. Not conditions measured at the fire.')}</p>
      </Block>

      <Block icon={<Users size={15} />} title="E · Human context" scope={`${ctxName} · IBGE, CNES`} kind="estimativa">
        {impact.isLoading ? <Loading label={t('Measuring distances to localities and health facilities…')} /> : impact.error ? <ErrorState error={impact.error} compact /> : <dl>
          <Row label="Localities ≤ 5 km" value={impact.data?.localities?.available ? fmtInt(locs.filter((l) => l.km <= 5).length) : '—'} note={locs.slice(0, 2).map((l) => `${l.name} ${fmt1(l.km)} km`).join(' · ') || undefined} />
          <Row label="Health facilities ≤ 10 km" value={impact.data?.health?.available ? fmtInt(hs.filter((h) => h.km <= 10).length) : '—'} note={hs[0] ? `${t('nearest')}: ${hs[0].name} ${fmt1(hs[0].km)} km` : undefined} />
          <Row label="Resident population (Census 2022)" value={fmtInt(ctx.data?.population?.population)} note={t('whole municipality, not people affected')} />
        </dl>}
        <p className="intel-note">{t('Straight-line distances. Proximity is not damage, and residents are not victims.')}</p>
      </Block>

      <Block icon={<Search size={15} />} title="F · Investigation actions" scope={t('Evidence found and what must be confirmed by people')}>
        <ul className="attention-list">
          {signals.filter((s) => s.status === 'met').map((s) => <li key={s.id} className="met">{sourceCopy(s.label)}: {sourceCopy(s.value ?? '')}</li>)}
          <li>{t('Confirm on the ground whether this is a wildfire, agricultural burn or other heat source.')}</li>
          <li>{t('Check cloud cover at nearby overpasses before reading gaps as absence of fire.')}</li>
        </ul>
        <div className="obs-actions">
          {d && onZoomTo && <button type="button" className="button-secondary" onClick={() => onZoomTo(d.longitude, d.latitude)}><Crosshair size={14} />{t('Zoom to detection')}</button>}
          <Link to={`/territorio?regiao=${ctxRegion}`} className="button-secondary"><MapPin size={14} />{t('Open territorial analysis')}</Link>
          <Link to={`/ficha/${ctxRegion}?regiao=${ctxRegion}`} className="button-secondary"><FileText size={14} />{t('Territorial report')}</Link>
          <button type="button" className="button-secondary" onClick={exportEvidence} disabled={!d}><Download size={14} />{t('Export evidence (JSON)')}</button>
          {d?.provenance?.request_urls?.[0] && <a className="button-secondary" href={d.provenance.request_urls[0]} target="_blank" rel="noreferrer"><ExternalLink size={14} />{t('Source file (FIRMS)')}</a>}
          {d && <a className="button-secondary" href={`https://www.google.com/maps/@?api=1&map_action=map&center=${d.latitude.toFixed(5)},${d.longitude.toFixed(5)}&zoom=16&basemap=satellite`} target="_blank" rel="noreferrer"><Globe2 size={14} />{t('Open in Google Maps (satellite)')}</a>}
        </div>
        {d?.provenance && <p className="intel-note">{t('Retrieved {0}; source file last modified {1}; SHA-256 {2}…', { 0: fmtUtc(d.provenance.fetched_at), 1: d.provenance.source_file_last_modified ?? '—', 2: d.provenance.sha256.slice(0, 12) })}</p>}
      </Block>
    </div>
  )
}

// ------------------------------------------------------------------ Camadas
export interface LayerControls {
  fwiOpacity: number; setFwiOpacity: (v: number) => void
  recurrenceProduct: string; setRecurrenceProduct: (p: string) => void; recurrenceOptions: Record<string, string>
  distSat: string; setDistSat: (s: string) => void
  basemap?: Basemap; setBasemap?: (b: Basemap) => void
  applyPreset?: (layers: Partial<Record<LayerId, boolean>>) => void
}

type LayerStatus = Partial<Record<LayerId, { state: 'ready' | 'loading' | 'unavailable' | 'empty'; date?: string; note?: string; count?: number }>>

function LayersTab({ active, onToggle, status, controls }: { active: Record<LayerId, boolean>; onToggle: (id: LayerId, v: boolean) => void; status: LayerStatus; controls?: LayerControls }) {
  useLocale()
  const [info, setInfo] = useState<LayerId | null>(null)
  const presetOn = (p: (typeof LAYER_PRESETS)[number]) => Object.entries(p.layers).every(([k, v]) => Boolean(active[k as LayerId]) === v)
  return (
    <div className="intel-stack layers-catalog v2">
      {controls?.applyPreset && (
        <section className="layer-presets" aria-label={t('Ready-made views')}>
          <h3>{t('Ready-made views')}</h3>
          <div>{LAYER_PRESETS.map((p) => (
            <button key={p.id} type="button" aria-pressed={presetOn(p)} onClick={() => controls.applyPreset?.(p.layers)} data-preset={p.id}>
              <strong>{t(p.label)}</strong><small>{t(p.hint)}</small>
            </button>
          ))}</div>
        </section>
      )}
      {controls?.setBasemap && (
        <section className="layer-basemap" aria-label={t('Basemap')}>
          <h3>{t('Basemap')}</h3>
          <div role="radiogroup" aria-label={t('Basemap')}>{BASEMAPS.map((b) => (
            <button key={b.id} type="button" role="radio" aria-checked={controls.basemap === b.id} onClick={() => controls.setBasemap?.(b.id)} title={t(b.note)}>{t(b.label)}</button>
          ))}</div>
          <p className="layer-note">{t(BASEMAPS.find((b) => b.id === controls.basemap)?.note ?? '')}</p>
        </section>
      )}
      {LAYER_GROUPS.map((g) => {
        const items = LAYERS.filter((l) => l.group === g.id)
        if (!items.length) return null
        const onCount = items.filter((l) => active[l.id] && status[l.id]?.state !== 'unavailable').length
        return (
          <section key={g.id} className="layer-group" data-group={g.id}>
            <h3>{t(g.label)}<small>{onCount}/{items.length}</small></h3>
            <p className="layer-hint">{t(g.hint)}</p>
            {items.map((l) => {
              const s = status[l.id]
              const unavailable = s?.state === 'unavailable'
              const on = active[l.id] && !unavailable
              return (
                <div key={l.id} className={`layer-item ${unavailable ? 'unavailable' : ''} ${on ? 'on' : ''}`} data-layer={l.id}>
                  <div className="layer-row">
                    <label className="switch">
                      <input type="checkbox" role="switch" checked={on} disabled={unavailable} onChange={(e) => onToggle(l.id, e.target.checked)} />
                      <span className="switch-track" aria-hidden="true" />
                      <span className={`layer-swatch sw-${l.id}`} aria-hidden="true" />
                      <strong>{t(l.label)}</strong>
                    </label>
                    {s?.state && s.state !== 'ready' && <em className={`layer-state ${s.state}`}>{s.state === 'loading' ? t('loading') : unavailable ? t('unavailable') : t('no features')}</em>}
                    {s?.count != null && s.state === 'ready' && <em className="layer-state count num">{fmtInt(s.count)}</em>}
                    <button type="button" className="layer-info" aria-expanded={info === l.id} aria-label={t('About this layer')} onClick={() => setInfo(info === l.id ? null : l.id)}><Info size={13} /></button>
                  </div>
                  {s?.note && <p className="layer-note">{s.note}</p>}
                  {controls && l.id === 'fwi' && active.fwi && !unavailable && (
                    <label className="layer-control">{t('Opacity')} <input type="range" min={0.1} max={0.9} step={0.05} value={controls.fwiOpacity} onChange={(e) => controls.setFwiOpacity(Number(e.target.value))} aria-label={t('FWI layer opacity')} /><output className="num">{Math.round(controls.fwiOpacity * 100)}%</output></label>
                  )}
                  {controls && l.id === 'recurrence' && (
                    <label className="layer-control">{t('Series')} <select value={controls.recurrenceProduct} onChange={(e) => controls.setRecurrenceProduct(e.target.value)} aria-label={t('Recurrence series')}>
                      {Object.entries(controls.recurrenceOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select></label>
                  )}
                  {controls && l.id === 'distribution' && !unavailable && (
                    <label className="layer-control">{t('Satellite')} <select value={controls.distSat} onChange={(e) => controls.setDistSat(e.target.value)} aria-label={t('Satellite counted per municipality')}>
                      {SATELLITES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select></label>
                  )}
                  {info === l.id && (
                    <dl>
                      <dt>{t('Source')}</dt><dd>{t(l.source)}{s?.date ? ` · ${s.date}` : ''}</dd>
                      <dt>{t('Resolution')}</dt><dd>{t(l.resolution)}</dd>
                      <dt>{t('Meaning')}</dt><dd>{t(l.meaning)}</dd>
                      <dt>{t('Limitation')}</dt><dd>{t(l.limitation)}</dd>
                    </dl>
                  )}
                  {l.id === 'fwi' && active.fwi && !unavailable && <>
                    <img src={FWI_LEGEND_URL} alt={t('Official FWI legend from Copernicus GWIS: Low below 11.2 to Very Extreme above 70')} className="fwi-legend" />
                    <p className="layer-note">{t('FWI is a dimensionless index of weather-driven fire danger (Canadian Fire Weather Index System). It does not show where fires are burning.')}</p>
                  </>}
                </div>
              )
            })}
          </section>
        )
      })}
      <p className="intel-note">{t('Spatial anomalies are not shown as a layer: anomalies are computed over time for the whole territory (see Fire history).')}</p>
    </div>
  )
}

function useScrollTopOn(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0 }, [dep])
  return ref
}

export function IntelPanel(props: {
  tab: IntelTab; setTab: (t: IntelTab) => void; region: string; regionName: string; meta?: DetectionsMeta; metaError?: unknown; windowLabel: string
  selected: DetectionProps | null; recent: DetectionProps[]; onPick: (p: DetectionProps) => void; onClose: () => void
  layers: Record<LayerId, boolean>; onToggleLayer: (id: LayerId, v: boolean) => void
  layerStatus: Parameters<typeof LayersTab>[0]['status']; grid?: GeoJSON.FeatureCollection; gridProduct?: string
  municipalities?: GeoJSON.FeatureCollection; seats?: GeoJSON.FeatureCollection
  isState?: boolean; ranking?: { id: string; name: string; n: number }[]; rankingSat?: string; onSelectRegion?: (id: string) => void
  controls?: LayerControls; onZoomTo?: (lon: number, lat: number) => void
  attention?: { data?: AttentionReport; isLoading: boolean; isFetching: boolean; error: unknown; refetch: () => void }
  attentionCount?: number; tabBadge?: number; regionLevel?: string; sats?: string[]; focusId?: string | null; onFocus?: (id: string | null) => void; onFrame?: (s: AttentionSignal) => void
  indigenous?: { data?: IndigenousReport; isLoading: boolean; isFetching: boolean; error: unknown; refetch: () => void }
  alertView?: 'hotspots' | 'indigenous' | 'all'; setAlertView?: (v: 'hotspots' | 'indigenous' | 'all') => void
  hotspots?: { data?: HotspotReport; isLoading: boolean; isFetching: boolean; error: unknown; refetch: () => void }
  hsFocus?: string | null; onHsFocus?: (id: string | null) => void; onHsFrame?: (i: HotspotItem) => void; historical?: boolean
  tiFocus?: string | null; onTiFocus?: (id: string | null) => void; onTiFrame?: (i: IndigenousItem) => void
}) {
  useLocale()
  const allSats = SATELLITES.map((x) => x.key)
  // "Todos os cruzamentos" só existe para o Pará e seus municípios; nas demais escalas a visão volta para terras indígenas.
  const crossAvailable = ['estado', 'municipio'].includes(props.regionLevel ?? '') && props.attention?.data?.available !== false
  const wanted = props.alertView ?? 'hotspots'
  const view = props.historical ? 'hotspots' : wanted === 'all' && !crossAvailable ? 'hotspots' : wanted
  const bodyRef = useScrollTopOn(`${props.tab}|${props.selected?.id ?? ''}|${props.region}`)
  const tabs: { id: IntelTab; label: string; icon: ReactNode; badge?: number }[] = [
    { id: 'attention', label: 'Alerts', icon: <AlertTriangle size={14} />, badge: props.tabBadge ?? props.attentionCount },
    { id: 'territory', label: 'Territory', icon: <Users size={14} /> },
    { id: 'observation', label: props.selected ? 'Observation •' : 'Observation', icon: <Crosshair size={14} /> },
    { id: 'layers', label: 'Layers', icon: <Layers3 size={14} /> },
  ]
  return (
    <aside className="intel-panel" aria-label={t('Territorial intelligence')}>
      <div className="intel-tabs" role="tablist" aria-label={t('Intelligence views')}>
        {tabs.map((x) => (
          <button key={x.id} role="tab" type="button" aria-selected={props.tab === x.id} onClick={() => props.setTab(x.id)} data-tab={x.id}>{x.icon}{t(x.label)}{x.badge != null && x.badge > 0 && <span className="tab-badge num">{x.badge > 999 ? '999+' : x.badge}</span>}</button>
        ))}
      </div>
      <div className="intel-body" role="tabpanel" aria-live="polite" ref={bodyRef}>
        {props.tab === 'attention' && (
          <div className="alert-switch three" role="radiogroup" aria-label={t('Alert view')}>
            <button type="button" role="radio" aria-checked={view === 'hotspots'} onClick={() => props.setAlertView?.('hotspots')} data-alert-view="hotspots">
              {t('Hotspots & impact')}{props.hotspots?.data?.available && <b className="num">{props.hotspots.data.summary.by_level.alto}</b>}
            </button>
            <button type="button" role="radio" aria-checked={view === 'indigenous'} disabled={props.historical} onClick={() => props.setAlertView?.('indigenous')} data-alert-view="indigenous">
              {t('Indigenous lands')}{props.indigenous?.data?.available && <b className="num">{props.indigenous.data.summary.lands_with_fire_inside}</b>}
            </button>
            <button type="button" role="radio" aria-checked={view === 'all'} disabled={!crossAvailable || props.historical} onClick={() => props.setAlertView?.('all')} data-alert-view="all"
              title={crossAvailable ? undefined : t('All cross-checks are computed for Pará and its municipalities.')}>
              {t('All cross-checks')}{crossAvailable && props.attentionCount != null && <b className="num">{props.attentionCount}</b>}
            </button>
          </div>
        )}
        {props.tab === 'attention' && view === 'hotspots' && props.hotspots && (
          <div className="intel-stack attention">
            <header className="att-head">
              <p className="att-kicker">{t('Hotspots and potential impact')} · {props.regionName} · {props.windowLabel}</p>
              <p className="att-disclaimer">{t('Detections grouped into hotspots, with their size, model wind and what lies in the way: cities, localities, federal roads, Indigenous lands and protected areas. Alert level and reliability follow public rules; not an official alert and not a spread forecast.')}</p>
            </header>
            <DataReliability meta={props.meta} hotspots={props.hotspots.data} indigenous={props.indigenous?.data} historical={props.historical} />
            <HotspotPanel query={props.hotspots} sats={props.sats ?? allSats} focusId={props.hsFocus ?? null} onFocus={props.onHsFocus ?? (() => {})} onPick={props.onPick} onFrame={props.onHsFrame ?? (() => {})} />
          </div>
        )}
        {props.tab === 'attention' && view === 'indigenous' && props.indigenous && (
          <div className="intel-stack attention">
            <header className="att-head">
              <p className="att-kicker">{t('Alerts for Indigenous lands')} · {props.regionName} · {props.windowLabel}</p>
              <p className="att-disclaimer">{t('Fire detected by satellite inside or within 10 km of Indigenous lands (FUNAI; other Amazon countries via OTCA), with who lives there, how to reach it and what may have caused the heat. Public rules; not an official alert.')}</p>
            </header>
            <IndigenousPanel query={props.indigenous} sats={props.sats ?? allSats} focusId={props.tiFocus ?? null} onFocus={props.onTiFocus ?? (() => {})} onPick={props.onPick} onFrame={props.onTiFrame ?? (() => {})} />
          </div>
        )}
        {props.tab === 'attention' && view === 'all' && props.attention && <AttentionTab region={props.region} regionName={props.regionName} isState={Boolean(props.isState)} windowLabel={props.windowLabel}
          sats={props.sats ?? SATELLITES.map((x) => x.key)} query={props.attention} focusId={props.focusId ?? null} onFocus={props.onFocus ?? (() => {})} onPick={props.onPick}
          onFrame={props.onFrame ?? (() => {})} onSelectRegion={props.onSelectRegion} municipalities={props.municipalities} />}
        {props.tab === 'territory' && <TerritoryTab region={props.region} regionName={props.regionName} meta={props.meta} metaError={props.metaError} windowLabel={props.windowLabel}
          ranking={props.isState ? props.ranking : undefined} rankingSat={props.rankingSat} onSelectRegion={props.onSelectRegion} />}
        {props.tab === 'observation' && <ObservationTab sel={props.selected} region={props.region} regionName={props.regionName} recent={props.recent} onPick={props.onPick} onClose={props.onClose}
          grid={props.grid} gridProduct={props.gridProduct} municipalities={props.municipalities} seats={props.seats} onZoomTo={props.onZoomTo} />}
        {props.tab === 'layers' && <LayersTab active={props.layers} onToggle={props.onToggleLayer} status={props.layerStatus} controls={props.controls} />}
      </div>
    </aside>
  )
}
