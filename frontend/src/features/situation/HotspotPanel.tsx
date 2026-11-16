// "Focos e impacto": agrupamentos de detecções com proporção, vento (modelo), alvos no caminho, confiabilidade e grau.
// Escadas de regras públicas; "a favor do vento" é triagem geométrica, não previsão de propagação.
import { ArrowUp, ChevronDown, Copy, Crosshair, Focus, MessageCircle, Navigation } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ErrorState, Loading } from '../../components/states'
import { fmt1, fmtAgo, fmtDate, fmtInt, fmtUtc, monthNames } from '../../lib/format'
import { t, useLocale } from '../../lib/i18n'
import { sourceCopy } from '../../lib/sourceCopy'
import type { DetectionProps, HotspotItem, HotspotReport, HotspotTarget } from '../../lib/types'
import { SATELLITES, satelliteStyle, shapeSvg } from '../map/symbology'

export const LEVEL_STYLE: Record<HotspotItem['level'], { label: string; color: string }> = {
  alto: { label: 'High alert', color: '#9b0e18' },
  moderado: { label: 'Moderate alert', color: '#b83d0b' },
  baixo: { label: 'Low alert', color: '#5c6b63' },
  sem_alvo: { label: 'No mapped target within 10 km', color: '#adb5bd' },
}
const VERACITY: Record<HotspotItem['veracity'], { label: string; cls: string }> = {
  alta: { label: 'High detection reliability', cls: 'v-high' },
  media: { label: 'Medium detection reliability', cls: 'v-mid' },
  baixa: { label: 'Low detection reliability', cls: 'v-low' },
}
const TYPE_LABEL: Record<string, string> = { city: 'City', locality: 'Locality', indigenous: 'Indigenous land', conservation: 'Conservation unit', quilombola: 'Quilombola territory', road: 'Federal road' }
const toIso = (s: string) => (s.length === 17 ? s.replace('Z', ':00Z') : s)
const SECTOR_EN: Record<string, string> = { N: 'N', NE: 'NE', L: 'E', SE: 'SE', S: 'S', SO: 'SW', O: 'W', NO: 'NW' }
const OPPOSITE: Record<string, string> = { N: 'S', NE: 'SO', L: 'O', SE: 'NO', S: 'N', SO: 'NE', O: 'L', NO: 'SE' }

function sec(s: string, locale: string) { return locale === 'pt-BR' ? s : SECTOR_EN[s] ?? s }

function reasonText(r: HotspotItem['level_reasons'][number]): string {
  const p = r.params as Record<string, never>
  if (r.id === 'confirmed') return t('Confirmed: {0} overpasses by {1} satellite(s)', { 0: p.overpasses, 1: p.satellites })
  if (r.id === 'inside') return t('Inside: {0}', { 0: (p.names as string[]).join(', ') })
  if (r.id === 'close_people') return t('People within {0} km: {1}', { 0: p.km, 1: (p.names as string[]).join(', ') })
  if (r.id === 'downwind') return t('Downwind within {0} km: {1}', { 0: p.km, 1: (p.names as string[]).join(', ') })
  return r.id
}

function TargetChip({ tg, locale }: { tg: HotspotTarget; locale: string }) {
  return <li className={`hs-target t-${tg.type} ${tg.downwind ? 'down' : ''}`}><b>{tg.name}</b><span>{t(TYPE_LABEL[tg.type] ?? tg.type)} · {tg.inside ? t('inside') : `${fmt1(tg.km)} km ${sec(tg.sector, locale)}`}</span></li>
}


const TARGET_COLOR: Record<string, string> = { city: '#0f2e25', locality: '#56645c', indigenous: '#8a3b12', conservation: '#1a7a52', quilombola: '#7a4b9e', road: '#7d5a2c' }

