// Legenda operacional: a seção de detecções também é o filtro por satélite; as demais camadas ficam recolhíveis.
import { ChevronDown } from 'lucide-react'
import { t, useLocale } from '../../lib/i18n'
import { fmtInt } from '../../lib/format'
import { AGE_CLASSES, SATELLITES, shapeSvg, type SatelliteKey } from '../map/symbology'

export interface LegendEntry { key: string; swatch: React.ReactNode; label: string; note?: string }

export function MapLegend({ sats, onToggleSat, counts, loading, entries, detectionsOn }: {
  sats: string[]
  onToggleSat: (key: SatelliteKey, on: boolean) => void
  counts: Partial<Record<SatelliteKey, number | null>>
  loading?: boolean
  entries: LegendEntry[]
  detectionsOn: boolean
}) {
  useLocale()
  return (
    <div className="map-key v2" aria-label={t('Map legend')}>
      <div className="key-sats" role="group" aria-label={t('Satellites shown on the map')}>
        {(['VIIRS', 'MODIS'] as const).map((sensor) => (
          <div key={sensor} className="key-sensor">
            <span className="sensor-label">{sensor} <small>{sensor === 'VIIRS' ? '375 m' : '1 km'}</small></span>
            {SATELLITES.filter((s) => s.sensor === sensor).map((s) => {
              const on = sats.includes(s.key)
              const n = counts[s.key]
              return (
                <button key={s.key} type="button" className={`sat-chip ${on ? 'on' : ''}`} aria-pressed={on} data-sat={s.key}
                  onClick={() => onToggleSat(s.key, !on)} title={on ? t('Hide {0}', { 0: s.label }) : t('Show {0}', { 0: s.label })}
>
                  <span dangerouslySetInnerHTML={{ __html: shapeSvg(s.shape, s.color, 13) }} />
                  <span className="sat-name">{s.sensor === 'MODIS' ? s.key : s.short}</span>
                  <b className="num">{!on ? t('off') : loading ? '…' : n == null ? '—' : fmtInt(n)}</b>
                  <span className="sr-only">{`, ${s.label} ${s.resolution}`}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="key-age" aria-label={t('Observation age')}>
        {detectionsOn && <>
          <span>{t('Age')}</span>
          {AGE_CLASSES.map((a) => <span key={a.key}><i dangerouslySetInnerHTML={{ __html: shapeSvg('circle', '#6b7a72', 12, a.key === 'older', a.key === 'recent') }} />{a.label}</span>)}
          <span className="key-note">{t('Symbols are pixels, not fire size or perimeters.')}</span>
        </>}
        {entries.length > 0 && (
          <details className="key-more">
            <summary>{t('Other layers')} <b>{entries.length}</b> <ChevronDown size={12} /></summary>
            <ul>{entries.map((e) => <li key={e.key}>{e.swatch}<span>{e.label}{e.note && <small>{e.note}</small>}</span></li>)}</ul>
          </details>
        )}
      </div>
    </div>
  )
}
