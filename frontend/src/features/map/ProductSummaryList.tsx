import { sourceCopy } from '../../lib/sourceCopy'
import { AlertTriangle, Info } from 'lucide-react'
import { fmt1, fmtInt, fmtUtc } from '../../lib/format'
import { productStyle } from '../../lib/products'
import type { DetectionsMeta } from '../../lib/types'

const CONF_ORDER = ['low', 'nominal', 'high']
const CONF_LABEL: Record<string, string> = { low: "low", nominal: 'nominal', high: "high" }

export function ProductSummaryList({ meta }: { meta: DetectionsMeta }) {
  return (
    <div className="flex flex-col divide-y divide-rule/70">
      {meta.products.map((p) => {
        const st = productStyle(p.product_id)
        const total = p.count
        return (
          <section key={p.product_id} className="py-3 first:pt-0">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <span className="inline-block size-2.5 rounded-full" style={{ background: st.color }} aria-hidden="true" />
                {st.label}
              </h3>
              <span className="num text-xl font-semibold text-ink">{p.available ? fmtInt(total) : '—'}</span>
            </div>
            {!p.available && p.error && (
              <p className="mt-1.5 flex gap-1.5 text-xs text-alert">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {sourceCopy(p.error.message)}
              </p>
            )}
            {p.available && (
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-ink-2">
                <dt className="text-ink-3">Latest observation</dt>
                <dd className="num">{p.latest_observation_utc ? fmtUtc(p.latest_observation_utc) : 'none in this window'}</dd>
                {p.by_daynight && (
                  <>
                    <dt className="text-ink-3">Day / night</dt>
                    <dd className="num">{fmtInt(p.by_daynight.D ?? 0)} / {fmtInt(p.by_daynight.N ?? 0)}</dd>
                  </>
                )}
                {p.by_confidence && total > 0 && (
                  <>
                    <dt className="text-ink-3">Confidence</dt>
                    <dd className="num">
                      {CONF_ORDER.filter((c) => p.by_confidence?.[c]).map((c) => `${CONF_LABEL[c]} ${fmtInt(p.by_confidence?.[c])}`).join(', ')}
                    </dd>
                  </>
                )}
                {p.confidence_pct_quartiles && (
                  <>
                    <dt className="text-ink-3">Median confidence</dt>
                    <dd className="num">{fmtInt(p.confidence_pct_quartiles[1])}% (escala MODIS)</dd>
                  </>
                )}
                {p.frp_mw?.median != null && (
                  <>
                    <dt className="text-ink-3">FRP median / max.</dt>
                    <dd className="num">{fmt1(p.frp_mw.median)} / {fmt1(p.frp_mw.max)} MW</dd>
                  </>
                )}
                <dt className="text-ink-3">Resolution</dt>
                <dd>{st.resolution}, {p.processing === 'NRT' ? 'near real time' : "standard processing"}</dd>
              </dl>
            )}
            {p.provenance?.warnings?.map((w) => (
              <p key={sourceCopy(w)} className="mt-1.5 flex gap-1.5 text-[11.5px] text-caution">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {sourceCopy(w)}
              </p>
            ))}
            {p.status_note && <p className="mt-1.5 text-[11.5px] text-ink-3">{sourceCopy(p.status_note)}</p>}
          </section>
        )
      })}
      <p className="pt-3 text-[11.5px] leading-relaxed text-ink-3">Counts are per product. Repeated observations do not represent unique fires.</p>
    </div>
  )
}
