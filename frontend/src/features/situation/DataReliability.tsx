// Confiabilidade dos dados desta tela: estado e atualização de cada fonte usada nos alertas (veracidade visível).
import { CircleCheck, CircleSlash, ShieldCheck } from 'lucide-react'
import { fmtAgo, fmtUtc } from '../../lib/format'
import { t, useLocale } from '../../lib/i18n'
import { sourceCopy } from '../../lib/sourceCopy'
import type { DetectionsMeta, HotspotReport, IndigenousReport } from '../../lib/types'

interface Row { name: string; ok: boolean; when?: string | null; use: string; note?: string }

export function DataReliability({ meta, hotspots, indigenous, historical }: { meta?: DetectionsMeta; hotspots?: HotspotReport; indigenous?: IndigenousReport; historical?: boolean }) {
  useLocale()
  const rows: Row[] = []
  if (meta) {
    const prods = meta.products
    rows.push({ name: 'NASA FIRMS (VIIRS NOAA-20/21, MODIS)', ok: prods.every((p) => p.available), when: meta.platform_data_fetched_at,
      use: t('Detections'), note: `${prods.filter((p) => p.available).length}/${prods.length} ${t('products')} · ${t('latest observation')} ${fmtUtc(meta.latest_observation_utc)}` })
  }
  if (historical) rows.push({ name: 'NASA FIRMS — archive (standard processing)', ok: true, use: t('Study mode'), note: 'MODIS 2001–2025 · VIIRS NOAA-20 2021–2025' })
  const hs = hotspots?.sources ?? {}
  const add = (key: string, name: string, use: string) => { const v = hs[key]; if (v) rows.push({ name, ok: v.available, use, note: v.available ? (v.features != null ? `${v.features} ${t('features')}` : v.cells != null ? `${v.cells} ${t('model cells')}` : undefined) : sourceCopy(v.reason ?? '') }) }
  add('terras_indigenas', 'FUNAI — Indigenous lands (Censipam)', t('Targets'))
  add('ucs_federais', 'ICMBio — federal conservation units', t('Targets'))
  add('ucs_estaduais', 'MMA/CNUC — state conservation units', t('Targets'))
  add('quilombolas', 'INCRA — quilombola territories', t('Targets'))
  add('roads', 'DNIT — federal roads', t('Targets and access'))
  add('seats', 'IBGE — municipal seats (BC250)', t('Targets'))
  add('localities', 'IBGE — localities (BC250)', t('Targets'))
  add('brigades', 'Censipam — registered brigades', t('Access'))
  add('events', 'Censipam — fire events', t('Detection reliability'))
  add('wind', 'Open-Meteo — model wind', t('Downwind screening'))
  const ind = indigenous?.sources ?? {}
  if (ind.census) rows.push({ name: 'IBGE — 2022 Census, table 9719', ok: ind.census.available, when: ind.census.fetched_at, use: t('Residents of Indigenous lands') })
  if (ind.anm) rows.push({ name: 'ANM — SIGMINE', ok: ind.anm.available, use: t('Mining evidence'), note: ind.anm.scope ? sourceCopy(ind.anm.scope) : undefined })
  if (ind.deter) rows.push({ name: 'INPE — DETER', ok: ind.deter.available, use: t('Deforestation evidence') })
  if (!rows.length) return null
  const ok = rows.filter((r) => r.ok).length
  return (
    <details className="reliability">
      <summary><ShieldCheck size={14} aria-hidden="true" />{t('Data reliability')}: <b>{t('{0} of {1} sources responding', { 0: ok, 1: rows.length })}</b>
        {meta?.platform_data_fetched_at && <span> · {t('FIRMS synced')} {fmtAgo(meta.platform_data_fetched_at)}</span>}</summary>
      <table>
        <thead><tr><th>{t('Source')}</th><th>{t('Status')}</th><th>{t('Used for')}</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.name} className={r.ok ? 'ok' : 'off'}>
            <th scope="row">{t(r.name)}{r.note && <small>{r.note}</small>}</th>
            <td>{r.ok ? <><CircleCheck size={12} aria-hidden="true" />{t('responding')}</> : <><CircleSlash size={12} aria-hidden="true" />{t('unavailable')}</>}{r.when && <small>{fmtUtc(r.when)}</small>}</td>
            <td>{r.use}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="intel-note">{t('Every number on this tab comes from these sources at the time shown. Unavailable sources are never shown as zero; checks are listed in the consistency report.')}</p>
    </details>
  )
}
