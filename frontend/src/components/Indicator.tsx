import { t, useLocale } from '../lib/i18n'
import type { ReactNode } from 'react'
import { ErrorState, Skeleton } from './states'

/**
 * Indicador com os seis elementos obrigatórios:
 * título, valor + unidade, fonte, período, estado de carregamento e de erro/indisponibilidade.
 */
export interface IndicatorProps {
  title: string
  value: ReactNode
  unit?: string
  source: string
  period: string
  loading?: boolean
  error?: unknown
  unavailable?: string | null
  note?: ReactNode
  accent?: string
  size?: 'md' | 'lg'
}

export function Indicator({ title, value, unit, source, period, loading, error, unavailable, note, accent, size = 'md' }: IndicatorProps) {
  useLocale()
  return (
    <section className="flex min-w-0 flex-col gap-2 py-3" aria-busy={loading || undefined}>
      <h3 className="type-label flex items-center gap-2 text-[13px] text-ink-2">
        {accent && <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: accent }} aria-hidden="true" />}
        {t(title)}
      </h3>
      {loading ? (
        <Skeleton className={size === 'lg' ? 'h-10 w-32' : 'h-7 w-24'} />
      ) : error ? (
        <ErrorState error={error} compact />
      ) : unavailable ? (
        <p className="text-sm text-ink-3">{t(unavailable)}</p>
      ) : (
        <p className="num flex items-baseline gap-1.5">
          <span className={`${size === 'lg' ? 'text-4xl' : 'text-2xl'} font-semibold tracking-tight text-ink`}>{value}</span>
          {unit && <span className="text-sm text-ink-3">{t(unit)}</span>}
        </p>
      )}
      {note && !loading && !error && <div className="text-xs text-ink-2">{note}</div>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11.5px] leading-snug text-ink-3">
        <dt>{t("Source")}</dt>
        <dd className="text-ink-2">{t(source)}</dd>
        <dt>{t("Period")}</dt>
        <dd className="num text-ink-2">{period}</dd>
      </dl>
    </section>
  )
}