/** Radar de impacto: foco no centro, norte para cima, anéis de 5/10/20 km, setor a favor do vento e alvos por direção e distância. */
export function ImpactRadar({ i, locale }: { i: HotspotItem; locale: string }) {
  const S = 236, C = S / 2, R = 100, MAXKM = 20
  const pos = (km: number, deg: number) => { const r = (Math.min(km, MAXKM) / MAXKM) * R; const a = (deg * Math.PI) / 180; return [C + r * Math.sin(a), C - r * Math.cos(a)] as const }
  const all = [...i.targets.inside, ...i.targets.downwind, ...i.targets.near]
  const wedge = i.wind ? (() => { const pts = [`${C},${C}`]; for (let a = i.wind.toward_deg - 30; a <= i.wind.toward_deg + 30; a += 5) { const [x, y] = pos(MAXKM, a); pts.push(`${x.toFixed(1)},${y.toFixed(1)}`) } return pts.join(' ') })() : null
  const arrow = i.wind ? pos(7, i.wind.toward_deg) : null
  const types = [...new Set(all.map((x) => x.type))]
  const cardinal = locale === 'pt-BR' ? ['N', 'L', 'S', 'O'] : ['N', 'E', 'S', 'W']
  return (
    <figure className="hs-radar" aria-label={t('Impact radar: hotspot at the centre, targets by direction and distance, model wind sector')}>
      <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="img">
        {wedge && <polygon points={wedge} fill="#d9480f" fillOpacity={0.13} stroke="#d9480f" strokeDasharray="3 2" strokeWidth={1} />}
        {[5, 10, 20].map((km) => <circle key={km} cx={C} cy={C} r={(km / MAXKM) * R} fill="none" stroke="#9aa79f" strokeDasharray="2 3" strokeWidth={0.8} />)}
        {[5, 10, 20].map((km) => <text key={`l${km}`} x={C + 2} y={C + (km / MAXKM) * R - 2} fontSize={8.5} fill="#6b7a72">{km} km</text>)}
        <line x1={C} y1={C - R - 4} x2={C} y2={C + R + 4} stroke="#e3e9e4" strokeWidth={0.6} /><line x1={C - R - 4} y1={C} x2={C + R + 4} y2={C} stroke="#e3e9e4" strokeWidth={0.6} />
        {cardinal.map((c, k) => { const [x, y] = pos(MAXKM + 2.4, k * 90); return <text key={c} x={x} y={y + 3} fontSize={10} fontWeight={700} textAnchor="middle" fill="#44554d">{c}</text> })}
        {arrow && <><line x1={C} y1={C} x2={arrow[0]} y2={arrow[1]} stroke="#a63a08" strokeWidth={2.4} markerEnd="url(#hs-arrow)" /></>}
        <defs><marker id="hs-arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#a63a08" /></marker></defs>
        {all.map((x, k) => {
          const [px, py] = pos(x.inside ? 0.6 : x.km, x.bearing_deg)
          const col = TARGET_COLOR[x.type] ?? '#26352e'
          const beyond = x.km > MAXKM
          return (
            <g key={`${x.type}-${x.name}-${k}`}>
              {x.downwind && <circle cx={px} cy={py} r={8} fill="none" stroke="#d9480f" strokeWidth={1.6} />}
              {x.type === 'road' ? <rect x={px - 4} y={py - 4} width={8} height={8} transform={`rotate(45 ${px} ${py})`} fill={col} stroke="#fff" strokeWidth={1} />
                : x.type === 'city' ? <path d={`M${px},${py - 6} L${px + 1.8},${py - 1.8} L${px + 6},${py - 1.6} L${px + 2.6},${py + 1.4} L${px + 3.8},${py + 5.8} L${px},${py + 3.2} L${px - 3.8},${py + 5.8} L${px - 2.6},${py + 1.4} L${px - 6},${py - 1.6} L${px - 1.8},${py - 1.8} z`} fill={beyond ? '#fff' : col} stroke={col} strokeWidth={1} />
                : <circle cx={px} cy={py} r={x.type === 'locality' ? 3.6 : 5} fill={col} stroke="#fff" strokeWidth={1} />}
              <title>{`${x.name} · ${t(TYPE_LABEL[x.type] ?? x.type)} · ${x.inside ? t('inside') : `${fmt1(x.km)} km`}${x.downwind ? ` · ${t('downwind')}` : ''}`}</title>
            </g>
          )
        })}
        <circle cx={C} cy={C} r={6.5} fill={LEVEL_STYLE[i.level].color} stroke="#fff" strokeWidth={2} />
      </svg>
      <figcaption>
        {types.map((ty) => <span key={ty}><i style={{ background: TARGET_COLOR[ty] ?? '#26352e' }} />{t(TYPE_LABEL[ty] ?? ty)}</span>)}
        {i.wind && <span><i className="wedge" />{t('Downwind sector (model wind)')}</span>}
        <span><i className="ring" />{t('Downwind target')}</span>
      </figcaption>
    </figure>
  )
}

