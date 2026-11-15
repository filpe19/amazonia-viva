import { t, useLocale } from '../lib/i18n'
import { sourceCopy } from '../lib/sourceCopy'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { KIND_ORDER, KindBadge } from '../components/KindBadge'
import { ComparisonBlock } from '../components/ComparisonBlock'
import { MiniMap, type MiniLayer } from '../components/MiniMap'
import { ErrorState, Loading, Unavailable } from '../components/states'
import { apiUrl } from '../lib/api'
import { fmt1, fmt2, fmtBrt, fmtDate, fmtInt, fmtUtc } from '../lib/format'
import { useBoundary, useDetections, useFicha, useOverlap, useRegions } from '../lib/hooks'
import { productStyle } from '../lib/products'
import { useRegion } from '../lib/region-context'
import type { Ficha, InfoKind, Signal } from '../lib/types'

const SIGNAL_STATUS: Record<Signal['status'], string> = {
  met: "met", not_met: "not met", unknown: "insufficient data", not_applicable: "not applicable",
}
const LAYER_STYLE: Record<string, { stroke: string; fill?: string; dashed?: boolean }> = {
  terras_indigenas: { stroke: '#8a3b12', fill: 'rgba(138,59,18,0.10)' },
  ucs_federais: { stroke: '#1a7a52', fill: 'rgba(26,158,110,0.14)' },
  ucs_estaduais: { stroke: '#4c8c2b', fill: 'rgba(76,140,43,0.12)' },
  quilombolas: { stroke: '#7a4b9e', fill: 'rgba(122,75,158,0.12)' },
  assentamentos: { stroke: '#8a6a1d', dashed: true },
}

function FichaSection({ n, title, kind, children }: { n: number; title: string; kind: InfoKind; children: ReactNode }) {
  useLocale()
  return (
    <section className="ficha-section border-t border-rule pt-5 print:break-inside-avoid-page">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="num flex size-7 items-center justify-center rounded-full bg-canopy-900 text-xs font-semibold text-white" aria-hidden="true">{n}</span>
        <h2 className="type-title text-[19px] text-ink">{title}</h2>
        <KindBadge kind={kind} />
      </div>
      <div className="pl-0 sm:pl-10">{children}</div>
    </section>
  )
}

