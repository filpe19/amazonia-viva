// Aba "Alertas": sinais de atenção calculados pela plataforma com critérios públicos (não são alertas oficiais).
// Cada sinal é um cruzamento espacial verificável; contagens por satélite, nunca somadas como incêndios.
import { AlertTriangle, ChevronDown, CircleCheck, CircleSlash, Crosshair, FileText, Focus, MapPin } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ErrorState, Loading } from '../../components/states'
import { fmt1, fmtAgo, fmtDate, fmtInt, fmtUtc } from '../../lib/format'
import { useTerritoryBrief } from '../../lib/hooks'
import { t, useLocale } from '../../lib/i18n'
import { sourceCopy } from '../../lib/sourceCopy'
import type { AttentionReport, AttentionSignal, BriefV2, DetectionProps } from '../../lib/types'
import { SATELLITES, satelliteStyle, shapeSvg } from '../map/symbology'

export const ATTENTION_CATEGORY: Record<string, { label: string; color: string }> = {
  indigenous: { label: 'Indigenous lands', color: '#8a3b12' },
  conservation: { label: 'Conservation units', color: '#1a7a52' },
  quilombola: { label: 'Quilombola territories', color: '#7a4b9e' },
  settlement: { label: 'Federal settlements', color: '#8a6a1d' },
  locality: { label: 'Localities within 1 km', color: '#3f4d45' },
  health: { label: 'Health facilities within 5 km', color: '#7b1d4e' },
  deter_deforestation: { label: 'Over recent deforestation (DETER)', color: '#9c4a1a' },
  deter_burn_scar: { label: 'Over forest fire scars (DETER)', color: '#3d3d3d' },
  deter_degradation: { label: 'Over forest degradation (DETER)', color: '#a07d45' },
  deter_selective_logging: { label: 'Over selective logging (DETER)', color: '#6f6233' },
  deter_mining: { label: 'Over mining (DETER)', color: '#5b4a8a' },
}
const ORDER = ['indigenous', 'conservation', 'quilombola', 'settlement', 'locality', 'health', 'deter_deforestation', 'deter_burn_scar', 'deter_degradation', 'deter_selective_logging', 'deter_mining']
const toIso = (s: string) => (s.length === 17 ? s.replace('Z', ':00Z') : s)

/** Recorta o sinal aos satélites visíveis no mapa (o filtro da legenda vale também aqui). */
export function filterSignal(s: AttentionSignal, sats: string[]): AttentionSignal | null {
  const by = Object.fromEntries(Object.entries(s.by_satellite).filter(([k]) => sats.includes(k)))
  if (!Object.values(by).some((n) => n > 0)) return null
  return { ...s, by_satellite: by, detections: s.detections.filter((d) => sats.includes(d.s)) }
}

function SatCounts({ by }: { by: Record<string, number> }) {
  return (
    <span className="att-sats">
      {SATELLITES.filter((s) => by[s.key]).map((s) => (
        <span key={s.key} title={s.label}><i dangerouslySetInnerHTML={{ __html: shapeSvg(s.shape, s.color, 10) }} />{s.short} <b className="num">{fmtInt(by[s.key])}</b></span>
      ))}
    </span>
  )
}

function relationText(s: AttentionSignal): string {
  if (s.relation === 'inside' && s.criterion === 'deter') return t('pixel centre inside {0} DETER warning polygon(s)', { 0: s.target.polygons_hit ?? s.target.polygons?.length ?? '—' })
  if (s.relation === 'inside') return t('pixel centre inside the official boundary')
  if (s.relation === 'near') return t('outside, {0} km from the boundary', { 0: fmt1(s.nearest_km) })
  return t('nearest detection {0} km away', { 0: fmt1(s.nearest_km) })
}