export function hotspotBulletin(i: HotspotItem, r: HotspotReport, locale: string): string {
  const sats = SATELLITES.filter((s) => i.proportion.by_satellite[s.key]).map((s) => `${s.short} ${i.proportion.by_satellite[s.key]}`).join(', ')
  const tl = (x: HotspotTarget) => `${x.name} (${t(TYPE_LABEL[x.type] ?? x.type)}, ${x.inside ? t('inside') : `${fmt1(x.km)} km ${sec(x.sector, locale)}`})`
  return [
    `${t(LEVEL_STYLE[i.level].label).toUpperCase()} — ${t('satellite fire hotspot')} (${i.centroid[1].toFixed(4)}, ${i.centroid[0].toFixed(4)})`,
    `${t(VERACITY[i.veracity].label)}. ${t('Pixels')}: ${sats}; ${i.proportion.overpasses} ${t('overpasses')}; ${t('latest')} ${fmtUtc(i.proportion.last_utc)}.`,
    `${t('Area covered by the pixels')}: ~${fmt1(i.proportion.area_km2)} km² (${t('not burned area')})${i.proportion.frp_latest_pass_mw != null ? `; FRP ${fmt1(i.proportion.frp_latest_pass_mw)} MW` : ''}.`,
    i.wind ? `${t('Wind (model)')}: ${fmt1(i.wind.speed_ms)} m/s ${t('blowing toward')} ${sec(['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(i.wind.toward_deg / 45) % 8], locale)}.` : '',
    i.targets.inside.length ? `${t('Inside')}: ${i.targets.inside.map(tl).join('; ')}.` : '',
    i.targets.downwind.length ? `${t('Downwind (≤ 20 km)')}: ${i.targets.downwind.map(tl).join('; ')}.` : '',
    i.targets.near.length ? `${t('Nearby')}: ${i.targets.near.slice(0, 5).map(tl).join('; ')}.` : '',
    i.access.nearest_federal_road ? `${t('Nearest federal road')}: ${i.access.nearest_federal_road.name}, ~${fmt1(i.access.nearest_federal_road.km)} km.` : '',
    i.access.nearest_brigade ? `${t('Nearest registered brigade')}: ${i.access.nearest_brigade.name} (${i.access.nearest_brigade.agency ?? '—'}), ~${fmt1(i.access.nearest_brigade.km)} km.` : '',
    i.censipam_event ? `Censipam: ${t('event')} ${i.censipam_event.id} (${sourceCopy(i.censipam_event.status)}).` : '',
    `${t('Public rules; not an official alert and not a fire-spread forecast. Confirm on the ground.')} Amazônia Viva · ${fmtUtc(r.generated_at)}`,
  ].filter(Boolean).join('\n')
}

