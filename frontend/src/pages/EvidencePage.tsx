import { EvidenceObservations, HistoricalSourceTable } from '../features/map/EvidenceTables'
import { t, useLocale } from '../lib/i18n'
import { sourceCopy } from '../lib/sourceCopy'
import { Download, FileJson, FileText } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Segmented, Toggle } from '../components/controls'
import { Page, Section } from '../components/Page'
import { ErrorState, Loading } from '../components/states'
import { apiUrl } from '../lib/api'
import { fmtUtc } from '../lib/format'
import { useEvidence } from '../lib/hooks'
import { DEFAULT_NRT, NRT_SELECTABLE, productStyle } from '../lib/products'
import { useRegion } from '../lib/region-context'
import { useSessionState } from '../lib/useSessionState'
import type { DayNight, WindowLabel } from '../lib/types'

export default function EvidencePage() {
  useLocale()
  const { region } = useRegion()
  const [win, setWin] = useSessionState<WindowLabel>('av:evidence:window','7d')
  const [daynight, setDaynight] = useState<DayNight>('all')
  const [products, setProducts] = useState<string[]>([...DEFAULT_NRT, 'MODIS_NRT'])
  const q = useEvidence({ region, window: win, products, daynight })
  const m = q.isPlaceholderData ? undefined : q.data

  const downloadManifest = () => {
    if (!m) return
    const blob = new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `amazonia-viva_manifesto_${m.query.region}_${m.query.window}_${m.generated_at.replace(/[:-]/g, '').slice(0, 13)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <Page
      title={t("Evidence & exports")}
      intro={<>{t("Trace each result to its territory, period, satellite product, source file, retrieval time and SHA-256. Download original detections as CSV or the full provenance manifest as JSON.")}</>}
    >
      <Section title={t("Query")}>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start">
          <div className="flex flex-col gap-1.5">
            <span className="type-label text-xs text-ink-2">{t("Window")}</span>
            <Segmented label={t("Window")} value={win} onChange={setWin} options={[{ value: '24h', label: '24 h' }, { value: '48h', label: '48 h' }, { value: '7d', label: "7 days" }]} />
            <Segmented label={t("Overpass")} size="sm" value={daynight} onChange={setDaynight} options={[{ value: 'all', label: "All" }, { value: 'D', label: "Day" }, { value: 'N', label: "Night" }]} />
          </div>
          <fieldset>
            <legend className="type-label mb-1 text-xs text-ink-2">{t("Products")}</legend>
            {NRT_SELECTABLE.map((id) => {
              const st = productStyle(id)
              return <Toggle key={id} checked={products.includes(id)} swatch={st.color} label={t(st.label)}
                onChange={(v) => setProducts((cur) => (v ? [...new Set([...cur, id])] : cur.filter((p) => p !== id)))} />
            })}
          </fieldset>
          <div className="flex flex-col gap-2">
            <a href={apiUrl('/detections/export.csv', { region, window: win, products: products.join(','), daynight })}
              className={`control inline-flex items-center justify-center gap-2 bg-canopy-900 px-3 py-2 text-[13px] font-medium text-white hover:bg-canopy-800 ${products.length ? '' : 'pointer-events-none opacity-50'}`}>
              <Download className="size-4" aria-hidden="true" /> {t("Export CSV")}
            </a>
            <button type="button" onClick={downloadManifest} disabled={!m}
              className="control inline-flex items-center justify-center gap-2 px-3 py-2 text-[13px] font-medium text-ink ring-1 ring-rule hover:bg-lichen disabled:opacity-50">
              <FileJson className="size-4" aria-hidden="true" /> {t("Download JSON manifest")}
            </button>
            <Link to={`/ficha/${region}?regiao=${region}`} className="button-secondary"><FileText className="size-4" aria-hidden="true"/>{t("Printable territory report")}</Link>
          </div>
        </div>
      </Section>

      {(q.isLoading || q.isPlaceholderData) && <Loading />}
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      {m && (
        <>
          <Section title={t("Territory and period")}>
            <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-[200px_1fr]">
              <dt className="text-ink-3">{t("Region")}</dt><dd className="text-ink">{m.region.name} {t("(IBGE code")} {m.region.ibge_code})</dd>
              <dt className="text-ink-3">{t("Territorial boundary")}</dt>
              <dd className="break-all text-ink-2">{t("IBGE boundary API v3, retrieved at")} {fmtUtc(m.boundary.fetched_at)}<br />
                {m.boundary.source_url && <a href={m.boundary.source_url} className="text-river underline" target="_blank" rel="noreferrer">{m.boundary.source_url}</a>}</dd>
              <dt className="text-ink-3">{t("Query period")}</dt><dd className="num text-ink">{fmtUtc(m.window.start_utc)} {t("to")} {fmtUtc(m.window.end_utc)}</dd>
              <dt className="text-ink-3">{t("Day/night")}</dt><dd className="text-ink">{m.query.daynight === 'all' ? t("day and night") : m.query.daynight === 'D' ? "day" : "night"}</dd>
              <dt className="text-ink-3">{t("Manifest generated")}</dt><dd className="num text-ink">{fmtUtc(m.generated_at)}</dd>
            </dl>
          </Section>

          <Section title={t("Observations and sources")} description={t("Counts are kept separate by product. Each row identifies the exact source file or API request.")}>
            <EvidenceObservations manifest={m}/>
            <p className="mt-3 text-xs text-ink-3">{t("Nominal source latency:")} {sourceCopy(m.observations[0]?.provenance?.nominal_latency) || '—'}.</p>
          </Section>

          <Section title={t("Available comparisons")}>
            <ul className="space-y-1.5 text-[13px] text-ink-2">
              <li><Link to="/territorio" className="text-river underline">{t("Current period versus the same period in previous years")}</Link> {t("(MODIS NRT × MODIS archive).")}</li>
              <li><Link to="/historico" className="text-river underline">{t("Monthly series, seasonality and calendar")}</Link> ({m.historical_sources.length} {t("annual archives imported).")}</li>
              <li><Link to="/historico#sobreposicao" className="text-river underline">{t("MODIS and VIIRS in overlapping years")}</Link> {t("(exploratory comparison; separate sensor records).")}</li>
            </ul>
          </Section>

          <Section title={t("Historical source files")} description={t("NASA FIRMS annual country archives, processed into aggregates.")}>
            <HistoricalSourceTable files={m.historical_sources}/>
          </Section>

          <Section title={t("Limitations")}>
            <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">{m.limitations.map((l) => <li key={sourceCopy(l)}>{sourceCopy(l)}</li>)}</ul>
          </Section>
        </>
      )}
    </Page>
  )
}
