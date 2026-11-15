import { t, useLocale } from '../../lib/i18n'
import { sourceCopy } from '../../lib/sourceCopy'
import { CloudSun, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDetectionDetail } from '../../lib/hooks'
import { fmt1, fmt2, fmtAgo, fmtBrt, fmtCoord, fmtUtc } from '../../lib/format'
import { productStyle } from '../../lib/products'
import type { DetectionProps, DetectionsMeta } from '../../lib/types'
import { ErrorState, Skeleton } from '../../components/states'

const TYPE_LABEL: Record<number, string> = {
  0: "presumed vegetation fire", 1: "active volcano", 2: "other static land source", 3: 'offshore',
}

export function DetectionDetail({ sel, meta, onClose }: { sel: DetectionProps; meta: DetectionsMeta | undefined; onClose: () => void }) {
  useLocale()
  const q = useDetectionDetail(sel.p, sel.id)
  const st = productStyle(sel.p)
  const prod = meta?.products.find((p) => p.product_id === sel.p)
  const d = q.data

  const rows: [string, React.ReactNode][] = d
    ? [
        [t("Coordinates"), fmtCoord(d.latitude, d.longitude)],
        [t("Observation (UTC)"), fmtUtc(d.acq_datetime_utc)],
        [t("Brasília time"), fmtBrt(d.acq_datetime_utc)],
        [t("Overpass"), d.daynight === 'D' ? t("daytime") : t("nighttime")],
        [t("Satellite"), d.satellite_name],
        [t("Sensor"), `${d.instrument} (${st.resolution})`],
        ['FRP', d.frp_mw != null ? `${fmt2(d.frp_mw)} MW` : t("not reported")],
        [
          t("Confidence"),
          d.sensor === 'VIIRS'
            ? t("{0} (VIIRS class)", {"0": sourceCopy(d.confidence_class ?? d.confidence_raw)})
            : t("{0}% (MODIS scale 0–100)", {"0": d.confidence_pct ?? d.confidence_raw}),
        ],
        ...(d.sensor === 'VIIRS'
          ? ([
              [t("Brightness temperature I4"), d.bright_ti4_k != null ? `${fmt1(d.bright_ti4_k)} K` : '—'],
              [t("Brightness temperature I5"), d.bright_ti5_k != null ? `${fmt1(d.bright_ti5_k)} K` : '—'],
            ] as [string, React.ReactNode][])
          : ([
              [t("Brightness temperature (21/22)"), d.brightness_k != null ? `${fmt1(d.brightness_k)} K` : '—'],
              [t("Brightness temperature (31)"), d.bright_t31_k != null ? `${fmt1(d.bright_t31_k)} K` : '—'],
            ] as [string, React.ReactNode][])),
        [t("Pixel dimensions"), d.scan_km != null && d.track_km != null ? `${fmt2(d.scan_km)} × ${fmt2(d.track_km)} km` : '—'],
        ...(d.type != null ? ([[t("Type"), t(TYPE_LABEL[d.type] ?? String(d.type))]] as [string, React.ReactNode][]) : []),
        [t("Product"), d.product_id],
        [t("Version"), d.version ?? '—'],
        [t("Record identifier"), <code key="id" className="text-[11px]">{d.detection_id}</code>],
      ]
    : []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
            <span className="inline-block size-2.5 rounded-full" style={{ background: st.color }} aria-hidden="true" />
            {t(st.label)}
          </p>
          <h2 className="type-title mt-1 text-lg text-ink">{t("Thermal detection")}</h2>
          <p className="num text-xs text-ink-3">{fmtAgo(sel.t)}</p>
        </div>
        <button type="button" onClick={onClose} className="control p-1.5 text-ink-2 hover:bg-lichen" aria-label={t("Close detection detail")}>
          <X className="size-4" />
        </button>
      </div>

      {q.isLoading && <div className="space-y-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div>}
      {q.error && <ErrorState error={q.error} compact />}
      {d && (
        <dl className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-x-3 gap-y-1.5 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{k}</dt>
              <dd className="num text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {d && (
        <Link to={`/ambiente?lat=${d.latitude}&lon=${d.longitude}`}
          className="control inline-flex items-center justify-center gap-2 px-3 py-2 text-[13px] font-medium text-canopy-900 ring-1 ring-rule hover:bg-lichen">
          <CloudSun className="size-4" aria-hidden="true" /> {t("View environmental conditions at this point")}
        </Link>
      )}

      <div className="rounded-[var(--radius-control)] bg-lichen p-2.5 text-[11.5px] leading-relaxed text-ink-2">
        <p>
          {t("A thermal-anomaly pixel at the overpass time; it does not identify an individual fire.")}
          {sel.p.startsWith('MODIS') ? t(" Nominal MODIS pixel: ~1 km.") : t(" Nominal VIIRS pixel: ~375 m.")}
        </p>
        {prod?.provenance && (
          <p className="mt-1.5 break-words">
            {t("Source: NASA FIRMS (")}{prod.provenance.mode === 'public_file' ? t("public NRT archive") : t("area API")}{t("), retrieved by the platform at")} {fmtUtc(prod.provenance.fetched_at)}.
          </p>
        )}
      </div>
    </div>
  )
}