function SignalCard({ s, open, onToggle, onPick, onFrame, onSelectRegion, isState, regionNames }: {
  s: AttentionSignal; open: boolean; onToggle: () => void; onPick: (p: DetectionProps) => void; onFrame: (s: AttentionSignal) => void
  onSelectRegion?: (id: string) => void; isState: boolean; regionNames: Map<string, string>
}) {
  const nSats = Object.keys(s.by_satellite).length
  const name = s.criterion === 'deter' ? t(ATTENTION_CATEGORY[s.category]?.label ?? s.category) : s.target.name
  return (
    <li className={`att-card ${open ? 'open' : ''}`} data-signal={s.id}>
      <button type="button" className="att-card-head" onClick={onToggle} aria-expanded={open}>
        <span className="att-name">{name}{s.recent_6h > 0 && <em className="att-new">{t('≤ 6 h')}</em>}</span>
        <span className="att-rel">{relationText(s)}{s.target.type ? ` · ${sourceCopy(s.target.type)}` : ''}</span>
        <span className="att-meta"><SatCounts by={s.by_satellite} /><span className="num">{s.last_utc ? fmtAgo(s.last_utc) : '—'}</span></span>
        <span className="att-multi">{t('Seen by {0} of 4 satellites', { 0: nSats })}</span>
        <ChevronDown size={14} className="att-chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="att-card-body">
          <dl>
            <div><dt>{t('Criterion')}</dt><dd>{t(CRITERION_TEXT[s.criterion] ?? s.criterion, { 0: s.radius_km ?? s.months ?? '' })}</dd></div>
            <div><dt>{t('Source')}</dt><dd>{sourceCopy(s.target.source)}{s.target.layer_label ? ` · ${sourceCopy(s.target.layer_label)}` : ''}</dd></div>
            {s.target.attributes && Object.entries(s.target.attributes).slice(0, 3).map(([k, v]) => <div key={k}><dt>{sourceCopy(k)}</dt><dd>{String(v)}</dd></div>)}
            <div><dt>{t('Observed')}</dt><dd className="num">{fmtUtc(s.first_utc)} – {fmtUtc(s.last_utc)}</dd></div>
            {s.max_frp_mw != null && <div><dt>{t('Max. FRP')}</dt><dd className="num">{fmt1(s.max_frp_mw)} MW</dd></div>}
            {isState && s.region_ids[0] && <div><dt>{t('Municipality')}</dt><dd>{regionNames.get(s.region_ids[0]) ?? s.region_ids[0]}</dd></div>}
          </dl>
          {s.target.polygons && s.target.polygons.length > 0 && (
            <table className="att-deter"><thead><tr><th>{t('DETER class')}</th><th>{t('Image date')}</th><th className="num">km²</th><th className="num">{t('Det.')}</th></tr></thead>
              <tbody>{s.target.polygons.slice(0, 5).map((p) => <tr key={p.gid}><td>{t(DETER_LABEL[p.class] ?? p.class)}</td><td className="num">{fmtDate(p.view_date)}</td><td className="num">{fmt1(p.area_km2)}</td><td className="num">{p.detections}</td></tr>)}</tbody>
            </table>
          )}
          <ul className="att-dets">
            {s.detections.slice(0, 6).map((d) => {
              const st = satelliteStyle(d.s)
              return (
                <li key={`${d.p}-${d.id}`}><button type="button" onClick={() => onPick({ id: d.id, p: d.p, s: d.s, t: d.t, frp: null, c: null, dn: 'D' })}>
                  <i dangerouslySetInnerHTML={{ __html: shapeSvg(st?.shape ?? 'circle', st?.color ?? '#444', 10) }} />{st?.short ?? d.s}
                  <span className="num">{fmtUtc(toIso(d.t))}</span>{d.d_km != null && <span className="num">{fmt1(d.d_km)} km</span>}<Crosshair size={12} aria-hidden="true" />
                </button></li>
              )
            })}
          </ul>
          {s.detections.length > 6 && <p className="intel-note">{t('{0} more detections in this signal; frame it on the map to see all.', { 0: s.detections.length - 6 })}</p>}
          <div className="att-actions">
            <button type="button" className="button-secondary" onClick={() => onFrame(s)}><Focus size={13} />{t('Frame on map')}</button>
            {isState && s.region_ids[0] && onSelectRegion && <button type="button" className="button-secondary" onClick={() => onSelectRegion(s.region_ids[0])}><MapPin size={13} />{t('Open municipality')}</button>}
          </div>
        </div>
      )}
    </li>
  )
}

