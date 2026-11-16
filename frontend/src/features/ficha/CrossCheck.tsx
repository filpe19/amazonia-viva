// Ficha: cruzamento espacial das detecções (4 satélites, 7 dias) com territórios oficiais, pessoas e avisos DETER.
// Proporções por satélite normalizam cada sensor pelo próprio total: comparáveis entre sensores (contagens não são).
import { Fragment } from 'react'
import { KindBadge } from '../../components/KindBadge'
import { ErrorState, Loading, Unavailable } from '../../components/states'
import { fmt1, fmtDate, fmtInt, fmtUtc } from '../../lib/format'
import { t, useLocale } from '../../lib/i18n'
import { sourceCopy } from '../../lib/sourceCopy'
import type { AttentionReport, AttentionSignal, IndigenousReport } from '../../lib/types'
import { TI_ALERT_STYLE } from '../situation/IndigenousPanel'
import { SATELLITES, shapeSvg } from '../map/symbology'
import { ATTENTION_CATEGORY, DETER_LABEL } from '../situation/AttentionTab'

const ROWS: { cat: string; unit: string }[] = [
  { cat: 'indigenous', unit: 'Indigenous lands' },
  { cat: 'conservation', unit: 'conservation units' },
  { cat: 'quilombola', unit: 'quilombola territories' },
  { cat: 'settlement', unit: 'settlements' },
  { cat: 'locality', unit: 'localities' },
  { cat: 'health', unit: 'health facilities' },
  { cat: 'deter_deforestation', unit: 'DETER polygons' },
  { cat: 'deter_burn_scar', unit: 'DETER polygons' },
  { cat: 'deter_degradation', unit: 'DETER polygons' },
  { cat: 'deter_selective_logging', unit: 'DETER polygons' },
  { cat: 'deter_mining', unit: 'DETER polygons' },
]

function uniqueBySat(signals: AttentionSignal[]) {
  const ids: Record<string, Set<string>> = {}
  for (const s of signals) for (const d of s.detections) (ids[d.s] ??= new Set()).add(`${d.p}|${d.id}`)
  return Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.size]))
}