function csvCell(v: unknown): string {
  const t = v == null ? '' : String(v)
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

function downloadProximityCsv(f: Ficha) {
  const imp = f.impact
  const header = ['categoria', 'nome', 'tipo', 'latitude', 'longitude', 'deteccao_mais_proxima_km', 'deteccoes_ate_1km', 'deteccoes_ate_5km',
    'deteccoes_ate_10km', 'populacao_setor', 'situacao_setor', 'fonte', 'tipo_informacao']
  const rows: unknown[][] = []
  for (const i of imp.localities?.items ?? []) rows.push(['localidade', i.name, i.type, i.lat, i.lon, i.nearest_detection_km, i.detections_within_km?.['1'], i.detections_within_km?.['5'], i.detections_within_km?.['10'], '', '', 'IBGE BC250 2025', 'estimativa (proximidade)'])
  for (const i of imp.health?.items ?? []) rows.push(['unidade_saude', i.name, i.type, i.lat, i.lon, i.nearest_detection_km, i.detections_within_km?.['1'], i.detections_within_km?.['5'], i.detections_within_km?.['10'], '', '', `CNES ${i.cnes ?? ''}`, 'estimativa (proximidade)'])
  for (const t of imp.exposure?.top_tracts ?? []) rows.push(['setor_censitario', t.cd_setor, '', '', '', t.nearest_detection_km, '', t.detections_within_radius, '', t.population, t.situacao, 'IBGE Censo 2022', "estimate (potential exposure, upper bound)"])
  const meta = [`# Amazônia Viva — proximity and potential exposure (not confirmed damage). Territory: ${f.region.name}. Generated: ${f.generated_at}. Observations: VIIRS NOAA-20/NOAA-21, 7 days.`]
  const body = [...meta, header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n')
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `proximidade_${f.region.id}_${f.generated_at.replace(/[:-]/g, '').slice(0, 13)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function TimelineBlock({ f }: { f: Ficha }) {
  useLocale()
  const products = f.brief.recent.products ?? []
  const days = Array.from(new Set(products.flatMap((p) => Object.keys(p.by_day_utc ?? {})))).sort()
  const max = Math.max(1, ...products.flatMap((p) => Object.values(p.by_day_utc ?? {})))
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="text-[12px]" aria-label={t("Detections by UTC day and satellite")}>
          <thead><tr><th className="pr-3 text-left font-medium text-ink-3">{t("Satellite")}</th>{days.map((d) => <th key={d} className="num w-16 font-medium text-ink-3">{fmtDate(d, false)}</th>)}</tr></thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.product_id}>
                <td className="py-1 pr-3"><span className="flex items-center gap-1.5 font-medium"><span className="inline-block size-2.5 rounded-full" style={{ background: productStyle(p.product_id).color }} />{productStyle(p.product_id).short}</span></td>
                {days.map((d) => {
                  const n = p.by_day_utc?.[d] ?? 0
                  return (
                    <td key={d} className="px-0.5 align-bottom">
                      <div className="flex h-14 flex-col items-center justify-end gap-0.5">
                        <div className="w-7 rounded-t-[3px]" style={{ height: `${Math.max(n ? 3 : 0, (n / max) * 44)}px`, background: productStyle(p.product_id).color }} title={`${d}: ${n}`} />
                        <span className="num text-[10.5px] text-ink-2">{fmtInt(n)}</span>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="text-[12.5px] text-ink-2">
        {products.map((p) => p.latest_observation_utc && (
          <li key={p.product_id}>{t("Latest overpass with a detection,")} {t(productStyle(p.product_id).label)}: <strong className="num text-ink">{fmtUtc(p.latest_observation_utc)}</strong> ({fmtBrt(p.latest_observation_utc)})</li>
        ))}
      </ul>
      <p className="text-[11.5px] text-ink-3">{t("Counts by UTC day; today is incomplete. Polar satellites observe at discrete overpasses. A day without detections may lack useful observations because of clouds.")}</p>
    </div>
  )
}

function ProximityTable({ items, kindLabel }: { items: NonNullable<Ficha['impact']['localities']>['items']; kindLabel: string }) {
  useLocale()
  if (!items?.length) return <p className="text-sm text-ink-3">{t("No records.")}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] text-left text-[12.5px]">
        <thead className="text-ink-3"><tr><th className="py-1.5 pr-3 font-medium">{t(kindLabel)}</th><th className="pr-3 font-medium">{t("Type")}</th><th className="pr-3 text-right font-medium">{t("Nearest detection")}</th><th className="pr-3 text-right font-medium">{t("Within 1 km")}</th><th className="pr-3 text-right font-medium">{t("Within 5 km")}</th><th className="text-right font-medium">{t("Within 10 km")}</th></tr></thead>
        <tbody className="num divide-y divide-rule/60">
          {items.slice(0, 10).map((i) => (
            <tr key={`${i.name}-${i.lat}`}>
              <td className="py-1.5 pr-3 text-ink">{i.name}{i.coordinate_inside_territory === false ? <span className="block text-[10.5px] text-caution">{t("registered coordinate outside the municipality")}</span> : null}</td>
              <td className="pr-3 text-[11.5px] text-ink-2">{i.type ?? '—'}</td>
              <td className="pr-3 text-right">{i.nearest_detection_km == null ? '—' : `${fmt1(i.nearest_detection_km)} km`}</td>
              <td className="pr-3 text-right">{i.detections_within_km?.['1'] ?? 0}</td>
              <td className="pr-3 text-right">{i.detections_within_km?.['5'] ?? 0}</td>
              <td className="text-right">{i.detections_within_km?.['10'] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > 10 && <p className="mt-1 text-[11px] text-ink-3">{t("The 10 nearest of")} {items.length}{t(". Full list in the proximity CSV.")}</p>}
    </div>
  )
}

function ImpactBlock({ f }: { f: Ficha }) {
  useLocale()
  const imp = f.impact
  if (!imp?.available) return <Unavailable title={t("Proximity analysis unavailable")}>{imp?.reason}</Unavailable>
  const ex = imp.exposure
  const br = imp.infrastructure?.brigades
  const air = imp.infrastructure?.airstrips
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-[var(--radius-control)] bg-caution-soft p-3 text-[12.5px] text-ink">
        <strong>{t("Proximity and potential exposure do not establish damage or threat.")}</strong> {t("Distances use")} {fmtInt(imp.detections_used?.count)} {t("VIIRS detections over the last 7 days (")}{imp.detections_used?.area}). {sourceCopy(imp.method)}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-control)] bg-lichen p-3">
          <p className="text-[13px] font-semibold">{t("Localities with a detection within 5 km")}</p>
          <p className="num text-2xl font-semibold">{imp.localities?.available ? t("{0} of {1}", {"0": fmtInt(imp.localities.within_5km), "1": fmtInt(imp.localities.count)}) : '—'}</p>
          <p className="text-[11.5px] text-ink-3">{imp.localities?.available ? Object.entries(imp.localities.by_type ?? {}).map(([k, v]) => `${v} ${sourceCopy(k.toLowerCase())}`).join('; ') : imp.localities?.reason}</p>
        </div>
        <div className="rounded-[var(--radius-control)] bg-lichen p-3">
          <p className="text-[13px] font-semibold">{t("Health facilities with a detection within 5 km")}</p>
          <p className="num text-2xl font-semibold">{imp.health?.available ? t("{0} of {1}", {"0": fmtInt(imp.health.within_5km), "1": fmtInt(imp.health.count_with_coordinates)}) : '—'}</p>
          <p className="text-[11.5px] text-ink-3">{imp.health?.available ? t("{0} registered in CNES; {1} without coordinates; {2} with hospital care", {"0": imp.health.count_registered, "1": imp.health.without_coordinates, "2": imp.health.hospital_care_count}) : imp.health?.reason}</p>
        </div>
        <div className="rounded-[var(--radius-control)] bg-river-soft p-3">
          <p className="flex items-center gap-2 text-[13px] font-semibold">{t("Potential exposure")} <KindBadge kind="estimativa" compact /></p>
          <p className="num text-2xl font-semibold">{ex?.available && ex.population_total ? t("up to {0}", {"0": fmtInt(ex.population_upper_bound)}) : '—'}</p>
          <p className="text-[11.5px] text-ink-2">{ex?.available && ex.population_total
            ? t("people in {0} of {1} tracts within {2} km ({3}% of population). Upper bound, not affected people.", {"0": ex.tracts_within_radius, "1": ex.tracts_total, "2": ex.radius_km, "3": fmt1(ex.population_upper_bound_share_pct)})
            : ex?.reason}</p>
        </div>
      </div>
      {ex?.available && ex.population_total ? (
        <p className="text-[12px] text-ink-2">
          {t("More restrictive measure:")} {fmtInt(ex.population_in_tracts_with_detection_inside)} {t("people live in")} {ex.tracts_with_detection_inside} {t("tracts containing at least one detection.")}
          {' '}{sourceCopy(ex.caveat)}
        </p>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h4 className="mb-1 text-[13px] font-semibold text-ink">{t("Mapped localities (IBGE)")}</h4>
          <ProximityTable items={imp.localities?.items ?? []} kindLabel="Locality" />
          <p className="mt-1 text-[11px] text-ink-3">{sourceCopy(imp.localities?.caveat)}</p>
        </div>
        <div>
          <h4 className="mb-1 text-[13px] font-semibold text-ink">{t("Health facilities (CNES)")}</h4>
          <ProximityTable items={imp.health?.items ?? []} kindLabel="Facility" />
          <p className="mt-1 text-[11px] text-ink-3">{sourceCopy(imp.health?.caveat)}</p>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2 text-[12.5px]">
        <div>
          <h4 className="mb-1 text-[13px] font-semibold text-ink">{t("Nearest registered brigades (Censipam)")}</h4>
          {br?.available ? (
            <ul className="space-y-0.5 text-ink-2">
              {(br.items ?? []).slice(0, 4).map((b) => <li key={b.name}><span className="text-ink">{b.name.replace(/_/g, ' ')}</span> ({b.agency?.toUpperCase()}, {b.municipality}/{b.uf}): <span className="num">{fmt1(b.distance_from_centroid_km)} km</span></li>)}
              <li className="text-[11px] text-ink-3">{br.inside_territory ? t("{0} inside the territory.", {"0": br.inside_territory}) : t("No brigade is registered inside this territory.")} {sourceCopy(br.note)}</li>
            </ul>
          ) : <p className="text-ink-3">{sourceCopy(br?.reason)}</p>}
        </div>
        <div>
          <h4 className="mb-1 text-[13px] font-semibold text-ink">{t("Airstrips and landing sites (IBGE)")}</h4>
          {air?.available ? (
            <ul className="space-y-0.5 text-ink-2">
              {(air.items ?? []).map((a, i) => <li key={i}><span className="text-ink">{a.name}</span>: {sourceCopy(a.surface) || "surface not reported"}, {a.length_m ? `${fmtInt(a.length_m)} m` : t("length not reported")}{t(", use")} {sourceCopy(a.use?.toLowerCase()) || '—'}</li>)}
              {!air.items?.length && <li className="text-ink-3">{t("None inside this territory.")}</li>}
            </ul>
          ) : <p className="text-ink-3">{sourceCopy(air?.reason)}</p>}
        </div>
      </div>
      {imp.not_integrated?.length ? <p className="text-[11px] text-caution">{t("Not integrated in this version:")} {imp.not_integrated.map(sourceCopy).join('; ')}.</p> : null}
    </div>
  )
}

function FichaBody({ f }: { f: Ficha }) {
  const { locale } = useLocale()
  const region = f.region
  const b = f.brief
  const ctx = f.context
  const boundary = useBoundary(region.id)
  const det = useDetections({ region: region.id, window: '7d', products: ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'], daynight: 'all' })
  const overlap = useOverlap(region.id, 'Aqua', 'VIIRS_NOAA20_SP')
  const layers = ctx.layers?.layers ?? []
  const cz = ctx.censipam
  const wx = 'recent_analysis' in b.weather ? b.weather : null
  const pvc = wx?.historical.precip_vs_climatology?.last_14d
  const rose = wx?.recent_hourly.wind_rose_7d

  const miniLayers: MiniLayer[] = useMemo(() => [
    ...layers.filter((l) => l.items?.length).map((l) => ({ id: l.id, label: sourceCopy(l.label), geometries: l.items.map((i) => i.geometry), ...LAYER_STYLE[l.id] ?? { stroke: '#44554d' } })),
    ...(cz.events?.length ? [{ id: 'censipam', label: t("Censipam events"), geometries: cz.events.map((e) => e.geometry), stroke: '#6250d6', fill: 'rgba(98,80,214,0.16)' }] : []),
  ], [layers, cz.events, locale])
  const points = useMemo(() => (det.data?.features ?? []).map((ft) => ({ lon: ft.geometry.coordinates[0], lat: ft.geometry.coordinates[1], color: productStyle(ft.properties.p).color })), [det.data])
  const outline = useMemo(() => (boundary.data?.features ?? []).map((ft) => ft.geometry), [boundary.data])
  const viirsProducts = b.recent.products ?? []

  return (
    <div className="flex flex-col gap-6">
      {/* Mapa + resumo do nível */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] print:grid-cols-[3fr_2fr]">
        <div>
          {outline.length ? (
            <MiniMap outline={outline} layers={miniLayers} points={points}
              ariaLabel={`Map of ${region.name} with VIIRS detections over the last 7 days, official areas and Censipam events`} />
          ) : <Loading label={t("Loading territorial boundary…")} />}
          <p className="mt-1 text-[11px] text-ink-3">
            {t("Points: VIIRS NOAA-20 (amber) and NOAA-21 (blue) detections over the last 7 days.")} {det.isLoading ? t("Loading observations…") : ''}
          </p>
        </div>
        <div className="rounded-[var(--radius-panel)] bg-lichen p-4 ring-1 ring-rule">
          <p className="flex items-center gap-2 text-xs font-medium text-ink-2">{t("Exploratory screening")} <KindBadge kind="estimativa" compact /></p>
          <p className="type-title mt-1 text-2xl text-ink">{t("Investigation checklist")}</p>
          <p className="num mt-1 text-[13px] text-ink-2">{b.attention.signals_met} {t("of")} {b.attention.signals_evaluated} {t("evaluated criteria met.")}</p>
          <p className="mt-2 text-xs leading-relaxed text-ink-2">{sourceCopy(b.attention.disclaimer)}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-ink-3">{t("Area (IBGE boundary)")}</dt><dd className="num font-semibold text-ink">{fmtInt(region.area_km2)} km²</dd></div>
            <div><dt className="text-ink-3">{t("Population (2022 Census)")}</dt><dd className="num font-semibold text-ink">{ctx.population.available ? fmtInt(ctx.population.population) : '—'}</dd></div>
            <div><dt className="text-ink-3">{t("IBGE code")}</dt><dd className="num font-semibold text-ink">{region.ibge_code}</dd></div>
            <div><dt className="text-ink-3">{t("Censipam events")}</dt><dd className="num font-semibold text-ink">{cz.available ? fmtInt(cz.count) : '—'}</dd></div>
          </dl>
        </div>
      </div>

      <FichaSection n={1} title={t("What was detected?")} kind="observacao">
        <div className="grid gap-3 sm:grid-cols-3">
          {viirsProducts.map((p) => (
            <div key={p.product_id} className="rounded-[var(--radius-control)] bg-lichen/70 p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold"><span className="inline-block size-2.5 rounded-full" style={{ background: productStyle(p.product_id).color }} />{t(productStyle(p.product_id).label)}</p>
              <p className="num text-2xl font-semibold">{p.available ? fmtInt(p.count) : '—'}</p>
              <p className="num text-xs text-ink-2">{p.latest_observation_utc ? t("latest: {0}", {"0": fmtUtc(p.latest_observation_utc)}) : (p.error?.message ?? "no detections in 7 days")}</p>
              {p.latest_observation_utc && <p className="text-[11px] text-ink-3">{fmtBrt(p.latest_observation_utc)}</p>}
            </div>
          ))}
          <div className="rounded-[var(--radius-control)] bg-lichen/70 p-3">
            <p className="text-[13px] font-semibold">{t("Repeated observations")}</p>
            <p className="num text-2xl font-semibold">{fmtInt(b.persistent_cells?.length ?? 0)}</p>
            <p className="text-xs text-ink-2">{t("cells of ~11 km with detections on ≥5 recent complete days")}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-ink-3">{t("Window: last 7 days through")} {fmtUtc(f.generated_at)}{t(". Source: NASA FIRMS (VIIRS 375 m, near real time; nominal latency up to ~3 h). Each detection is a thermal-anomaly pixel, not an individual fire.")}</p>
        <h3 className="mt-5 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">{t("Fire events reported by Censipam")} <KindBadge kind="indicador_externo" compact /></h3>
        {!cz.available ? <Unavailable title={t("Censipam unavailable")}>{sourceCopy(cz.reason)}</Unavailable> : (
          <>
            <p className="num text-[13px] text-ink">{fmtInt(cz.count)} {t("events intersect this territory:")} {Object.entries(cz.by_status ?? {}).map(([k, v]) => `${v} ${sourceCopy(k.toLowerCase())}`).join(', ')}.</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12.5px]">
                <thead className="text-ink-3"><tr><th className="py-1.5 pr-3 font-medium">{t("Event")}</th><th className="pr-3 font-medium">{t("Status")}</th><th className="pr-3 font-medium">{t("Latest observation")}</th><th className="pr-3 text-right font-medium">{t("Persistence")}</th><th className="pr-3 text-right font-medium">{t("Censipam index")}</th><th className="font-medium">{t("Official areas reported by source")}</th></tr></thead>
                <tbody className="num divide-y divide-rule/60 align-top">
                  {(cz.events ?? []).slice(0, 12).map((e) => (
                    <tr key={e.id_evento}>
                      <td className="py-1.5 pr-3">{e.id_evento}</td>
                      <td className="pr-3">{sourceCopy(e.status_evento)}</td>
                      <td className="pr-3">{fmtUtc(e.dt_ultima_visao)}</td>
                      <td className="pr-3 text-right">{e.persistencia_dias} {t("days")}</td>
                      <td className="pr-3 text-right">{e.priority?.indice != null ? fmt1(e.priority.indice) : '—'}{e.priority?.variacao_percentual != null ? <span className="block text-[10.5px] text-ink-3">{e.priority.variacao_percentual > 0 ? '+' : ''}{fmt1(e.priority.variacao_percentual)}%</span> : null}</td>
                      <td className="text-[11.5px] text-ink-2">{[...e.unidade_conservacao, ...e.terra_indigena, ...e.quilombola, ...e.projeto_assentamento].slice(0, 3).join('; ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-ink-3">{t("The 12 most recently observed events.")} {sourceCopy(cz.priority_note)} {sourceCopy(cz.area_note)}</p>
            {cz.priority_error && <p className="text-[11px] text-alert">{t("External priority index unavailable:")} {sourceCopy(cz.priority_error)}</p>}
          </>
        )}
      </FichaSection>
      <FichaSection n={2} title={t("When was it observed?")} kind="observacao">
        <TimelineBlock f={f} />
      </FichaSection>
      <FichaSection n={3} title={t("Is this activity unusual?")} kind="estimativa">
        <div className="grid gap-3 md:grid-cols-2">{b.comparisons.map((c) => <ComparisonBlock key={c.product_baseline} c={c} />)}</div>
        <div className="mt-3 rounded-[var(--radius-control)] border border-rule p-3 text-[13px]">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">{t("MODIS × VIIRS comparison for this territory")} <KindBadge kind="estimativa" compact /></p>
          {overlap.isLoading ? <Loading /> : overlap.error ? <ErrorState error={overlap.error} compact /> : overlap.data && (
            <p className="mt-1 text-ink-2">
              {t("In")} {overlap.data.overlap_years[0]}–{overlap.data.overlap_years.at(-1)} ({overlap.data.comparison.months_paired} {t("paired months), VIIRS NOAA-20 recorded")}
              {' '}<strong className="num text-ink">{fmt1(overlap.data.comparison.ratio_median_active_months)}×</strong> {t("the MODIS Aqua detection count")}
              {overlap.data.comparison.ratio_iqr_active_months ? <> {t("(interquartile range")} {fmt1(overlap.data.comparison.ratio_iqr_active_months[0])}–{fmt1(overlap.data.comparison.ratio_iqr_active_months[1])})</> : null}{t("; Spearman")} {fmt2(overlap.data.comparison.spearman_rho)}.
              {overlap.data.spatial?.jaccard_median_reliable != null && <> {t("Median spatial agreement (Jaccard, grid size")} {String(overlap.data.spatial.grid_deg)}{t("°, months with ≥")} {overlap.data.spatial.min_cells_for_reliable ?? 8} {t("cells):")} {fmt2(overlap.data.spatial.jaccard_median_reliable)}.</>}
              {' '}{t("The original sensor counts remain separate. Experimental conversions are shown only with their method and uncertainty.")} <Link className="text-river underline print:no-underline" to={`/historico?regiao=${region.id}#sobreposicao`}>{t("View full analysis")}</Link>.
            </p>
          )}
        </div>
        <h3 className="mt-5 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">{t("Exploratory investigation criteria")} <KindBadge kind="estimativa" compact /></h3>
        <ul className="flex flex-col gap-2.5">
          {b.attention.signals.map((s) => (
            <li key={s.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_180px] sm:gap-4">
              <div>
                <p className="text-sm font-semibold text-ink">{sourceCopy(s.label)}</p>
                <p className="text-[12.5px] text-ink-2">{t("Criterion:")} {sourceCopy(s.rule)}</p>
                <p className="text-[11.5px] text-ink-3">{t("Uncertainty:")} {sourceCopy(s.uncertainty)}</p>
              </div>
              <p className={`num text-sm sm:text-right ${s.status === 'met' ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                {t(SIGNAL_STATUS[s.status])}{s.value ? <span className="block text-[12.5px] font-normal text-ink">{sourceCopy(s.value)}</span> : null}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11.5px] text-ink-3">{t("Screening rule:")} {sourceCopy(b.attention.level_rule)}{t(". This is not a risk index or a forecast.")}</p>
        <div className="mt-3">
          <p className="text-xs font-medium text-ink-2">{t("Supporting facts, with information type and source")}</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {b.facts.map((x) => (
              <li key={sourceCopy(x.text)} className="flex items-start gap-2 text-[13px] text-ink"><KindBadge kind={x.kind} compact /><span>{sourceCopy(x.text)} <span className="text-[11px] text-ink-3">({x.source})</span></span></li>
            ))}
          </ul>
        </div>
      </FichaSection>
      <FichaSection n={4} title={t("What environmental conditions are present?")} kind="estimativa">
        {!wx ? <Unavailable title={t("NASA POWER unavailable")}>{'reason' in b.weather ? (b.weather as { reason: string }).reason : ''}</Unavailable> : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <div><dt className="text-xs text-ink-3">{t("Maximum temperature at 2 m")}</dt><dd className="num text-xl font-semibold">{fmt1(wx.recent_analysis.latest?.T2M_MAX)} °C</dd><dd className="text-[11px] text-ink-3">{fmtDate(wx.recent_analysis.last_available_date)}</dd></div>
              <div><dt className="text-xs text-ink-3">{t("Relative humidity (7 days)")}</dt><dd className="num text-xl font-semibold">{fmt1(wx.recent_analysis.last_7d?.rh_mean_pct)}%</dd></div>
              <div><dt className="text-xs text-ink-3">{t("14-day precipitation")}</dt><dd className="num text-xl font-semibold">{fmt1(wx.recent_analysis.last_14d?.precip_total_mm)} mm</dd><dd className="text-[11px] text-ink-3">{pvc?.ratio != null ? t("{0}% of climatology 2001–2025", {"0": fmtInt(pvc.ratio * 100)}) : ''}</dd></div>
              <div><dt className="text-xs text-ink-3">{t("Wind at 10 m (7 days)")}</dt><dd className="num text-xl font-semibold">{fmt1(rose?.mean_speed_ms)} m/s</dd><dd className="text-[11px] text-ink-3">{rose?.prevailing_sector ? t("prevailing from {0} (origin)", {"0": rose.prevailing_sector}) : ''}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-ink-3">
              {t("NASA POWER reanalysis, ~50 km grid at the territorial centroid; latest available day")} {fmtDate(wx.recent_analysis.last_available_date)} ({wx.recent_analysis.latency_days} {t("days delayed). These are not local measurements.")}
            </p>
            <p className="mt-1 flex items-center gap-2 text-xs text-ink-2"><KindBadge kind="ausente" compact /> {t("Weather and fire-behavior forecasts are not integrated. No spread direction is inferred.")}</p>
          </>
        )}
      </FichaSection>
      <FichaSection n={5} title={t("Which inhabited or protected territories are nearby?")} kind="observacao">
        {ctx.population.available ? (
          <p className="text-[13px] text-ink">
            {t("Resident population:")} <strong className="num">{fmtInt(ctx.population.population)}</strong> {t("people; density")} <span className="num">{fmt1(ctx.population.density_per_km2)}</span> {t("people/km² (IBGE, 2022 Census).")}
            <span className="block text-xs text-ink-3">{sourceCopy(ctx.population.caveat)}</span>
          </p>
        ) : <Unavailable title={t("Population data unavailable")}>{sourceCopy(ctx.population.reason)}</Unavailable>}
        {!ctx.layers.available ? <Unavailable title={t("Territorial layers unavailable")}>{sourceCopy(ctx.layers.reason)}</Unavailable> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead className="text-ink-3"><tr><th className="py-1.5 pr-3 font-medium">{t("Official area")}</th><th className="pr-3 font-medium">{t("Layer (source)")}</th><th className="pr-3 text-right font-medium">{t("Within municipality")}</th><th className="pr-3 text-right font-medium">{t("% of municipality")}</th><th className="text-right font-medium">{t("VIIRS detections, 7 days")}</th></tr></thead>
              <tbody className="num divide-y divide-rule/60 align-top">
                {layers.flatMap((l) => l.available ? (l.items.length ? [...l.items.slice(0, 6).map((i) => (
                  <tr key={`${l.id}-${i.name}`}>
                    <td className="py-1.5 pr-3 text-ink">{i.name}<span className="block text-[11px] text-ink-3">{Object.entries(i.attributes).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join('; ')}</span></td>
                    <td className="pr-3 text-ink-2">{sourceCopy(l.label)}<span className="block text-[11px] text-ink-3">{l.primary_source}</span></td>
                    <td className="pr-3 text-right">{fmt1(i.area_in_territory_km2)} km²</td>
                    <td className="pr-3 text-right">{fmt1(i.share_of_territory_pct)}%</td>
                    <td className="text-right">{fmtInt(Object.values(i.detections_7d_by_product ?? {}).reduce((a, x) => a + x, 0))}</td>
                  </tr>
                )), ...(l.items.length > 6 ? [(
                  <tr key={`${l.id}-more`}>
                    <td className="py-1.5 pr-3 text-ink-2">{t("and")} {l.items.length - 6} {t("with smaller overlap")}</td>
                    <td className="pr-3 text-ink-2">{sourceCopy(l.label)}</td>
                    <td className="pr-3 text-right">{fmt1(l.items.slice(6).reduce((a, i) => a + i.area_in_territory_km2, 0))} km²</td>
                    <td className="pr-3 text-right">{fmt1(l.items.slice(6).reduce((a, i) => a + (i.share_of_territory_pct ?? 0), 0))}%</td>
                    <td className="text-right">{fmtInt(l.items.slice(6).reduce((a, i) => a + Object.values(i.detections_7d_by_product ?? {}).reduce((x, y) => x + y, 0), 0))}</td>
                  </tr>
                )] : [])] : [<tr key={l.id}><td className="py-1.5 pr-3 text-ink-3">{t("No overlaps")}</td><td className="pr-3 text-ink-2">{sourceCopy(l.label)}<span className="block text-[11px] text-ink-3">{l.primary_source}</span></td><td colSpan={3} /></tr>])
                  : [<tr key={l.id}><td className="py-1.5 pr-3"><KindBadge kind="ausente" compact /></td><td className="pr-3 text-ink-2">{sourceCopy(l.label)}</td><td colSpan={3} className="text-alert">{sourceCopy(l.reason)}</td></tr>])}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-ink-3">{sourceCopy(ctx.layers.method)} {t("Served by Censipam Panorama GeoServer. Combined NOAA-20/NOAA-21 pixels describe observations in the area; repeated observations do not represent unique fires.")}</p>
            {ctx.layers.gaps?.map((g) => <p key={sourceCopy(g)} className="text-[11px] text-caution">{sourceCopy(g)}</p>)}
          </div>
        )}
        <h3 className="mt-5 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">{t("People and infrastructure near observations")} <KindBadge kind="estimativa" compact /></h3>
        <ImpactBlock f={f} />
      </FichaSection>
      <FichaSection n={6} title={t("What needs further verification?")} kind="ausente">
        <ul className="flex flex-col gap-2">
          {f.human_review.map((h) => (
            <li key={sourceCopy(h)} className="flex gap-2.5 text-[13px] text-ink">
              <span className="mt-0.5 inline-block size-4 shrink-0 rounded-[3px] border-2 border-ink-3" aria-hidden="true" />{sourceCopy(h)}
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-[var(--radius-control)] bg-lichen/70 p-3 text-[12.5px]">
          <p className="font-semibold text-ink">{t("Regulatory context (verify in the official gazette)")}</p>
          {f.decrees.map((d) => <p key={d.id} className="mt-1 text-ink-2"><strong className="text-ink">{t("State decree no.")} {d.id}</strong> ({fmtDate(d.date)}): {sourceCopy(d.summary)} <span className="text-ink-3">{sourceCopy(d.verification)}</span></p>)}
        </div>
      </FichaSection>
      <FichaSection n={7} title={t("What evidence and limitations support this analysis?")} kind="observacao">
        <ul className="flex flex-col gap-1 break-words text-[12px] text-ink-2">
          {viirsProducts.map((p) => p.provenance && <li key={p.product_id}><strong className="text-ink">{t(productStyle(p.product_id).label)}</strong>: {p.provenance.request_urls.join(' ')}{t("; retrieved")} {fmtUtc(p.provenance.fetched_at)}; SHA-256 {p.provenance.sha256.slice(0, 16)}…</li>)}
          {b.comparisons.filter((c) => c.available).map((c) => <li key={c.product_baseline}><strong className="text-ink">{c.product_baseline}</strong>{t(": NASA FIRMS annual country archives, years")} {c.baseline!.stats.years.join(', ')} {t("(file provenance in Evidence & exports).")}</li>)}
          {wx?.recent_analysis.provenance && <li><strong className="text-ink">NASA POWER</strong>: {wx.recent_analysis.provenance.request_url}</li>}
          {ctx.population.url && <li><strong className="text-ink">IBGE Censo 2022</strong>: {ctx.population.url}</li>}
          {layers.filter((l) => l.provenance).map((l) => <li key={l.id}><strong className="text-ink">{sourceCopy(l.label)}</strong> ({l.primary_source} {t("via Censipam): retrieved")} {fmtUtc(l.provenance!.fetched_at)}</li>)}
          {cz.provenance && <li><strong className="text-ink">Censipam Painel do Fogo</strong>: {cz.provenance.events_url}{t("; retrieved")} {fmtUtc(cz.provenance.events_fetched_at)}</li>}
          <li><strong className="text-ink">{t("Territorial boundary")}</strong>{t(": IBGE boundary API v3 (maximum detail).")}</li>
          {f.impact?.localities?.url && <li><strong className="text-ink">{t("Localities")}</strong>: {f.impact.localities.source}{t("; retrieved")} {fmtUtc(f.impact.localities.fetched_at)}</li>}
          {f.impact?.health?.url && <li><strong className="text-ink">{t("Health facilities")}</strong>: {f.impact.health.url}{t("; retrieved")} {fmtUtc(f.impact.health.fetched_at)}</li>}
          {f.impact?.exposure?.source_url && <li><strong className="text-ink">{t("Census tracts")}</strong>: {f.impact.exposure.source_url} (SHA-256 {f.impact.exposure.source_sha256?.slice(0, 16)}…)</li>}
          {f.impact?.infrastructure?.airstrips?.url && <li><strong className="text-ink">{t("Airstrips")}</strong>: {f.impact.infrastructure.airstrips.source}</li>}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2 print:hidden">
          <a className="control inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium ring-1 ring-rule hover:bg-lichen" href={apiUrl('/detections/export.csv', { region: region.id, window: '7d', products: 'VIIRS_NOAA20_NRT,VIIRS_NOAA21_NRT,MODIS_NRT' })}>
            <Download className="size-3.5" aria-hidden="true" /> {t("Detections CSV (7 days)")}
          </a>
          <button type="button" onClick={() => downloadProximityCsv(f)} disabled={!f.impact?.available}
            className="control inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium ring-1 ring-rule hover:bg-lichen disabled:opacity-50">
            <Download className="size-3.5" aria-hidden="true" /> {t("Proximity CSV (localities, health facilities, census tracts)")}
          </button>
        </div>
        <details className="mt-3 text-[12.5px]" open>
          <summary className="cursor-pointer font-medium text-ink">{t("Limitations")}</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2">{f.limitations.map((l) => <li key={sourceCopy(l)}>{sourceCopy(l)}</li>)}</ul>
        </details>
      </FichaSection>
    </div>
  )
}

export default function FichaPage() {
  useLocale()
  const { regionId = 'portel' } = useParams()
  const navigate = useNavigate()
  const { region, setRegion } = useRegion()
  const regions = useRegions()
  const q = useFicha(regionId)
  useEffect(() => { if (region !== regionId) setRegion(regionId) }, [regionId]) // eslint-disable-line react-hooks/exhaustive-deps
  const regionName = regions.data?.regions.find((r) => r.id === regionId)?.name

  const downloadJson = () => {
    if (!q.data) return
    const blob = new Blob([JSON.stringify(q.data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `ficha-atencao-territorial_${regionId}_${q.data.generated_at.replace(/[:-]/g, '').slice(0, 13)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="content-page report-page print:max-w-none print:p-0">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button type="button" onClick={() => navigate(-1)} className="control inline-flex items-center gap-1.5 px-2 py-1.5 text-[13px] text-ink-2 hover:bg-lichen-deep">
          <ArrowLeft className="size-4" aria-hidden="true" /> {t("Back")}
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={downloadJson} disabled={!q.data} className="control inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium ring-1 ring-rule hover:bg-lichen disabled:opacity-50">
            <Download className="size-4" aria-hidden="true" /> {t("Download JSON")}
          </button>
          <button type="button" onClick={() => window.print()} disabled={!q.data} className="control inline-flex items-center gap-1.5 bg-canopy-900 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-canopy-800 disabled:opacity-50">
            <Printer className="size-4" aria-hidden="true" /> {t("Print or save PDF")}
          </button>
        </div>
      </div>

      <article className="panel p-5 sm:p-8 print:rounded-none print:p-0 print:shadow-none">
        <header className="mb-6 flex flex-col gap-3 border-b border-rule pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[13px] text-ink-2">{t("Territory evidence report")}</p>
            <h1 className="type-display text-[34px] text-canopy-900 sm:text-[42px]">{q.data?.region.name ?? regionName ?? regionId}</h1>
            <p className="num mt-1 text-xs text-ink-3">{q.data ? <>{t("Generated")} {fmtUtc(q.data.generated_at)} ({fmtBrt(q.data.generated_at)}{t("). Amazônia Viva research platform.")}</> : t("Generating…")}</p>
          </div>
          <ul className="flex max-w-[420px] flex-wrap gap-1.5" aria-label={t("Information types")}>
            {KIND_ORDER.map((k) => <li key={k}><KindBadge kind={k} compact /></li>)}
          </ul>
        </header>
        {q.isLoading && <Loading label={t("Gathering NASA FIRMS, historical records, NASA POWER, IBGE and Censipam…")} />}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && <ErrorBoundary label={t("Report")}><FichaBody f={q.data} /></ErrorBoundary>}
      </article>
    </div>
  )
}