const CRITERION_TEXT: Record<string, string> = {
  inside_territory: 'Pixel centre inside the official polygon.',
  near_territory: 'Outside the polygon, within {0} km of its boundary.',
  locality: 'IBGE locality within {0} km of the pixel centre (≈ VIIRS pixel size plus position error).',
  health: 'CNES health facility within {0} km of the pixel centre.',
  deter: 'Pixel centre inside an INPE DETER warning polygon imaged in the last {0} months.',
}
export const DETER_LABEL: Record<string, string> = {
  DESMATAMENTO_CR: 'Clear-cut deforestation', DESMATAMENTO_VEG: 'Deforestation with vegetation', MINERACAO: 'Mining', DEGRADACAO: 'Degradation',
  CICATRIZ_DE_QUEIMADA: 'Forest fire scar', CS_DESORDENADO: 'Selective logging (disordered)', CS_GEOMETRICO: 'Selective logging (geometric)',
}

function Tile({ label, value, note, tone, onClick }: { label: string; value: ReactNode; note?: ReactNode; tone?: string; onClick?: () => void }) {
  const C = onClick ? 'button' : 'div'
  return <C type={onClick ? 'button' : undefined} className={`att-tile ${tone ?? ''}`} onClick={onClick}><span>{t(label)}</span><strong className="num">{value}</strong>{note && <small>{note}</small>}</C>
}