export function CrossCheckBlock({ query }: { query: { data?: AttentionReport; isLoading: boolean; error: unknown; refetch: () => void } }) {
  useLocale()
  const a = query.data
  if (query.isLoading && !a) return <Loading label={t('Cross-checking detections with territories, communities and DETER…')} />
  if (query.error && !a) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!a) return null
  if (!a.available) return <Unavailable title={t('Cross-check unavailable')}>{sourceCopy(a.reason ?? '')}</Unavailable>
  const main = a.signals.filter((s) => s.relation !== 'near')
  const totals = a.detections_considered.by_satellite
  const truncated = main.some((s) => s.detections_truncated)
  const protectedSignals = main.filter((s) => ['indigenous', 'conservation', 'quilombola'].includes(s.category))
  const protectedBy = uniqueBySat(protectedSignals)
  const rows = ROWS.map((r) => {
    const list = main.filter((s) => s.category === r.cat)
    return { ...r, list, by: uniqueBySat(list), last: list.map((s) => s.last_utc ?? '').sort().at(-1) }
  }).filter((r) => r.list.length)
  const maxShare = Math.max(0.01, ...rows.flatMap((r) => SATELLITES.map((s) => (totals[s.key] ? (r.by[s.key] ?? 0) / totals[s.key] : 0))))
  const env = a.summary.environment
  const insideNames = protectedSignals.slice(0, 8)
  return (
    <div className="crosscheck flex flex-col gap-4">
      <p className="rounded-[var(--radius-control)] bg-caution-soft p-3 text-[12.5px] text-ink">
        <strong>{t('Spatial coincidence, not damage or cause.')}</strong> {t('Detections from the last 7 days by all four satellites, clipped to the IBGE boundary, crossed with official polygons, IBGE localities, CNES facilities and INPE DETER warnings. Criteria are fixed and public; none is an official alert.')}
      </p>

      <div className="grid gap-3 sm:grid-cols-4">
        {SATELLITES.map((s) => {
          const n = totals[s.key] ?? 0
          const inP = protectedBy[s.key] ?? 0
          return (
            <div key={s.key} className="rounded-[var(--radius-control)] bg-lichen/70 p-3">
              <p className="flex items-center gap-1.5 text-[12.5px] font-semibold"><span dangerouslySetInnerHTML={{ __html: shapeSvg(s.shape, s.color, 12) }} />{s.label}</p>
              <p className="num text-2xl font-semibold">{n ? `${fmt1((100 * inP) / n)}%` : '—'}</p>
              <p className="text-[11.5px] text-ink-2">{n ? t('{0} of {1} detections inside protected areas or Indigenous/quilombola lands', { 0: fmtInt(inP), 1: fmtInt(n) }) : t('no detections in 7 days')}</p>
            </div>
          )
        })}
      </div>
      <p className="-mt-2 text-[11.5px] text-ink-3">{t('Harmonized comparison: each share divides a satellite’s detections by its own total, which removes most of the sensitivity difference between VIIRS (375 m) and MODIS (1 km). Raw counts are never added across satellites.')}</p>

      <div className="overflow-x-auto">
        <table className="crosscheck-table w-full min-w-[720px] text-left text-[12.5px]">
          <caption className="sr-only">{t('Detections meeting each criterion, by satellite')}</caption>
          <thead className="text-ink-3"><tr>
            <th className="py-1.5 pr-3 font-medium">{t('Criterion')}</th>
            <th className="pr-3 text-right font-medium">{t('Targets')}</th>
            {SATELLITES.map((s) => <th key={s.key} className="pr-3 font-medium"><span className="inline-flex items-center gap-1"><span dangerouslySetInnerHTML={{ __html: shapeSvg(s.shape, s.color, 10) }} />{s.short}</span></th>)}
            <th className="text-right font-medium">{t('Latest')}</th>
          </tr></thead>
          <tbody className="num divide-y divide-rule/60 align-middle">
            {rows.map((r) => (
              <tr key={r.cat}>
                <td className="py-2 pr-3 text-ink"><span className="inline-flex items-center gap-2"><i className="inline-block size-2.5 rounded-[2px]" style={{ background: ATTENTION_CATEGORY[r.cat]?.color }} />{t(ATTENTION_CATEGORY[r.cat]?.label ?? r.cat)}</span></td>
                <td className="pr-3 text-right">{fmtInt(r.cat.startsWith('deter_') ? r.list.reduce((n, x) => n + (x.target.polygons_hit ?? 0), 0) : r.list.length)} <span className="text-[10.5px] text-ink-3">{t(r.unit)}</span></td>
                {SATELLITES.map((s) => {
                  const n = r.by[s.key] ?? 0
                  const share = totals[s.key] ? n / totals[s.key] : 0
                  return (
                    <td key={s.key} className="pr-3">
                      <div className="flex items-center gap-1.5">
                        <span className="cc-bar" style={{ width: `${Math.max(n ? 3 : 0, (share / maxShare) * 54)}px`, background: s.color }} aria-hidden="true" />
                        <span>{n ? fmtInt(n) : '—'}</span>{n > 0 && <span className="text-[10.5px] text-ink-3">{fmt1(share * 100)}%</span>}
                      </div>
                    </td>
                  )
                })}
                <td className="text-right text-[11.5px] text-ink-2">{r.last ? fmtUtc(r.last) : '—'}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-2 text-ink-3">{t('No detection met the criteria in the last 7 days. Absence of detection does not establish absence of fire.')}</td></tr>}
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-ink-3">{t('Cells: distinct detections of that satellite meeting the criterion, and the share of that satellite’s detections in the territory. A detection can meet several criteria.')}{truncated ? ` ${t('Some lists were truncated; counts are lower bounds.')}` : ''}</p>
      </div>

      {insideNames.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[14px] font-semibold text-ink">{t('Official territories with detections inside')}</h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {insideNames.map((s) => (
              <li key={s.id} className="rounded-[var(--radius-control)] border border-rule p-2 text-[12.5px]">
                <p className="font-semibold text-ink">{s.target.name}</p>
                <p className="text-[11px] text-ink-3">{sourceCopy(s.target.layer_label ?? '')} · {s.target.source}</p>
                <p className="num mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-ink-2">{SATELLITES.filter((x) => s.by_satellite[x.key]).map((x) => <span key={x.key}>{x.short} {s.by_satellite[x.key]}</span>)}<span className="text-ink-3">· {t('latest')} {fmtUtc(s.last_utc)}</span></p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-1.5 flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink">{t('Forest change mapped by INPE (DETER, last 12 months)')} <KindBadge kind="indicador_externo" compact /></h3>
        {!env.deter_available ? <Unavailable title={t('DETER unavailable')}>{sourceCopy(a.sources.deter?.reason ?? '')}</Unavailable> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[12.5px]">
                <thead className="text-ink-3"><tr><th className="py-1.5 pr-3 font-medium">{t('DETER class')}</th><th className="pr-3 text-right font-medium">{t('Polygons')}</th><th className="pr-3 text-right font-medium">{t('Area in municipality')}</th><th className="text-right font-medium">{t('Latest image')}</th></tr></thead>
                <tbody className="num divide-y divide-rule/60">
                  {env.classes.map((c) => (
                    <Fragment key={c.class}><tr>
                      <td className="py-1.5 pr-3 text-ink">{t(DETER_LABEL[c.class] ?? c.label)}</td>
                      <td className="pr-3 text-right">{fmtInt(c.polygons)}</td>
                      <td className="pr-3 text-right">{fmt1(c.area_km2)} km²</td>
                      <td className="text-right">{fmtDate(c.latest_view_date)}</td>
                    </tr></Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12.5px] text-ink">{t('{0} detections from the last 7 days fall inside DETER polygons', { 0: fmtInt(env.detections_over_deter) })}: {SATELLITES.filter((s) => env.detections_over_deter_by_satellite?.[s.key]).map((s) => `${s.short} ${env.detections_over_deter_by_satellite![s.key]}`).join(' · ') || '—'}.</p>
            <p className="text-[11.5px] text-ink-3">{t('Burning on recently cleared land is a known pattern, but coincidence does not prove cause. DETER is an enforcement warning system (not the official PRODES rate), covers the forest mask only and is delayed by clouds.')} {a.sources.deter?.url && <a className="underline" href={a.sources.deter.url} target="_blank" rel="noreferrer">{t('DETER query')}</a>}</p>
          </>
        )}
      </div>
      <p className="text-[11px] text-ink-3">{t('Method: azimuthal equidistant projection centred on the territory and an STRtree spatial index (shapely); detections from all four satellites clipped by the IBGE boundary.')} {t('Generated')} {fmtUtc(a.generated_at)}.</p>
    </div>
  )
}

/** Ficha: terras indígenas com fogo dentro ou no entorno (≤ 10 km), com população do Censo 2022 e indícios de origem. */
export function IndigenousTable({ query }: { query: { data?: IndigenousReport; isLoading: boolean; error: unknown; refetch: () => void } }) {
  useLocale()
  const r = query.data
  if (query.isLoading && !r) return <Loading label={t('Checking fire inside and around Indigenous lands (FUNAI, IBGE Census, ANM, DETER)…')} />
  if (query.error && !r) return <ErrorState error={query.error} onRetry={query.refetch} />
  if (!r || !r.available) return <Unavailable title={t('Indigenous land alerts unavailable')}>{sourceCopy(r?.reason ?? '')}</Unavailable>
  if (!r.items.length) return <p className="text-[12.5px] text-ink-3">{t('No fire detected inside or within 10 km of Indigenous lands in the last 7 days. No detection does not establish that no fire occurred.')}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-[12.5px]" data-ficha-ti>
        <thead className="text-ink-3"><tr>
          <th className="py-1.5 pr-3 font-medium">{t('Indigenous land')}</th><th className="pr-3 font-medium">{t('Alert')}</th>
          <th className="pr-3 text-right font-medium">{t('Indigenous residents (2022 Census)')}</th><th className="pr-3 font-medium">{t('Detections inside · surroundings')}</th>
          <th className="pr-3 font-medium">{t('Origin evidence')}</th><th className="font-medium">{t('Responsible FUNAI unit')}</th>
        </tr></thead>
        <tbody className="divide-y divide-rule/60 align-top">
          {r.items.slice(0, 12).map((i) => {
            const mining = i.evidence.mining
            const deter = Object.entries(i.evidence.deter?.detections_by_group ?? {})
            return (
              <tr key={i.id}>
                <td className="py-1.5 pr-3 text-ink"><strong>{i.name}</strong><span className="block text-[11px] text-ink-3">{i.peoples.slice(0, 4).join(', ')}{i.phase ? ` · ${i.phase}` : ''}</span></td>
                <td className="pr-3 text-[11.5px] font-semibold" style={{ color: TI_ALERT_STYLE[i.alert].color }}>{t(TI_ALERT_STYLE[i.alert].label)}</td>
                <td className="num pr-3 text-right">{i.population ? fmtInt(i.population.indigenous) : '—'}</td>
                <td className="num pr-3 text-[11.5px]">{SATELLITES.filter((s) => i.inside.by_satellite[s.key]).map((s) => `${s.short} ${i.inside.by_satellite[s.key]}`).join(' · ') || '—'}
                  {i.surroundings.count > 0 && <span className="block text-ink-3">{t('surroundings')}: {SATELLITES.filter((s) => i.surroundings.by_satellite[s.key]).map((s) => `${s.short} ${i.surroundings.by_satellite[s.key]}`).join(' · ')} · {fmt1(i.surroundings.nearest_km)} km</span>}</td>
                <td className="pr-3 text-[11.5px] text-ink-2">{[
                  mining?.detections_in_garimpo_areas ? t('{0} in garimpo areas (ANM)', { 0: mining.detections_in_garimpo_areas }) : mining?.detections_in_mining_areas ? t('{0} in mining titles (ANM)', { 0: mining.detections_in_mining_areas }) : '',
                  ...deter.map(([g, n]) => `${n} DETER ${t(g === 'deforestation' ? 'recent deforestation' : g === 'burn_scar' ? 'forest fire scar' : g)}`),
                ].filter(Boolean).join('; ') || (i.evidence.evaluated ? t('none in ANM or DETER') : '—')}</td>
                <td className="text-[11.5px] text-ink-2">{i.funai_unit?.name ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-ink-3">{sourceCopy(r.summary.residents_note)} {t('Alert rules: fire inside confirmed by ≥ 2 overpasses; single overpass; or only in the surroundings (≤ 10 km). Not official alerts.')}</p>
    </div>
  )
}
