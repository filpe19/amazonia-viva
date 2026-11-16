// Alertas para Terras Indígenas: fogo dentro ou no entorno (≤ 10 km), com contexto social e boletim compartilhável.
// Regras públicas, sem pontuação; população = residentes na TI (Censo 2022), não pessoas afetadas.
import { ChevronDown, Copy, Crosshair, Focus, MessageCircle, Phone, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ErrorState, Loading } from '../../components/states'
import { fmt1, fmtAgo, fmtInt, fmtUtc } from '../../lib/format'
import { t, useLocale } from '../../lib/i18n'
import { sourceCopy } from '../../lib/sourceCopy'
import type { DetectionProps, IndigenousItem, IndigenousReport } from '../../lib/types'
import { SATELLITES, satelliteStyle, shapeSvg } from '../map/symbology'

export const TI_ALERT_STYLE: Record<IndigenousItem['alert'], { label: string; color: string }> = {
  inside_confirmed: { label: 'Fire inside · confirmed by ≥ 2 overpasses', color: '#9b0e18' },
  inside: { label: 'Fire inside · single overpass', color: '#c1121f' },
  surroundings: { label: 'Fire in the surroundings (≤ 10 km)', color: '#94511a' },
}
const toIso = (s: string) => (s.length === 17 ? s.replace('Z', ':00Z') : s)
const DETER_GROUP: Record<string, string> = { deforestation: 'recent deforestation', burn_scar: 'forest fire scar', degradation: 'degradation', selective_logging: 'selective logging', mining: 'mining' }

function satCounts(by: Record<string, number>, sats: string[]) {
  return SATELLITES.filter((s) => sats.includes(s.key) && by[s.key])
}

/** Boletim em texto simples para copiar ou enviar (WhatsApp, e-mail). Só fatos, fonte e ressalvas. */
export function bulletin(i: IndigenousItem, report: IndigenousReport): string {
  const sats = (by: Record<string, number>) => SATELLITES.filter((s) => by[s.key]).map((s) => `${s.short} ${by[s.key]}`).join(', ')
  const lines = [
    `${t('ATTENTION — fire detected by satellite')}: ${i.name}${i.country !== 'Brasil' ? ` (${i.country})` : ''}`,
    `${t(TI_ALERT_STYLE[i.alert].label)}.`,
    i.inside.count ? `${t('Inside the land')}: ${sats(i.inside.by_satellite)} (${i.inside.overpasses} ${t('overpasses')}); ${t('latest')} ${fmtUtc(i.inside.last_utc)}.` : '',
    i.surroundings.count ? `${t('Surroundings ≤ 10 km')}: ${sats(i.surroundings.by_satellite)}; ${t('nearest')} ${fmt1(i.surroundings.nearest_km)} km ${t('from the boundary')}.` : '',
    i.peoples.length ? `${t('Peoples')}: ${i.peoples.join(', ')}.` : '',
    i.population ? `${t('Indigenous residents (2022 Census)')}: ${fmtInt(i.population.indigenous)}.` : '',
    i.phase ? `${t('FUNAI phase')}: ${i.phase}${i.funai_unit?.name ? ` · ${i.funai_unit.name}` : ''}.` : '',
    i.evidence.mining?.detections_in_mining_areas ? `${t('Mining context (ANM)')}: ${i.evidence.mining.detections_in_mining_areas} ${t('detections inside mining titles')}${i.evidence.mining.detections_in_garimpo_areas ? `, ${i.evidence.mining.detections_in_garimpo_areas} ${t('in garimpo areas')}` : ''}.` : '',
    Object.entries(i.evidence.deter?.detections_by_group ?? {}).map(([g, n]) => `${n} ${t('over')} ${t(DETER_GROUP[g] ?? g)} (INPE DETER)`).join('; '),
    i.access.nearest_federal_road ? `${t('Nearest federal road')}: ${i.access.nearest_federal_road.name}, ~${fmt1(i.access.nearest_federal_road.km)} km.` : '',
    i.access.nearest_brigade ? `${t('Nearest registered brigade')}: ${i.access.nearest_brigade.name} (${i.access.nearest_brigade.agency ?? '—'}), ~${fmt1(i.access.nearest_brigade.km)} km ${t('straight line')}.` : '',
    `${t('Public channels')}: ${report.public_channels.map((c) => `${c.name} ${c.contact}`).join(' · ')}.`,
    `${t('Sources: NASA FIRMS (VIIRS/MODIS), FUNAI, IBGE Census 2022, ANM, INPE DETER, DNIT, Censipam. Platform cross-check, not an official alert; confirm on the ground.')}`,
    `Amazônia Viva · ${fmtUtc(report.generated_at)}`,
  ]
  return lines.filter(Boolean).join('\n')
}