export function AttentionTab({ region, regionName, isState, windowLabel, sats, query, focusId, onFocus, onPick, onFrame, onSelectRegion, municipalities }: {
  region: string; regionName: string; isState: boolean; windowLabel: string; sats: string[]
  query: { data?: AttentionReport; isLoading: boolean; isFetching: boolean; error: unknown; refetch: () => void }
  focusId: string | null; onFocus: (id: string | null) => void; onPick: (p: DetectionProps) => void; onFrame: (s: AttentionSignal) => void
  onSelectRegion?: (id: string) => void; municipalities?: GeoJSON.FeatureCollection
}) {
  useLocale()
  const brief = useTerritoryBrief(region)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const a = query.data
  const regionNames = useMemo(() => new Map((municipalities?.features ?? []).map((f) => [String(f.properties?.id), String(f.properties?.name)])), [municipalities])
  const signals = useMemo(() => (a?.signals ?? []).map((s) => filterSignal(s, sats)).filter((s): s is AttentionSignal => s != null), [a, sats])
  const main = signals.filter((s) => s.relation !== 'near')
  const near = signals.filter((s) => s.relation === 'near')
  const byCat = (cat: string) => main.filter((s) => s.category === cat)
  const temporal = ((brief.data as BriefV2 | undefined)?.attention.signals ?? [])
  const scrollTo = (cat: string) => document.querySelector(`[data-att-group="${cat}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  if (query.isLoading && !a) return <div className="intel-stack"><Loading label={t('Cross-checking detections with territories, communities and DETER…')} /></div>
  if (query.error && !a) return <div className="intel-stack"><ErrorState error={query.error} compact onRetry={query.refetch} /></div>
  if (!a) return null
  if (!a.available) return <div className="intel-stack"><p className="intel-note">{sourceCopy(a.reason ?? '')}</p></div>

  const ppl = a.summary.people
  const env = a.summary.environment
  const insideProtected = ['indigenous', 'conservation', 'quilombola'].reduce((n, c) => n + byCat(c).length, 0)
  return (
    <div className="intel-stack attention">
      <header className="att-head">
        <p className="att-kicker"><AlertTriangle size={14} aria-hidden="true" />{t('Attention signals')} · {regionName} · {windowLabel}</p>
        <h3><span className="num">{fmtInt(main.length)}</span> {t(main.length === 1 ? 'signal met' : 'signals met')}</h3>
        <p className="att-disclaimer">{t('Computed by the platform from public criteria. These are not official alerts and do not measure risk or damage; confirm with Civil Defence, fire brigades, ICMBio, Funai or Ibama/Prevfogo.')}</p>
        {query.isFetching && <small className="att-updating">{t('Updating…')}</small>}
      </header>

      <div className="att-tiles">
        <Tile label="Protected areas with detections inside" value={fmtInt(insideProtected)} tone="protected" onClick={() => scrollTo('indigenous')}
          note={`${t('Indigenous')} ${byCat('indigenous').length} · ${t('Conservation')} ${byCat('conservation').length} · ${t('Quilombola')} ${byCat('quilombola').length}`} />
        <Tile label="Settlements with detections inside" value={fmtInt(byCat('settlement').length)} tone="settlement" onClick={() => scrollTo('settlement')}
          note={a.sources.assentamentos?.available ? t('INCRA federal settlements') : t('INCRA layer did not respond')} />
        <Tile label="Localities with a detection ≤ 1 km" value={ppl.localities_within_1km == null ? '—' : fmtInt(byCat('locality').length)} tone="people" onClick={() => scrollTo('locality')}
          note={ppl.localities_within_5km != null ? t('{0} within 5 km, of {1} mapped (IBGE)', { 0: fmtInt(ppl.localities_within_5km), 1: fmtInt(ppl.localities_total) }) : sourceCopy(a.sources.localities?.reason ?? '')} />
        {isState ? (
          <Tile label="Municipalities with signals" value={fmtInt(a.by_municipality.length)} tone="muni" note={t('Health facilities and DETER are cross-checked per municipality.')} />
        ) : (
          <Tile label="Health facilities with a detection ≤ 5 km" value={ppl.health_within_5km == null ? '—' : fmtInt(byCat('health').length)} tone="health" onClick={() => scrollTo('health')}
            note={ppl.health_total != null ? t('of {0} with coordinates (CNES)', { 0: fmtInt(ppl.health_total) }) : sourceCopy(a.sources.health?.reason ?? '')} />
        )}
        {!isState && (
          <Tile label="Detections over DETER warnings (12 months)" value={env.deter_available ? fmtInt(env.detections_over_deter) : '—'} tone="forest wide" onClick={() => scrollTo('deter_deforestation')}
            note={env.deter_available ? <SatCounts by={env.detections_over_deter_by_satellite ?? {}} /> : sourceCopy(a.sources.deter?.reason ?? '')} />
        )}
      </div>

      {temporal.length > 0 && (
        <section className="att-temporal">
          <h4>{t('Over time (same territory)')}</h4>
          <ul>{temporal.map((s) => (
            <li key={s.id} className={s.status}>
              {s.status === 'met' ? <AlertTriangle size={13} /> : s.status === 'not_met' ? <CircleCheck size={13} /> : <CircleSlash size={13} />}
              <span>{sourceCopy(s.label)}</span><b className="num">{s.value ? sourceCopy(s.value) : t('insufficient data')}</b>
            </li>
          ))}</ul>
        </section>
      )}

      {isState && a.by_municipality.length > 0 && (
        <section className="att-munis">
          <h4>{t('Municipalities with the most signals')}</h4>
          <ol>{a.by_municipality.slice(0, 8).map((m) => (
            <li key={m.region_id}><button type="button" onClick={() => onSelectRegion?.(m.region_id)}>
              <span>{m.name}</span>
              <span className="att-cats">{Object.entries(m.categories).sort((x, y) => ORDER.indexOf(x[0]) - ORDER.indexOf(y[0])).map(([c, n]) => <i key={c} style={{ background: ATTENTION_CATEGORY[c]?.color }} title={t(ATTENTION_CATEGORY[c]?.label ?? c)}>{n}</i>)}</span>
              <b className="num">{m.signals}</b>
            </button></li>
          ))}</ol>
          <p className="intel-note">{t('Number of territories and localities meeting a criterion, not a risk score. Select a municipality to also cross-check health facilities and DETER.')}</p>
        </section>
      )}

      {main.length === 0 && <p className="intel-empty">{t('No signal meets the criteria in this window. No detection near a territory does not establish that no fire occurred.')}</p>}

      {ORDER.filter((c) => byCat(c).length).map((c) => {
        const list = byCat(c)
        const all = expanded[c] || list.length <= 5
        return (
          <section key={c} className="att-group" data-att-group={c}>
            <h4><i style={{ background: ATTENTION_CATEGORY[c]?.color }} />{t(ATTENTION_CATEGORY[c]?.label ?? c)}<b className="num">{list.length}</b></h4>
            <ul>{(all ? list : list.slice(0, 5)).map((s) => (
              <SignalCard key={s.id} s={s} open={focusId === s.id} onToggle={() => onFocus(focusId === s.id ? null : s.id)} onPick={onPick}
                onFrame={onFrame} onSelectRegion={onSelectRegion} isState={isState} regionNames={regionNames} />
            ))}</ul>
            {!all && <button type="button" className="link att-more" onClick={() => setExpanded((e) => ({ ...e, [c]: true }))}>{t('Show all ({0})', { 0: list.length })}</button>}
          </section>
        )
      })}

      {near.length > 0 && (
        <details className="att-near">
          <summary>{t('Near a boundary (outside, ≤ 2 km)')} <b className="num">{near.length}</b></summary>
          <ul>{near.slice(0, 40).map((s) => (
            <SignalCard key={s.id} s={s} open={focusId === s.id} onToggle={() => onFocus(focusId === s.id ? null : s.id)} onPick={onPick}
              onFrame={onFrame} onSelectRegion={onSelectRegion} isState={isState} regionNames={regionNames} />
          ))}</ul>
          {near.length > 40 && <p className="intel-note">{t('Showing 40 of {0}.', { 0: near.length })}</p>}
        </details>
      )}

      <details className="att-method">
        <summary>{t('How signals are computed')}</summary>
        <ul>{a.criteria.map((c) => <li key={c.id}>{t(CRITERION_TEXT[c.id] ?? c.text, { 0: c.km ?? c.months ?? '' })}</li>)}</ul>
        <p>{t('Counts are per satellite and never added together: the same fire can be seen by several satellites. “Seen by N of 4 satellites” is multi-sensor agreement, not a fire count.')}</p>
        <h5>{t('Sources')}</h5>
        <ul className="att-sources">{Object.entries(a.sources).map(([k, v]) => (
          <li key={k} className={v.available ? 'ok' : v.not_applicable ? 'na' : 'off'}>
            {v.available ? <CircleCheck size={12} /> : <CircleSlash size={12} />}<span>{sourceCopy(v.label)}</span>
            <small>{v.available ? `${v.features != null ? `${fmtInt(v.features)} ${t('features')} · ` : ''}${fmtUtc(v.fetched_at)}${v.stale ? ` · ${t('previous copy')}` : ''}` : sourceCopy(v.reason ?? '')}</small>
          </li>
        ))}</ul>
        <h5>{t('Not evaluated')}</h5>
        <ul>{a.not_evaluated.map((x) => <li key={x}>{sourceCopy(x)}</li>)}</ul>
      </details>

      <Link to={`/ficha/${region}?regiao=${region}`} className="button-primary w-full justify-center"><FileText size={14} />{t('Generate territorial attention report')}</Link>
    </div>
  )
}