function Card({ i, r, open, onToggle, onPick, onFrame, sats }: { i: HotspotItem; r: HotspotReport; open: boolean; onToggle: () => void; onPick: (p: DetectionProps) => void; onFrame: (i: HotspotItem) => void; sats: string[] }) {
  const { locale } = useLocale()
  const [copied, setCopied] = useState(false)
  const st = LEVEL_STYLE[i.level]
  const p = i.proportion
  const places = [...i.targets.inside, ...i.targets.downwind, ...i.targets.near].filter((x) => x.type === 'city' || x.type === 'locality').sort((a, b) => a.km - b.km)
  const nearestCity = places.find((x) => x.type === 'city' && x.km <= 15) ?? places[0]
  const copy = async () => { try { await navigator.clipboard.writeText(hotspotBulletin(i, r, locale)); setCopied(true); window.setTimeout(() => setCopied(false), 2000) } catch { /* sem permissão */ } }
  return (
    <li className={`ti-card hs-card ${open ? 'open' : ''}`} data-hotspot={i.id} style={{ borderLeftColor: st.color }}>
      <button type="button" className="ti-card-head" onClick={onToggle} aria-expanded={open}>
        <span className="ti-name">{nearestCity ? t('{0} km {1} of {2}', { 0: fmt1(nearestCity.km), 1: sec(OPPOSITE[nearestCity.sector] ?? nearestCity.sector, locale), 2: nearestCity.name }) : `${i.centroid[1].toFixed(3)}, ${i.centroid[0].toFixed(3)}`}
          <em className={`hs-ver ${VERACITY[i.veracity].cls}`}>{t(VERACITY[i.veracity].label)}</em></span>
        <span className="ti-alert" style={{ color: st.color }}>{t(st.label)}</span>
        <span className="hs-prop num">{fmtInt(p.pixels)} {t('pixels')} · {p.overpasses} {t('overpasses')} · ~{fmt1(p.area_km2)} km²{p.frp_latest_pass_mw != null ? ` · ${fmt1(p.frp_latest_pass_mw)} MW` : ''}</span>
        {i.wind && <span className="hs-wind"><ArrowUp size={13} style={{ transform: `rotate(${i.wind.toward_deg}deg)` }} aria-hidden="true" />{t('Wind {0} m/s toward {1}', { 0: fmt1(i.wind.speed_ms), 1: sec(['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(i.wind.toward_deg / 45) % 8], locale) })}</span>}
        {(i.targets.inside.length > 0 || i.targets.downwind.length > 0) && <ul className="hs-targets">{[...i.targets.inside, ...i.targets.downwind].slice(0, 4).map((x, k) => <TargetChip key={`${x.type}-${x.name}-${k}`} tg={x} locale={locale} />)}</ul>}
        <span className="att-meta"><span className="att-sats">{SATELLITES.filter((s) => sats.includes(s.key) && p.by_satellite[s.key]).map((s) => (
          <span key={s.key}><i dangerouslySetInnerHTML={{ __html: shapeSvg(s.shape, s.color, 10) }} />{s.short} <b className="num">{p.by_satellite[s.key]}</b></span>))}</span>
          <span className="num">{r.historical ? fmtDate(p.last_utc) : fmtAgo(p.last_utc)}</span></span>
        <ChevronDown size={14} className="att-chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="att-card-body">
          <ImpactRadar i={i} locale={locale} />
          <ul className="hs-reasons">{i.level_reasons.map((x) => <li key={x.id}>{reasonText(x)}</li>)}</ul>
          <dl>
            <div><dt>{t('Observed')}</dt><dd className="num">{fmtUtc(p.first_utc)} – {fmtUtc(p.last_utc)} ({fmt1(p.duration_h)} h)</dd></div>
            {p.displacement && <div><dt>{t('Observed shift')}</dt><dd>{t('{0} km toward {1} in {2} h (between first and latest overpass; not a forecast)', { 0: fmt1(p.displacement.km), 1: sec(p.displacement.toward_sector, locale), 2: fmt1(p.displacement.hours) })}</dd></div>}
            {i.wind && <div><dt>{t('Wind (model)')}</dt><dd>{t('{0} m/s from {1}°, gusts {2} m/s', { 0: fmt1(i.wind.speed_ms), 1: Math.round(i.wind.from_deg), 2: fmt1(i.wind.gusts_ms) })} · {t('next 6 h')}: {i.wind.next_hours.map((h) => `${Math.round(h.from_deg)}°`).join(' ')}</dd></div>}
            {i.censipam_event && <div><dt>Censipam</dt><dd>{t('Event {0} · {1} · {2} days', { 0: i.censipam_event.id, 1: sourceCopy(i.censipam_event.status), 2: i.censipam_event.persistence_days ?? '—' })}</dd></div>}
            {i.recurrence && <div><dt>{t('History here')}</dt><dd>{i.recurrence.years_with_detection ? t('MODIS detected fire within 1 km in {0} of the archive years in {1} (latest {2})', { 0: i.recurrence.years_with_detection, 1: monthNames()[i.recurrence.month - 1], 2: i.recurrence.last_year ?? '—' }) : t('No MODIS detection within 1 km in {0} of past years: unusual place for fire this month', { 0: monthNames()[i.recurrence.month - 1] })}</dd></div>}
            {i.access.nearest_federal_road && <div><dt>{t('Nearest federal road')}</dt><dd className="num">{i.access.nearest_federal_road.name} · {fmt1(i.access.nearest_federal_road.km)} km {sec(i.access.nearest_federal_road.sector, locale)}</dd></div>}
            {i.access.nearest_brigade && <div><dt>{t('Nearest registered brigade')}</dt><dd>{i.access.nearest_brigade.name} ({i.access.nearest_brigade.agency ?? '—'}) · <span className="num">{fmt1(i.access.nearest_brigade.km)} km</span></dd></div>}
          </dl>
          {i.targets.near.length > 0 && <><h5 className="hs-h5">{t('Nearby (not downwind)')}</h5><ul className="hs-targets">{i.targets.near.slice(0, 8).map((x, k) => <TargetChip key={`${x.type}-${x.name}-${k}`} tg={x} locale={locale} />)}</ul></>}
          <ul className="att-dets">{i.detections.filter((d) => sats.includes(d.s)).slice(0, 5).map((d) => {
            const s = satelliteStyle(d.s)
            return <li key={`${d.p}-${d.id}`}><button type="button" onClick={() => onPick({ id: d.id, p: d.p, s: d.s, t: d.t, frp: null, c: null, dn: 'D' })} disabled={r.historical}>
              <i dangerouslySetInnerHTML={{ __html: shapeSvg(s?.shape ?? 'circle', s?.color ?? '#444', 10) }} />{s?.short ?? d.s}<span className="num">{fmtUtc(toIso(d.t))}</span><span /><Crosshair size={12} aria-hidden="true" />
            </button></li>
          })}</ul>
          <div className="att-actions">
            <button type="button" className="button-secondary" onClick={() => onFrame(i)}><Focus size={13} />{t('Frame on map')}</button>
            <button type="button" className="button-secondary" onClick={copy}><Copy size={13} />{copied ? t('Copied') : t('Copy bulletin')}</button>
            <a className="button-secondary" href={`https://wa.me/?text=${encodeURIComponent(hotspotBulletin(i, r, locale))}`} target="_blank" rel="noreferrer"><MessageCircle size={13} />WhatsApp</a>
            <a className="button-secondary" href={`https://www.google.com/maps/dir/?api=1&destination=${i.centroid[1].toFixed(5)},${i.centroid[0].toFixed(5)}`} target="_blank" rel="noreferrer"><Navigation size={13} />{t('Route (Google Maps)')}</a>
          </div>
        </div>
      )}
    </li>
  )
}

export function HotspotPanel({ query, sats, focusId, onFocus, onPick, onFrame }: {
  query: { data?: HotspotReport; isLoading: boolean; isFetching: boolean; error: unknown; refetch: () => void }
  sats: string[]; focusId: string | null; onFocus: (id: string | null) => void; onPick: (p: DetectionProps) => void; onFrame: (i: HotspotItem) => void
}) {
  useLocale()
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const r = query.data
  const items = useMemo(() => (r?.items ?? []).filter((i) => Object.keys(i.proportion.by_satellite).some((s) => sats.includes(s))), [r, sats])
  if (query.isLoading && !r) return <Loading label={t('Grouping detections into hotspots and checking wind, cities, roads and official territories…')} />
  if (query.error && !r) return <ErrorState error={query.error} compact onRetry={query.refetch} />
  if (!r) return null
  if (!r.available) return <p className="intel-note">{sourceCopy(r.reason ?? '')}</p>
  const s = r.summary
  return (
    <div className="ti-panel hs-panel">
      {r.historical && <p className="hs-hist">{t('Study mode: FIRMS archive {0} – {1}. Current wind and Censipam events do not apply.', { 0: fmtDate(r.detections.start), 1: fmtDate(r.detections.end) })}</p>}
      <figure className="sev-bar" aria-label={t('Hotspots by alert level')}>
        <div className="sev-track" role="img" aria-label={(['alto', 'moderado', 'baixo', 'sem_alvo'] as const).map((k) => `${t(LEVEL_STYLE[k].label)}: ${s.by_level[k] ?? 0}`).join('; ')}>
          {(['alto', 'moderado', 'baixo', 'sem_alvo'] as const).map((k) => (s.by_level[k] ?? 0) > 0 && <span key={k} style={{ flexGrow: s.by_level[k], background: LEVEL_STYLE[k].color }} />)}
        </div>
        <figcaption>{(['alto', 'moderado', 'baixo', 'sem_alvo'] as const).map((k) => <span key={k}><i style={{ background: LEVEL_STYLE[k].color }} />{t(LEVEL_STYLE[k].label)} <b className="num">{fmtInt(s.by_level[k] ?? 0)}</b></span>)}</figcaption>
      </figure>
      <div className="ti-summary">
        <div><strong className="num" style={{ color: LEVEL_STYLE.alto.color }}>{fmtInt(s.by_level.alto)}</strong><span>{t('high-alert hotspots')}</span><small>{t('{0} moderate · {1} low · {2} hotspots in total', { 0: fmtInt(s.by_level.moderado), 1: fmtInt(s.by_level.baixo), 2: fmtInt(s.clusters) })}</small></div>
        <div><strong className="num">{fmtInt(s.cities_close_or_downwind.length)}</strong><span>{t('cities within 5 km or downwind')}</span><small>{s.cities_close_or_downwind.slice(0, 4).join(', ')}{s.cities_close_or_downwind.length > 4 ? '…' : ''}</small></div>
        <div><strong className="num">{fmtInt(s.federal_roads_near.length)}</strong><span>{t('federal roads within 10 km')}</span><small>{s.federal_roads_near.slice(0, 6).join(', ')}</small></div>
        <div><strong className="num">{fmtInt(s.indigenous_lands_touched.length)}</strong><span>{t('Indigenous lands touched')}</span><small>{s.indigenous_lands_touched.slice(0, 3).join(', ')}{s.indigenous_lands_touched.length > 3 ? '…' : ''}</small></div>
      </div>
      <p className="hs-ver-summary">{t('Detection reliability')}: <b className="v-high">{fmtInt(s.by_veracity.alta)} {t('high')}</b> · <b className="v-mid">{fmtInt(s.by_veracity.media)} {t('medium')}</b> · <b className="v-low">{fmtInt(s.by_veracity.baixa)} {t('low')}</b></p>
      {(['alto', 'moderado', 'baixo'] as const).map((lv) => {
        const list = items.filter((i) => i.level === lv)
        if (!list.length) return null
        const all = showAll[lv] || list.length <= 8
        return (
          <section key={lv} className="att-group" data-hs-group={lv}>
            <h4><i style={{ background: LEVEL_STYLE[lv].color }} />{t(LEVEL_STYLE[lv].label)}<b className="num">{list.length}</b></h4>
            <ul>{(all ? list : list.slice(0, 8)).map((i) => <Card key={i.id} i={i} r={r} open={focusId === i.id} onToggle={() => onFocus(focusId === i.id ? null : i.id)} onPick={onPick} onFrame={onFrame} sats={sats} />)}</ul>
            {!all && <button type="button" className="link att-more" onClick={() => setShowAll((x) => ({ ...x, [lv]: true }))}>{t('Show all ({0})', { 0: list.length })}</button>}
          </section>
        )
      })}
      {!items.length && <p className="intel-empty">{t('No hotspot with a mapped target within 10 km in this window. No detection does not establish that no fire occurred.')}</p>}
      <details className="att-method">
        <summary>{t('How hotspots, alert levels and reliability are decided')}</summary>
        <ul>{Object.entries(r.rules.levels).map(([k, v]) => <li key={k}><b>{t(LEVEL_STYLE[k as HotspotItem['level']]?.label ?? k)}</b>: {sourceCopy(v)}</li>)}</ul>
        <ul>{Object.entries(r.rules.veracity).map(([k, v]) => <li key={k}><b>{t(VERACITY[k as HotspotItem['veracity']]?.label ?? k)}</b>: {sourceCopy(v)}</li>)}</ul>
        <p>{sourceCopy(r.rules.downwind)} {sourceCopy(r.disclaimer)}</p>
        <h5>{t('Not modeled')}</h5>
        <ul>{r.not_modeled.map((x) => <li key={x}>{sourceCopy(x)}</li>)}</ul>
        <p className="intel-note">{sourceCopy(r.method)}</p>
      </details>
    </div>
  )
}
