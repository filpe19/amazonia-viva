// "É incêndio mesmo?": indícios sobre a origem do calor de uma detecção (confirmação por outras passagens,
// fonte estática FIRMS type 2, histórico local, mineração/garimpo ANM e DETER, desmatamento recente). Nunca diagnóstico.
import { AlertTriangle, CircleCheck, CircleHelp, Factory, Flame, Pickaxe, Trees } from 'lucide-react'
import type { ReactNode } from 'react'
import { KindBadge } from '../../components/KindBadge'
import { ErrorState, Loading } from '../../components/states'
import { fmtDate, monthNames } from '../../lib/format'
import { useHeatEvidence } from '../../lib/hooks'
import { t, useLocale } from '../../lib/i18n'
import type { HeatEvidenceItem } from '../../lib/types'

const READING: Record<string, { label: string; tone: string; icon: ReactNode }> = {
  static_source: { label: 'Likely a non-vegetation heat source (FIRMS marked this place as a static source)', tone: 'other', icon: <Factory size={15} /> },
  mining_context: { label: 'Mining context: inside a mining title, garimpo reserve or DETER mining warning', tone: 'other', icon: <Pickaxe size={15} /> },
  clearing_context: { label: 'Burning on recently deforested land (INPE DETER), by spatial coincidence', tone: 'context', icon: <Trees size={15} /> },
  vegetation_fire_compatible: { label: 'Compatible with vegetation burning: confirmed by another overpass, no sign of another source', tone: 'fire', icon: <Flame size={15} /> },
  inconclusive: { label: 'Inconclusive: single observation and no other evidence in the consulted sources', tone: 'unknown', icon: <CircleHelp size={15} /> },
}

function text(i: HeatEvidenceItem): string {
  const p = i.params as Record<string, never>
  switch (i.id) {
    case 'confirmed': return t('Confirmed by {0} other overpass(es) within {1} km and ±{2} h ({3}).', { 0: p.passes, 1: p.km, 2: p.hours, 3: (p.satellites as string[]).join(', ') })
    case 'single_pass': return t('No other overpass saw heat within {0} km and ±{1} h: could be a short fire, clouds at other overpasses or a false positive.', { 0: p.km, 1: p.hours })
    case 'low_confidence': return t('Low confidence in the FIRMS record ({0}).', { 0: String(p.value) })
    case 'static_source': return t('The FIRMS archive marks {0} detection(s) within {1} km as “other static land source” (type 2), typical of industry, kilns or charcoal production.', { 0: p.records, 1: p.km })
    case 'history': return t('{0}: detections within {1} km in {2} of {3} archive years (months: {4}).', { 0: p.product, 1: p.km, 2: p.years, 3: p.n_years, 4: (p.months as number[]).map((m) => monthNames()[m - 1]?.slice(0, 3)).join(', ') })
    case 'no_history': return t('No archived detection within {0} km: new burning at this place.', { 0: p.km })
    case 'mining_garimpo': return t('Inside a garimpo mining permit or reserve (ANM): {0}.', { 0: (p.titles as string[]).join('; ') })
    case 'mining_process': return t('Inside an active mining title (ANM): {0}.', { 0: (p.titles as string[]).join('; ') })
    case 'deter_deforestation': return t('Over a DETER deforestation warning imaged {0} ({1} km²).', { 0: fmtDate(p.view_date), 1: p.area_km2 })
    case 'deter_burn_scar': return t('Over a DETER forest fire scar imaged {0}: the area had already burned.', { 0: fmtDate(p.view_date) })
    case 'deter_mining': return t('Over a DETER mining warning imaged {0}.', { 0: fmtDate(p.view_date) })
    case 'deter_degradation': return t('Over a DETER forest degradation warning imaged {0}.', { 0: fmtDate(p.view_date) })
    case 'deter_logging': return t('Over a DETER selective logging warning imaged {0}.', { 0: fmtDate(p.view_date) })
    default: return i.id
  }
}
const ICON: Record<HeatEvidenceItem['direction'], ReactNode> = {
  supports_fire: <CircleCheck size={13} />, other_source: <AlertTriangle size={13} />, context: <Trees size={13} />, caution: <CircleHelp size={13} />,
}

export function HeatSourceBlock({ product, id }: { product: string; id: string }) {
  useLocale()
  const q = useHeatEvidence(product, id)
  const d = q.data
  const r = d ? READING[d.reading] : null
  return (
    <section className="intel-block heat-source" data-heat-reading={d?.reading}>
      <header>
        <span className="intel-icon" aria-hidden="true"><CircleHelp size={15} /></span>
        <div><h3>{t('Is it really a fire?')}</h3><p>{t('Evidence on the heat source from official databases')}</p></div>
        <KindBadge kind="estimativa" compact />
      </header>
      {q.isLoading ? <Loading label={t('Checking other overpasses, FIRMS archive, ANM and DETER…')} /> : q.error ? <ErrorState error={q.error} compact /> : d && r ? <>
        <p className={`heat-reading ${r.tone}`}>{r.icon}<span>{t(r.label)}</span></p>
        <ul className="heat-items">{d.evidence.map((i, k) => <li key={`${i.id}-${k}`} className={i.direction}>{ICON[i.direction]}<span>{text(i)}<small>{i.source}</small></span></li>)}</ul>
        <details className="heat-rules-details"><summary>{t('How the reading is decided')}</summary><ul className="heat-rules">{d.reading_rules.map((x) => <li key={x}>{t(RULES[x] ?? x)}</li>)}</ul></details>
        <p className="intel-note">{t('Evidence from official databases; it does not replace field verification and does not establish cause or responsibility.')}{Object.entries(d.sources).filter(([, v]) => !v.available).map(([k]) => ` ${t('Unavailable')}: ${k.toUpperCase()}.`).join('')}</p>
      </> : null}
    </section>
  )
}

const RULES: Record<string, string> = {
  'Fonte estática (FIRMS type 2 a ≤ 500 m no arquivo) → provável fonte não florestal.': 'Static source (FIRMS type 2 within 500 m in the archive) → likely non-vegetation source.',
  'Dentro de processo minerário/reserva garimpeira (ANM) ou aviso DETER de mineração → contexto de mineração.': 'Inside a mining title/garimpo reserve (ANM) or DETER mining warning → mining context.',
  'Dentro de aviso DETER de desmatamento (12 meses) → contexto de queima após desmatamento.': 'Inside a DETER deforestation warning (12 months) → burning-after-clearing context.',
  'Confirmada por outra passagem a ≤ 1 km em ± 24 h, sem os indícios acima → compatível com queima de vegetação.': 'Confirmed by another overpass within 1 km and ±24 h, without the evidence above → compatible with vegetation burning.',
  'Caso contrário → inconclusivo (observação única ou sem bases para o ponto).': 'Otherwise → inconclusive (single observation or no data for the point).',
}