function Card({ i, report, open, onToggle, onPick, onFrame, sats }: {
  i: IndigenousItem; report: IndigenousReport; open: boolean; onToggle: () => void; onPick: (p: DetectionProps) => void; onFrame: (i: IndigenousItem) => void; sats: string[]
}) {
  const [copied, setCopied] = useState(false)
  const st = TI_ALERT_STYLE[i.alert]
  const inside = satCounts(i.inside.by_satellite, sats)
  const around = satCounts(i.surroundings.by_satellite, sats)
  const mining = i.evidence.mining
  const deter = Object.entries(i.evidence.deter?.detections_by_group ?? {})
  const copy = async () => { try { await navigator.clipboard.writeText(bulletin(i, report)); setCopied(true); window.setTimeout(() => setCopied(false), 2000) } catch { /* sem permissão */ } }
  const refs = [...i.inside.detections, ...i.surroundings.detections].filter((d) => sats.includes(d.s))
  return (
    <li className={`ti-card ${open ? 'open' : ''}`} data-ti={i.id} style={{ borderLeftColor: st.color }}>
      <button type="button" className="ti-card-head" onClick={onToggle} aria-expanded={open}>
        <span className="ti-name">{i.name}{i.country !== 'Brasil' && <small> · {i.country}</small>}{i.recent_24h && <em className="att-new">{t('≤ 24 h')}</em>}</span>
        <span className="ti-alert" style={{ color: st.color }}>{t(st.label)}</span>
        {i.peoples.length > 0 && <span className="ti-peoples">{i.peoples.slice(0, 4).join(', ')}{i.peoples.length > 4 ? ` +${i.peoples.length - 4}` : ''}</span>}
        <span className="ti-facts">
          {i.population ? <span><Users size={12} aria-hidden="true" /><b className="num">{fmtInt(i.population.indigenous)}</b> {t('indigenous residents (2022 Census)')}</span>
            : i.country === 'Brasil' ? <span className="muted">{t('Census 2022 population not published for this land')}</span> : null}
        </span>
        <span className="att-meta">
          <span className="att-sats">{(inside.length ? inside : around).map((s) => (
            <span key={s.key}><i dangerouslySetInnerHTML={{ __html: shapeSvg(s.shape, s.color, 10) }} />{s.short} <b className="num">{(inside.length ? i.inside : i.surroundings).by_satellite[s.key]}</b></span>
          ))}</span>
          <span className="num">{i.last_utc ? fmtAgo(i.last_utc) : '—'}</span>
        </span>
        {(mining?.detections_in_mining_areas || deter.length > 0) && (
          <span className="ti-evidence">
            {mining?.detections_in_garimpo_areas ? <i className="ev-garimpo">{t('{0} in garimpo areas (ANM)', { 0: mining.detections_in_garimpo_areas })}</i>
              : mining?.detections_in_mining_areas ? <i className="ev-mining">{t('{0} in mining titles (ANM)', { 0: mining.detections_in_mining_areas })}</i> : null}
            {deter.map(([g, n]) => <i key={g} className={`ev-deter ${g}`}>{n} {t('over')} {t(DETER_GROUP[g] ?? g)}</i>)}
          </span>
        )}
        <ChevronDown size={14} className="att-chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="att-card-body">
          <dl>
            {i.inside.count > 0 && <div><dt>{t('Inside the land')}</dt><dd className="num">{SATELLITES.filter((s) => i.inside.by_satellite[s.key]).map((s) => `${s.short} ${i.inside.by_satellite[s.key]}`).join(' · ')} · {i.inside.overpasses} {t('overpasses')}</dd></div>}
            {i.surroundings.count > 0 && <div><dt>{t('Surroundings ≤ 10 km')}</dt><dd className="num">{SATELLITES.filter((s) => i.surroundings.by_satellite[s.key]).map((s) => `${s.short} ${i.surroundings.by_satellite[s.key]}`).join(' · ')} · {t('nearest')} {fmt1(i.surroundings.nearest_km)} km</dd></div>}
            <div><dt>{t('Observed')}</dt><dd className="num">{fmtUtc((i.inside.count ? i.inside : i.surroundings).first_utc)} – {fmtUtc(i.last_utc)}</dd></div>
            {i.phase && <div><dt>{t('FUNAI phase')}</dt><dd>{sourceCopy(i.phase)}{i.modality ? ` · ${sourceCopy(i.modality)}` : ''}</dd></div>}
            {i.area_ha != null && <div><dt>{t('Area')}</dt><dd className="num">{fmtInt(i.area_ha)} ha</dd></div>}
            {i.funai_unit?.name && <div><dt>{t('Responsible FUNAI unit')}</dt><dd>{i.funai_unit.name}{i.funai_unit.sigla ? ` (${i.funai_unit.sigla})` : ''}</dd></div>}
            {i.municipalities && <div><dt>{t('Municipalities')}</dt><dd>{i.municipalities}{i.ufs.length ? ` · ${i.ufs.join(', ')}` : ''}</dd></div>}
            {i.population && <div><dt>{t('Residents (2022 Census)')}</dt><dd className="num">{fmtInt(i.population.residents)} · {t('indigenous')} {fmtInt(i.population.indigenous)}</dd></div>}
            {i.access.nearest_federal_road && <div><dt>{t('Nearest federal road')}</dt><dd className="num">{i.access.nearest_federal_road.name} · ~{fmt1(i.access.nearest_federal_road.km)} km</dd></div>}
            {i.access.nearest_brigade && <div><dt>{t('Nearest registered brigade')}</dt><dd>{i.access.nearest_brigade.name} ({i.access.nearest_brigade.agency ?? '—'}) · <span className="num">~{fmt1(i.access.nearest_brigade.km)} km</span></dd></div>}
            {mining?.available && <div><dt>{t('Mining (ANM)')}</dt><dd>{mining.detections_in_mining_areas ? `${mining.detections_in_mining_areas} ${t('of')} ${i.evidence.detections_checked} ${t('detections inside mining titles')}: ${(mining.titles ?? []).map(([k, n]) => `${sourceCopy(k)} (${n})`).join('; ')}` : t('no detection inside mining titles')}{mining.partial ? ` · ${t('partial result')}` : ''}</dd></div>}
            {i.evidence.deter?.available && <div><dt>{t('INPE DETER (12 months)')}</dt><dd>{deter.length ? deter.map(([g, n]) => `${n} ${t('over')} ${t(DETER_GROUP[g] ?? g)}`).join('; ') : t('no detection over DETER warnings')}</dd></div>}
            {!i.evidence.evaluated && i.alert !== 'surroundings' && <div><dt>{t('Origin evidence')}</dt><dd>{i.country === 'Brasil' ? t('Evaluated for the 20 lands with most detections inside.') : t('ANM and DETER cover Brazil only.')}</dd></div>}
          </dl>
          <ul className="att-dets">
            {refs.slice(0, 6).map((d) => {
              const s = satelliteStyle(d.s)
              return (
                <li key={`${d.p}-${d.id}`}><button type="button" onClick={() => onPick({ id: d.id, p: d.p, s: d.s, t: d.t, frp: null, c: null, dn: 'D' })}>
                  <i dangerouslySetInnerHTML={{ __html: shapeSvg(s?.shape ?? 'circle', s?.color ?? '#444', 10) }} />{s?.short ?? d.s}
                  <span className="num">{fmtUtc(toIso(d.t))}</span><span className="num">{d.d_km != null ? `${fmt1(d.d_km)} km` : t('inside')}</span><Crosshair size={12} aria-hidden="true" />
                </button></li>
              )
            })}
          </ul>
          <div className="att-actions">
            <button type="button" className="button-secondary" onClick={() => onFrame(i)}><Focus size={13} />{t('Frame on map')}</button>
            <button type="button" className="button-secondary" onClick={copy}><Copy size={13} />{copied ? t('Copied') : t('Copy bulletin')}</button>
            <a className="button-secondary" href={`https://wa.me/?text=${encodeURIComponent(bulletin(i, report))}`} target="_blank" rel="noreferrer"><MessageCircle size={13} />WhatsApp</a>
          </div>
        </div>
      )}
    </li>
  )
}

