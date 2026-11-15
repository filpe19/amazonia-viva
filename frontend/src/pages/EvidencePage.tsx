import { t, useLocale } from '../lib/i18n'
import { sourceCopy } from '../lib/sourceCopy'
import { Download, FileJson, FileText } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Segmented, Toggle } from '../components/controls'
import { Page, Section } from '../components/Page'
import { ErrorState, Loading } from '../components/states'
import { apiUrl } from '../lib/api'
import { fmtInt, fmtUtc, shortHash } from '../lib/format'
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-[12.5px]">
                <thead className="text-ink-3">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">{t("Product")}</th><th className="pr-3 text-right font-medium">{t("Detections")}</th><th className="pr-3 font-medium">{t("Latest observation")}</th>
                    <th className="pr-3 font-medium">{t("Retrieved")}</th><th className="pr-3 font-medium">{t("Mode")}</th><th className="pr-3 font-medium">{t("Version")}</th><th className="pr-3 font-medium">{t("SHA-256")}</th><th className="font-medium">{t("Origin")}</th>
                  </tr>
                </thead>
                <tbody className="num divide-y divide-rule/60 align-top">
                  {m.observations.map((o) => (
                    <tr key={o.product_id}>
                      <td className="py-2 pr-3"><span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-full" style={{ background: productStyle(o.product_id).color }} />{t(productStyle(o.product_id).label)}</span></td>
                      <td className="pr-3 text-right">{o.available ? fmtInt(o.count) : '—'}</td>
                      <td className="pr-3">{fmtUtc(o.latest_observation_utc)}</td>
                      <td className="pr-3">{fmtUtc(o.provenance?.fetched_at)}{o.provenance?.stale ? t("(cached copy)") : ''}</td>
                      <td className="pr-3">{o.provenance?.mode === 'public_file' ? t("public NRT archive") : o.provenance?.mode === 'area_api' ? t("area API") : '—'}</td>
                      <td className="pr-3">{o.provenance?.versions.join(', ') || '—'}</td>
                      <td className="pr-3"><code title={o.provenance?.sha256}>{shortHash(o.provenance?.sha256)}</code></td>
                      <td className="break-all">{o.provenance?.request_urls.map((u) => <a key={u} href={u} className="text-river underline" target="_blank" rel="noreferrer">{u.split('/').at(-1)}</a>)}
                        {o.error && <span className="text-alert">{sourceCopy(o.error.message)}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[12.5px]">
                <thead className="text-ink-3"><tr><th className="py-1.5 pr-3 font-medium">{t("Product")}</th><th className="pr-3 font-medium">{t("Year")}</th><th className="pr-3 font-medium">{t("Version")}</th><th className="pr-3 text-right font-medium">{t("Rows")}</th><th className="pr-3 font-medium">{t("Imported at")}</th><th className="font-medium">{t("SHA-256")}</th></tr></thead>
                <tbody className="num divide-y divide-rule/60">
                  {m.historical_sources.map((f) => (
                    <tr key={`${f.product_id}-${f.year}`}>
                      <td className="py-1.5 pr-3"><a href={f.url} className="text-river underline" target="_blank" rel="noreferrer">{t(productStyle(f.product_id).label)}</a></td>
                      <td className="pr-3">{f.year}</td><td className="pr-3">{f.version_values.join(', ')}</td>
                      <td className="pr-3 text-right">{fmtInt(f.rows_read)}</td><td className="pr-3">{fmtUtc(f.imported_at)}</td>
                      <td><code title={f.sha256}>{shortHash(f.sha256)}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title={t("Limitations")}>
            <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">{m.limitations.map((l) => <li key={sourceCopy(l)}>{sourceCopy(l)}</li>)}</ul>
          </Section>
        </>
      )}
    </Page>
  )
}