export function IndigenousPanel({ query, sats, focusId, onFocus, onPick, onFrame }: {
  query: { data?: IndigenousReport; isLoading: boolean; isFetching: boolean; error: unknown; refetch: () => void }
  sats: string[]; focusId: string | null; onFocus: (id: string | null) => void; onPick: (p: DetectionProps) => void; onFrame: (i: IndigenousItem) => void
}) {
  useLocale()
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const r = query.data
  const items = useMemo(() => (r?.items ?? []).filter((i) => [...i.satellites].some((s) => sats.includes(s))), [r, sats])
  if (query.isLoading && !r) return <Loading label={t('Checking fire inside and around Indigenous lands (FUNAI, IBGE Census, ANM, DETER)…')} />
  if (query.error && !r) return <ErrorState error={query.error} compact onRetry={query.refetch} />
  if (!r) return null
  if (!r.available) return <p className="intel-note">{sourceCopy(r.reason ?? '')}</p>
  const s = r.summary
  const groups: IndigenousItem['alert'][] = ['inside_confirmed', 'inside', 'surroundings']
  return (
    <div className="ti-panel">
      <div className="ti-summary">
        <div><strong className="num">{fmtInt(s.lands_with_fire_inside)}</strong><span>{t('Indigenous lands with fire inside')}</span><small>{t('{0} confirmed by ≥ 2 overpasses', { 0: fmtInt(s.lands_inside_confirmed) })}</small></div>
        <div><strong className="num">{s.indigenous_residents_in_lands_with_fire_inside == null ? '—' : fmtInt(s.indigenous_residents_in_lands_with_fire_inside)}</strong><span>{t('indigenous people live in these lands')}</span><small>{t('2022 Census; residents, not people affected')}</small></div>
        <div><strong className="num">{fmtInt(s.peoples_in_lands_with_fire_inside.length)}</strong><span>{t('peoples in these lands')}</span><small>{s.peoples_in_lands_with_fire_inside.slice(0, 5).join(', ')}{s.peoples_in_lands_with_fire_inside.length > 5 ? '…' : ''}</small></div>
        <div><strong className="num">{fmtInt(s.lands_surroundings_only)}</strong><span>{t('with fire only in the surroundings (≤ 10 km)')}</span><small>{t('of {0} lands evaluated', { 0: fmtInt(s.lands_evaluated) })}</small></div>
      </div>
      {groups.map((g) => {
        const list = items.filter((i) => i.alert === g)
        if (!list.length) return null
        const all = showAll[g] || list.length <= 6
        return (
          <section key={g} className="att-group" data-ti-group={g}>
            <h4><i style={{ background: TI_ALERT_STYLE[g].color }} />{t(TI_ALERT_STYLE[g].label)}<b className="num">{list.length}</b></h4>
            <ul>{(all ? list : list.slice(0, 6)).map((i) => (
              <Card key={i.id} i={i} report={r} open={focusId === i.id} onToggle={() => onFocus(focusId === i.id ? null : i.id)} onPick={onPick} onFrame={onFrame} sats={sats} />
            ))}</ul>
            {!all && <button type="button" className="link att-more" onClick={() => setShowAll((x) => ({ ...x, [g]: true }))}>{t('Show all ({0})', { 0: list.length })}</button>}
            {g === 'surroundings' && s.items_truncated && <p className="intel-note">{t('At this scale only the 150 most recent surroundings alerts are listed.')}</p>}
          </section>
        )
      })}
      {!items.length && <p className="intel-empty">{t('No fire detected inside or within 10 km of Indigenous lands in this window. No detection does not establish that no fire occurred.')}</p>}
      <section className="ti-channels">
        <h4><Phone size={13} aria-hidden="true" />{t('Who to call')}</h4>
        <ul>{r.public_channels.map((c) => <li key={c.name}><span>{sourceCopy(c.name)}</span><b className="num">{c.contact}</b></li>)}</ul>
        <p className="intel-note">{t('Each card names the responsible FUNAI regional unit and the nearest registered brigade. Share the bulletin with them for verification.')}</p>
      </section>
      <details className="att-method">
        <summary>{t('Alert rules and sources')}</summary>
        <ul>{Object.entries(r.rules).map(([k, v]) => <li key={k}><b>{t(TI_ALERT_STYLE[k as IndigenousItem['alert']]?.label ?? (k === 'recent' ? '≤ 24 h' : k))}</b>: {sourceCopy(v)}</li>)}</ul>
        <p>{sourceCopy(r.disclaimer)}</p>
        <ul className="att-sources">{Object.entries(r.sources).map(([k, v]) => (
          <li key={k} className={v.available ? 'ok' : 'off'}><span>{sourceCopy(v.label ?? k)}</span><small>{v.available ? (v.fetched_at ? fmtUtc(v.fetched_at) : v.scope ? sourceCopy(v.scope) : '') : sourceCopy(v.reason ?? '')}</small></li>
        ))}</ul>
      </details>
    </div>
  )
}
